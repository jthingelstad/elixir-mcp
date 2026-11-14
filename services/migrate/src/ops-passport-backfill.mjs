/**
 * The passport's legacy backfill ({passport_backfill}, #1015): the Stamps
 * the accounts made before launch earned before it, filed as "Earned
 * before <launch day>", never as bell lines.
 *
 *   {passport_backfill: {}}                dry run: what it would grant
 *   {passport_backfill: {apply: true}}     grant it
 *   ... {after: "<cursor>"}                 the next batch, from the
 *                                            `after` the last one answered
 *   ... {limit: 200, budget_ms: 45000}      accounts per batch (at most
 *                                            1000), time per batch (at
 *                                            most 60000)
 *
 * Run it after the deploy that applied 0272 (the launch row), never beside
 * one, until `done`. It does not have to run first: the account's own
 * first settle files its setup Stamps the same way (packages/stamps
 * legacy.mjs), so the order between the deploy, an account's visit and
 * this pass changes nothing a person sees. What only this pass adds is
 * the history: Played Together over the year the record keeps, the
 * highlights and the cheers before launch.
 *
 * Each account is one transaction, its reads per account (its own claims,
 * highlights, cheers, battles by its own players' cover, its follows'
 * feed). A dry run takes exactly the apply's path and rolls each account
 * back, so its counts are what an apply would write now. Idempotent: a
 * fact or level already held is not offered again, so a second apply
 * grants nothing and an interrupted run is resumed from its `after` (or
 * simply run again). It only adds rows; nothing is removed or lowered.
 * An account whose transaction fails is rolled back and counted in
 * `failed`; the cursor moves past it and a later run tries it again.
 *
 * The answer is counts only: accounts read, accounts given something,
 * levels by Stamp and level, facts by ladder. Never an account id, a
 * name, a tag or an address. The cursor is an account's opaque id, which
 * only the operator who ran it sees.
 */
import pg from "pg";
import { backfillAccount } from "@elixir-mcp/stamps/backfill";
import { buildTimeline, subjectsFor } from "@elixir-mcp/tools/activity/entries";
import { cheerable } from "@elixir-mcp/tools/activity/cheers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS = new Set(["apply", "after", "limit", "budget_ms"]);
const DAY_MS = 86_400_000;

/** Cheers read for one account: the feed rebuilt to resolve them covers
 *  the last CHEER_DAYS before launch (cheers began with slice 7, days
 *  before launch, so this is all of them), at most CHEER_ROWS. */
export const CHEERS = Object.freeze({ DAYS: 28, ROWS: 200 });

/** The request, checked, or why it is refused. */
export function readSpec(spec) {
  const s = spec === true ? {} : spec;
  if (!s || typeof s !== "object" || Array.isArray(s))
    return { error: "passport_backfill takes an object" };
  const unknown = Object.keys(s).filter((k) => !KEYS.has(k));
  if (unknown.length) return { error: "unknown_keys", keys: unknown };
  if (Object.hasOwn(s, "apply") && typeof s.apply !== "boolean")
    return { error: "apply must be true or false" };
  if (s.after != null && !(typeof s.after === "string" && UUID.test(s.after)))
    return { error: "after must be the cursor a batch answered" };
  const limit = s.limit ?? 200;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    return { error: "limit must be 1 to 1000" };
  const budget = s.budget_ms ?? 45_000;
  if (!Number.isSafeInteger(budget) || budget < 1000 || budget > 60_000)
    return { error: "budget_ms must be 1000 to 60000" };
  return {
    apply: s.apply === true,
    after: s.after?.toLowerCase() ?? null,
    limit,
    budgetMs: budget,
  };
}

/**
 * The account's cheers on other people's items given before launch, as
 * Cheerleader facts: { source: 'cheer:<item id>', event_at }. A cheer
 * stores only its item's id, so whose item it was is read the way the
 * live hook read it: the account's own feed rebuilt over the cheers'
 * days, an item about someone else when none of the players it names is
 * one of the account's own (aboutSomeoneElse in web-api's cheers.mjs).
 * A cheer whose item is not found again (a follow since dropped, a battle
 * trimmed) is left out: an undercount, never a guess.
 */
