import { timedStore, timedElixir } from "@elixir-mcp/clan/trace.mjs";
import { ledgerOver } from "@elixir-mcp/clan-state";
import { createModelService } from "@elixir-mcp/clan/manage/model.mjs";
import { createDrafts } from "@elixir-mcp/clan/manage/drafts.mjs";
import { createModelBridge } from "@elixir-mcp/clan/model-bridge.mjs";
/** Clan inside the web API: the authenticated Elixir person, the request's
 * connected Postgres client, and the same recorded facts the public doors
 * read. There is no internal OAuth grant or HTTP round trip. */
import { createHandler } from "@elixir-mcp/clan/handler.mjs";
import { createAccountContext } from "@elixir-mcp/clan/account.mjs";
import { createRecordedClient } from "@elixir-mcp/clan/recorded-client.mjs";
import {
  createManageService,
  fetchParticipation,
  fetchRoster,
} from "@elixir-mcp/clan/manage/service.mjs";
import { createAwardsService } from "@elixir-mcp/clan/manage/awards.mjs";
import { createRecruitService } from "@elixir-mcp/clan/manage/recruit.mjs";
import { createScout } from "@elixir-mcp/clan/manage/scout.mjs";
import { createSocialService } from "@elixir-mcp/clan/manage/social.mjs";
import { createFeedbackService } from "@elixir-mcp/clan/feedback.mjs";
import { diskGeo } from "@elixir-mcp/clan/geo.mjs";
import { normalizeTag } from "@elixir-mcp/clan/gate.mjs";
import { createPostgresStore } from "@elixir-mcp/clan-state/postgres";
import { myPlayers } from "@elixir-mcp/record/players";
import { warMembershipEvidence } from "@elixir-mcp/record/war-membership";
import {
  writeClanFactInClan,
  removeClanFactInClan,
} from "@elixir-mcp/record/attested-facts";
import { makeRegistry } from "@elixir-mcp/tools";
import { makeInvoker } from "@elixir-mcp/tools/invoker";
import { makeLive } from "@elixir-mcp/tools/live";
import { enqueueJob } from "@elixir-mcp/ledger";
import { principalBlock } from "@elixir-mcp/tools/identity";
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

/** Time logical state operations without exposing keys, SQL or stored words. */
export function createTracedClanStore(db) {
  const raw = createPostgresStore(db);
  return Object.fromEntries(
    Object.entries(raw).map(([op, fn]) => [
      op,
      (...args) => timedStore(`clan_state.${op}`, () => fn.apply(raw, args)),
    ]),
  );
}

/** Keep the principal's tracked-clan ordering while reusing the players read.
 * No primary-clan/default-subject query is needed by this private gate. */
export async function recordedIdentity(db, account) {
  const players = await myPlayers(db, account.accountId);
  const { rows: clans } = await db.query(
    `select ac.clan_tag, c.name,
            exists (select 1 from claim cl
                    join clan_membership m on m.player_tag = cl.player_tag
                                          and m.left_observed_at is null
                    where cl.account_id = ac.account_id and cl.is_primary
                      and m.clan_tag = ac.clan_tag) as primary_players_clan
     from account_clan ac
     left join clan c on c.clan_tag = ac.clan_tag
     where ac.account_id = $1
     order by primary_players_clan desc, ac.is_primary desc, ac.clan_tag`,
    [account.accountId],
  );
  return {
    ok: true,
    principal: principalBlock("person", {
      grouped: {
        primary: players.filter((player) => player.relationship === "primary"),
      },
      clans,
    }),
    body: { players },
  };
}

export function createClanRequest({
  origin,
  maintainerTags = [],
  notify = async () => {},
  modelSecret = null,
  modelStorage = null,
}) {
  const appUrl = `${origin}/clan`;
  return async ({ db, account, event, signout, modelFactory = null }) => {
    const credential = Object.freeze({});
    const invoke = makeInvoker({
      db,
      // This trusted internal feature retains the family quota exemption;
      // it still uses the original person for every identity/role check.
      account: { ...account, firstParty: true },
      registry,
      live,
      surface: "web",
      clientName: "Clan",
      queryBudgetMs: 15_000,
      deadlineMs: toolDeadlineMs(event),
    });
    const mcp = createRecordedClient({
      credential,
      initialize: () =>
        timedElixir("initialize", () => recordedIdentity(db, account)),
      invoke: (name, args) =>
        timedElixir(name, async () => {
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
        }),
      writeFact: (tag, body) =>
        answer(() => writeClanFactInClan(db, account, tag, body)),
      removeFact: (tag, ref) =>
        answer(() => removeClanFactInClan(db, account, tag, ref)),
    });
    const state = createTracedClanStore(db),
      ledger = ledgerOver(state);
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
      membershipFor: (tag, participation) =>
        warMembershipEvidence(db, tag, participation),
      participationFor: (token, tag) => fetchParticipation(mcp, token, tag),
      elixir: mcp,
    });
    const model = modelFactory
      ? modelFactory({ ledger, mcp })
      : modelSecret && modelStorage
        ? createModelService({
            ledger,
            secret: modelSecret,
            rosterFor: (token, tag) => fetchRoster(mcp, token, tag),
            anthropic: createModelBridge({
              secret: modelSecret,
              storage: modelStorage,
              timeoutMs: () =>
                Math.max(
                  1,
                  Math.min(
                    25_000,
                    (event.softDeadlineAt ?? Date.now() + 28_000) -
                      Date.now() -
                      3000,
                  ),
                ),
            }),
          })
        : null;
    const handler = createHandler({
      ...context,
      mcp,
      manage,
      awards,
      model,
      drafts: createDrafts({ ledger, model }),
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
    // These two routes calculate views without reconciling actions or grants.
    // Their only shared metadata write is an atomic, monotonic observation.
    const pureView =
      method === "GET" &&
      /^\/api\/clan\/clans\/[0-9A-Za-z]{3,12}\/(?:week|me)$/.test(path);
    const lock =
      clan && !pureView
        ? `clan-state:${normalizeTag(clan) ?? account.accountId}`
        : method !== "GET"
          ? `clan-state:${account.accountId}`
          : null;
    const lockStarted = Date.now();
    if (lock) await db.query("select pg_advisory_lock(hashtext($1))", [lock]);
    const lockMs = lock ? Date.now() - lockStarted : null;
    try {
      return await handler(event, { lockMs });
    } finally {
      if (lock)
        await db.query("select pg_advisory_unlock(hashtext($1))", [lock]);
    }
  };
}
