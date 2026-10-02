/** Clan inside the web API: the authenticated Elixir person, the request's
 * connected Postgres client, and the same recorded facts the public doors
 * read. There is no internal OAuth grant or HTTP round trip. */
import { createHandler } from "@elixir-mcp/clan/handler.mjs";
import { createAccountContext } from "@elixir-mcp/clan/account.mjs";
import { createRecordedClient } from "@elixir-mcp/clan/recorded-client.mjs";
import {
  createManageService,
  fetchParticipation,
} from "@elixir-mcp/clan/manage/service.mjs";
import { createAwardsService } from "@elixir-mcp/clan/manage/awards.mjs";
import { createRecruitService } from "@elixir-mcp/clan/manage/recruit.mjs";
import { createScout } from "@elixir-mcp/clan/manage/scout.mjs";
import { createSocialService } from "@elixir-mcp/clan/manage/social.mjs";
import { createFeedbackService } from "@elixir-mcp/clan/feedback.mjs";
import { diskGeo } from "@elixir-mcp/clan/geo.mjs";
import { normalizeTag } from "@elixir-mcp/clan/gate.mjs";
import {
  createPostgresStore,
  createPostgresLedger,
} from "@elixir-mcp/clan-state/postgres";
import { myPlayers } from "@elixir-mcp/record/players";
import {
  writeClanFactInClan,
  removeClanFactInClan,
} from "@elixir-mcp/record/attested-facts";
import { makeRegistry } from "@elixir-mcp/tools";
import { makeInvoker } from "@elixir-mcp/tools/invoker";
import { makeLive } from "@elixir-mcp/tools/live";
import { enqueueJob } from "@elixir-mcp/ledger";
import { describeIdentity, principalBlock } from "@elixir-mcp/tools/identity";
import { toolDeadlineMs } from "./deadline.mjs";

const registry = makeRegistry();
const live = makeLive({ enqueue: (db, job) => enqueueJob(db, job) });
const STATUS = {
  input: 400,
  subject: 404,
  budget: 429,
  retry: 503,
  server: 502,
};

const redirect = (location) => ({
  statusCode: 303,
  headers: { location, "cache-control": "no-store" },
  body: "",
});
const answer = async (fn) => {
  try {
    return { ok: true, body: await fn() };
  } catch (e) {
    return {
      ok: false,
      status: e.status ?? 502,
      code: e.code ?? "internal",
      error: e.status ? e.message : "Clan could not record this action.",
    };
  }
};

export function createClanRequest({
  origin,
  maintainerTags = [],
  notify = async () => {},
}) {
  const appUrl = `${origin}/clan`;
  return async ({ db, account, event, signout, modelFactory = null }) => {
    const credential = Object.freeze({});
    const invoke = makeInvoker({
      db,
      account,
      registry,
      live,
      surface: "web",
      clientName: "Clan",
      queryBudgetMs: 15_000,
      deadlineMs: toolDeadlineMs(event),
    });
    const mcp = createRecordedClient({
      credential,
      initialize: async () => ({
        ok: true,
        principal: principalBlock(
          "person",
          await describeIdentity(db, account),
        ),
        body: { players: await myPlayers(db, account.accountId) },
      }),
      invoke: async (name, args) => {
        const r = await invoke(name, args);
        return r.isError
          ? {
              ok: false,
              status: STATUS[r.body.error.class] ?? 502,
              code: r.body.error.code,
              error: r.body.error.message,
              hint: r.body.error.hint,
              body: r.body,
            }
          : { ok: true, body: r.body };
      },
      writeFact: (tag, body) =>
        answer(() => writeClanFactInClan(db, account, tag, body)),
      removeFact: (tag, ref) =>
        answer(() => removeClanFactInClan(db, account, tag, ref)),
    });
    const state = createPostgresStore(db),
      ledger = createPostgresLedger(db);
    const context = createAccountContext({
      account,
      state,
      credential,
      login: async () => redirect(appUrl),
      logout: signout,
    });
    const manage = createManageService({ ledger, mcp, appUrl });
    const awards = createAwardsService({
      ledger,
      participationFor: (token, tag) => fetchParticipation(mcp, token, tag),
      elixir: mcp,
    });
    const model = modelFactory ? modelFactory({ ledger, mcp }) : null;
    const handler = createHandler({
      ...context,
      mcp,
      manage,
      awards,
      model,
      recruit: createRecruitService({ ledger, mcp, model }),
      scout: createScout({ mcp }),
      social: createSocialService({ ledger, geo: diskGeo() }),
      feedback: createFeedbackService({ ledger, notify }),
      maintainerTags,
      appUrl,
      elixirUrl: origin,
    });
    // Serialize multi-item changes in one clan/request with a session lock.
    // The fact writer owns its transaction; an outer transaction would
    // accidentally commit the rest of the request inside that writer.
    const method =
      event.requestContext?.http?.method ?? event.httpMethod ?? "GET";
    const path = event.rawPath ?? event.path ?? "";
    const clan = /^\/api\/clan\/clans\/([0-9A-Za-z]{3,12})(?:\/|$)/.exec(
      path,
    )?.[1];
    // Manage/actions GETs can evaluate and reconcile cards. They must
    // serialize with decisions too, and O/0 aliases name the same lock.
    const lock = clan
      ? `clan-state:${normalizeTag(clan) ?? account.accountId}`
      : method !== "GET"
        ? `clan-state:${account.accountId}`
        : null;
    if (lock) await db.query("select pg_advisory_lock(hashtext($1))", [lock]);
    try {
      return await handler(event);
    } finally {
      if (lock)
        await db.query("select pg_advisory_unlock(hashtext($1))", [lock]);
    }
  };
}