export async function cheersBeforeLaunch(db, accountId, launchedAt) {
  const end = Date.parse(launchedAt);
  const { rows: cheers } = await db.query(
    `select item_id, created_at from timeline_cheer
      where account_id = $1::uuid and created_at < $2::timestamptz
        and created_at >= $2::timestamptz - make_interval(days => $3::int)
      order by created_at, item_id
      limit $4::int`,
    [accountId, launchedAt, CHEERS.DAYS, CHEERS.ROWS],
  );
  if (cheers.length === 0) return [];
  const subjects = await subjectsFor(db, accountId);
  if (subjects.length === 0) return [];
  const first = Math.min(...cheers.map((c) => Date.parse(c.created_at)));
  const built = await buildTimeline(db, subjects, {
    fromMs: first - 7 * DAY_MS,
    toMs: end,
    accountId,
    interactive: true,
    accountLines: false,
    lateCounts: false,
  });
  const items = new Map(
    (built.timeline ?? []).filter(cheerable).map((it) => [it.id, it]),
  );
  const { rows: own } = await db.query(
    `select player_tag from claim
      where account_id = $1::uuid
        and (is_primary or relationship in ('primary', 'alt'))`,
    [accountId],
  );
  const mine = new Set(own.map((r) => r.player_tag));
  const someoneElse = (item) =>
    ![item.subject_tag, ...(item.subjects ?? []).map((s) => s?.tag)].some(
      (t) => typeof t === "string" && mine.has(t),
    );
  return cheers
    .filter((c) => items.has(c.item_id) && someoneElse(items.get(c.item_id)))
    .map((c) => ({
      source: `cheer:${c.item_id}`,
      event_at: new Date(c.created_at).toISOString(),
    }));
}

/** The accounts the backfill is for, after `after`: approved people
 *  made before launch, never an agent or a removed account's tombstone. */
const NEXT = `select account_id::text as account_id from account
  where ($1::uuid is null or account_id > $1::uuid)
    and coalesce(kind, 'person') = 'person' and status = 'approved'
    and coalesce(email_hash, '') not like 'removed:%'
    and created_at < $2::timestamptz
  order by account_id limit $3::int`;

/** One batch on an open connection (tests call it on a scratch one). */
export async function passportBackfill(
  db,
  spec,
  { now = new Date(), resolveCheers = cheersBeforeLaunch } = {},
) {
  const started = Date.now();
  const { rows: launch } = await db.query(
    `select launched_at from passport_launch`,
  );
  if (!launch[0]) return { error: "no_launch_row" };
  const launchedAt = new Date(launch[0].launched_at).toISOString();
  const { rows: batch } = await db.query(NEXT, [
    spec.after,
    launchedAt,
    spec.limit,
  ]);
  const out = {
    dry_run: !spec.apply,
    launched_at: launchedAt,
    accounts: 0,
    accounts_granted: 0,
    setup_settled: 0,
    granted: {},
    facts: { played_together: 0, cheerleader: 0, storyteller: 0 },
    failed: 0,
    after: spec.after,
    done: false,
    remaining: 0,
    ms: 0,
  };
  let stopped = false;
  for (const { account_id: id } of batch) {
    if (Date.now() - started >= spec.budgetMs) {
      stopped = true;
      break;
    }
    try {
      const cheers = await resolveCheers(db, id, launchedAt);
      await db.query("begin");
      try {
        const r = await backfillAccount(db, id, { now, cheers });
        await db.query(spec.apply ? "commit" : "rollback");
        if (!r.skipped) {
          if (r.setup_settled) out.setup_settled += 1;
          if (r.legacy.length) out.accounts_granted += 1;
          for (const g of r.legacy) {
            const by = (out.granted[g.stamp_id] ??= {});
            by[g.level] = (by[g.level] ?? 0) + 1;
          }
          for (const [k, v] of Object.entries(r.facts)) out.facts[k] += v;
        }
      } catch (err) {
        await db.query("rollback").catch(() => {});
        throw err;
      }
    } catch (err) {
      out.failed += 1;
      // The error's class only: its message can carry a value.
      console.error(
        JSON.stringify({
          at: "passport_backfill_failed",
          error: err?.code ?? err?.name ?? "error",
        }),
      );
    }
    out.accounts += 1;
    out.after = id;
  }
  const {
    rows: [left],
  } = await db.query(
    `select count(*)::int as n from (${NEXT.replace("limit $3::int", "")}) x`,
    [out.after, launchedAt],
  );
  out.remaining = left.n;
  out.done = !stopped && left.n === 0;
  if (out.done) out.after = null;
  out.ms = Date.now() - started;
  return out;
}

export async function passportBackfillOp(databaseUrl, raw) {
  const spec = readSpec(raw);
  if (spec.error) return spec;
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set statement_timeout = '30s'");
    return await passportBackfill(db, spec);
  } finally {
    await db.end();
  }
}
