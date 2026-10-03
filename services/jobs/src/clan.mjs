/** One recorded clan per tick, in the existing jobs runtime. Private
 * state and derived facts stay distinct from collector-admitted facts.
 * No person's grant or integration credential is stored or presented. */
import pg from "pg";
import {
  createPostgresStore,
  createPostgresLedger,
} from "@elixir-mcp/clan-state/postgres";
import { createRecordedClient } from "@elixir-mcp/clan/recorded-client.mjs";
import {
  createManageService,
  fetchParticipation,
} from "@elixir-mcp/clan/manage/service.mjs";
import { createAwardsService } from "@elixir-mcp/clan/manage/awards.mjs";
import {
  writeClanFactAsApp,
  removeClanFactAsApp,
} from "@elixir-mcp/record/attested-facts";
import { sendClanMail } from "@elixir-mcp/mail/clan-mail";
import { makeRegistry } from "@elixir-mcp/tools";
import { makeInvoker } from "@elixir-mcp/tools/invoker";
import { normalizeTag } from "@elixir-mcp/contracts";
import { warMembershipEvidence } from "@elixir-mcp/record/war-membership";
const registry = makeRegistry();
const answer = async (fn) => {
  try {
    return { ok: true, body: await fn() };
  } catch (e) {
    return {
      ok: false,
      code: e.code ?? "clan_step_failed",
      status: e.status ?? 502,
    };
  }
};
export async function evaluateClanTick(
  db,
  {
    manage,
    awards,
    state = createPostgresStore(db),
    ledger = createPostgresLedger(db),
    credential = Object.freeze({}),
    now = Date.now,
  },
) {
  const at = new Date(now()).toISOString(),
    day = at.slice(0, 10);
  const clans = (await ledger.scheduledClans()).map(normalizeTag);
  const previousRows = (
    await db.query(
      "select pk,body from clan_state where pk = any($1::text[])",
      [clans.map((clan) => `morning#${clan}`)],
    )
  ).rows;
  const mornings = new Map(previousRows.map((row) => [row.pk, row.body]));
  const prior = (clan) => {
    const row = mornings.get(`morning#${clan}`);
    return row?.day === day ? row : null;
  };
  // First attempts precede retries; retry the oldest failed clan first.
  // A persistently failing first clan cannot starve the remaining clans.
  clans.sort(
    (a, b) =>
      Number(Boolean(prior(a))) - Number(Boolean(prior(b))) ||
      String(prior(a)?.at ?? "").localeCompare(String(prior(b)?.at ?? "")) ||
      a.localeCompare(b),
  );
  for (const raw of clans) {
    const clan = normalizeTag(raw),
      lock = `clan-state:${clan}`;
    if (
      !(
        await db.query("select pg_try_advisory_lock(hashtext($1)) as locked", [
          lock,
        ])
      ).rows[0].locked
    )
      continue;
    try {
      const previous = await state.get(`morning#${clan}`);
      // A legacy claim has no status; preserve its same-day disposition.
      if (
        previous?.day === day &&
        [undefined, "completed"].includes(previous.status)
      )
        continue;
      if (previous?.day === day && (previous.attempt ?? 0) >= 3) continue;
      const attempt = previous?.day === day ? (previous.attempt ?? 0) + 1 : 1;
      await state.put({
        pk: `morning#${clan}`,
        day,
        at,
        status: "running",
        attempt,
      });
      const evaluated = await manage.evaluateOnSchedule(clan, credential);
      const awarded = await awards.evaluateOnSchedule(clan, credential);
      const mailed = await manage.mailActionsWaiting(clan, credential);
      if (
        awarded.standings_failed ||
        awarded.awards_error ||
        mailed.mail_error ||
        mailed.mail?.failed
      )
        throw new Error("clan_step_failed");
      await state.put({
        pk: `morning#${clan}`,
        day,
        at,
        status: "completed",
        attempt,
        completed_at: new Date(now()).toISOString(),
      });
      return { due: 1, ok: true, attempt, ...evaluated, ...awarded, ...mailed };
    } catch (e) {
      const skipped = ["no_policy", "too_few_members"].includes(e.code);
      const current = await state.get(`morning#${clan}`);
      await state.put({
        ...current,
        pk: `morning#${clan}`,
        day,
        at,
        status: skipped ? "completed" : "retry",
        code: e.code ?? "clan_step_failed",
      });
      if (!skipped) throw new Error("clan_evaluation_retry");
      return { due: 1, ok: true, skipped: e.code };
    } finally {
      await db.query("select pg_advisory_unlock(hashtext($1))", [lock]);
    }
  }
  return { due: 0 };
}
export async function runClanEvaluation({
  databaseUrl,
  enqueue,
  secret,
  archive,
}) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    // Keep this durable historical attester identity after its token is
    // revoked. It is provenance, not a second sign-in or network client.
    const row = (
      await db.query(
        "select account_id from integration where name='elixir-clan'",
      )
    ).rows[0];
    if (!row) throw new Error("clan_attester_identity_missing");
    const actor = {
      accountId: row.account_id,
      name: "elixir-clan",
      kind: "integration",
      role: "member",
      firstParty: true,
    };
    const credential = Object.freeze({});
    const invoke = makeInvoker({
      db,
      account: actor,
      registry,
      surface: "web",
      clientName: "Clan morning",
      queryBudgetMs: 15_000,
      deadlineMs: 75_000,
    });
    const mcp = createRecordedClient({
      credential,
      invoke: async (name, args) => {
        const r = await invoke(name, args);
        return r.isError
          ? { ok: false, code: r.body.error.code, body: r.body }
          : { ok: true, body: r.body };
      },
      writeFact: (tag, body) =>
        answer(() => writeClanFactAsApp(db, actor, tag, body)),
      removeFact: (tag, ref) =>
        answer(() => removeClanFactAsApp(db, actor, tag, ref)),
      sendMail: (tag, body) =>
        answer(() =>
          sendClanMail(db, actor, tag, body, { enqueue, secret, archive }),
        ),
    });
    await expireModelUses(db);
    const ledger = createPostgresLedger(db);
    return await evaluateClanTick(db, {
      ledger,
      credential,
      manage: createManageService({
        ledger,
        mcp,
        appUrl: "https://elixir.poapkings.com/clan",
      }),
      awards: createAwardsService({
        ledger,
        membershipFor: (tag, participation) =>
          warMembershipEvidence(db, tag, participation),
        participationFor: (token, tag) => fetchParticipation(mcp, token, tag),
        elixir: mcp,
      }),
    });
  } finally {
    await db.end();
  }
}

/** Preserve the existing 90-day usage retention when Dynamo TTL retires.
 * Only expired usage records, bounded per tick; every other private item stays. */
export async function expireModelUses(db, now = Date.now()) {
  const result = await db.query(
    `with expired as (
    select pk from clan_state where starts_with(pk, 'model_call#')
      and jsonb_typeof(body->'ttl')='number' and (body->>'ttl')::numeric <= $1
      order by pk limit 1000)
    delete from clan_state s using expired e where s.pk=e.pk`,
    [Math.floor(now / 1000)],
  );
  return result.rowCount;
}
