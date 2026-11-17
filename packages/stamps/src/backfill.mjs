/**
 * The legacy backfill for one account (#1015): the Stamps it earned
 * before launch, filed as legacy rows ("Earned before <launch day>"),
 * never bell lines. The operator's {passport_backfill} op
 * (services/migrate) walks the accounts made before launch and calls
 * this for each; the account's own next settle would file the setup
 * Stamps the same way (legacy.mjs), so the order between the deploy, the
 * account's first visit and this pass does not matter.
 *
 * What it reads, all per account and all dated before launch:
 *  - the setup Stamps as the account stood at launch (settleLegacy);
 *  - Storyteller: the account's own posts about battles with words (what
 *    were highlights until 0291);
 *  - Played Together: recorded friendlies with a followed player, the
 *    same rule as the owner's reconciliation (earn.mjs friendlyBattles),
 *    over the year the record keeps, one local day once;
 *  - Cheerleader: the cheers the caller resolved to other people's items
 *    (`cheers`, see the op: whether an item was someone else's needs the
 *    feed rebuilt, which this package does not do).
 * Facts go through the store's recordFact, so the caps, the one-source
 * and one-day rules and the frozen day bounds are the live ones.
 *
 * It only adds: a fact or level already held is left alone, nothing is
 * removed, and a level only after-launch evidence completes is left for
 * the account's own next earning call (onlyLegacy). It can only
 * undercount: a cheer taken back, a post deleted, a place saved
 * again after launch, battles past the record's year are gone.
 *
 * One account, one transaction: everything runs in a transaction the
 * caller's connection holds, the store's own transactions becoming
 * savepoints inside it (nested). `apply: false` rolls it back, so a dry
 * run takes exactly the path an apply takes and reports what it would
 * write.
 */
import { FACT_CAPS, levelFor } from "./catalog.mjs";
import { earnFact, friendlyBattles } from "./earn.mjs";
import { grantAcrossLaunch, readLaunch, settleLegacy } from "./legacy.mjs";
import { accountZone, ensurePassport } from "./store.mjs";

/** The backfill's bounds, per account [engineering, 2026-11-14]. */
export const BACKFILL = Object.freeze({
  /** How far back Played Together reads: the record's one-year
   *  retention. */
  HISTORY_DAYS: 365,
  /** Pages of qualifying friendlies read (RECONCILE.BATTLES each). */
  BATTLE_PAGES: 10,
  /** Own posts about battles read, oldest first. */
  HIGHLIGHTS: 200,
});

/**
 * A connection whose BEGIN, COMMIT and ROLLBACK are savepoints inside the
 * transaction the caller opened, and whose lone statements each run in a
 * savepoint of their own, so a statement that fails (an unknown zone,
 * which the store expects to survive) undoes only itself, as it would on
 * a connection with no transaction open.
 */
export function nested(db) {
  let depth = 0;
  let seq = 0;
  const stack = [];
  return {
    async query(text, params) {
      if (text === "begin") {
        const name = `nest_${++seq}`;
        stack.push(name);
        depth += 1;
        return db.query(`savepoint ${name}`);
      }
      if (text === "commit") {
        depth -= 1;
        return db.query(`release savepoint ${stack.pop()}`);
      }
      if (text === "rollback") {
        if (depth === 0) return { rows: [], rowCount: 0 };
        depth -= 1;
        const name = stack.pop();
        await db.query(`rollback to savepoint ${name}`);
        return db.query(`release savepoint ${name}`);
      }
      if (depth > 0) return db.query(text, params);
      const name = `stmt_${++seq}`;
      await db.query(`savepoint ${name}`);
      try {
        const out = await db.query(text, params);
        await db.query(`release savepoint ${name}`);
        return out;
      } catch (err) {
        await db.query(`rollback to savepoint ${name}`);
        await db.query(`release savepoint ${name}`);
        throw err;
      }
    },
  };
}

/** A local calendar day of `at` in `zone`, as YYYY-MM-DD. */
function localDay(at, zone) {
  const as = (timeZone) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  try {
    return as(zone);
  } catch {
    return as("UTC");
  }
}

async function factCount(db, accountId, stampId) {
  const { rows } = await db.query(
    `select count(*)::int as n from account_stamp_fact
      where account_id = $1::uuid and stamp_id = $2::text`,
    [accountId, stampId],
  );
  return rows[0].n;
}

/** Offer facts in order until the ladder is capped. Returns how many the
 *  store accepted and the legacy levels they reached. */
async function offer(db, accountId, facts, { now }) {
  let accepted = 0;
  const legacy = [];
  for (const fact of facts) {
    const r = await earnFact(db, accountId, fact, { now, onlyLegacy: true });
    if (r.refused) break;
    if (r.accepted) accepted += 1;
    legacy.push(...r.legacy);
    if (r.reason === "capped" || r.count >= FACT_CAPS[fact.stamp_id]) break;
  }
  return { accepted, legacy };
}

async function storyteller(db, accountId, line, { now }) {
  if ((await factCount(db, accountId, "storyteller")) >= FACT_CAPS.storyteller)
    return { accepted: 0, legacy: [] };
  const { rows } = await db.query(
    `select post_id::text as post_id, battle_id, created_at
       from account_post
      where account_id = $1::uuid and battle_id is not null
        and status <> 'removed' and body ~ '[^[:space:]]'
        and created_at < $2::timestamptz
      order by created_at, post_id
      limit $3::int`,
    [accountId, line.launched_at, BACKFILL.HIGHLIGHTS],
  );
  return offer(
    db,
    accountId,
    rows.map((h) => ({
      stamp_id: "storyteller",
      source: `post:${h.post_id}`,
      battle_id: h.battle_id,
      event_at: h.created_at,
    })),
    { now },
  );
}

/** One fact per local day, the first friendly of the day as its source,
 *  oldest first, paging by ingestion cursor. */
async function playedTogether(db, accountId, line, { now }) {
  const have = await factCount(db, accountId, "played_together");
  if (have >= FACT_CAPS.played_together) return { accepted: 0, legacy: [] };
  const zone = await accountZone(db, accountId);
  const from = new Date(
    Date.parse(line.launched_at) - BACKFILL.HISTORY_DAYS * 86_400_000,
  ).toISOString();
  const days = new Map();
  let after = "0";
  for (let page = 0; page < BACKFILL.BATTLE_PAGES; page++) {
    const rows = await friendlyBattles(db, accountId, {
      now: line.launched_at,
      from,
      before: true,
      after,
    });
    for (const r of rows) {
      const day = localDay(new Date(r.battle_time), zone);
      const held = days.get(day);
      if (!held || Date.parse(r.battle_time) < Date.parse(held.battle_time))
        days.set(day, r);
    }
    if (rows.length === 0) break;
    after = rows.at(-1).cursor;
    if (rows.length < 200) break;
  }
  const facts = [...days.values()]
    .sort((a, b) => Date.parse(a.battle_time) - Date.parse(b.battle_time))
    .map((r) => ({
      stamp_id: "played_together",
      source: `battle:${r.battle_id}`,
      event_at: r.battle_time,
    }));
  return offer(db, accountId, facts, { now });
}

/**
 * Backfill one account inside the transaction `db` already holds open
 * (the op begins it, then commits on apply or rolls back on a dry run).
 *
 *   cheers: [{ source: 'cheer:<item id>', event_at }] the cheers on other
 *           people's items given before launch (the op resolves them);
 *           none when not given.
 *
 * Returns { skipped } for an account this does not apply to, else
 * { setup_settled, legacy: [{ stamp_id, level }], facts: { <ladder>: n } }.
 */
export async function backfillAccount(db, accountId, { now, cheers = [] }) {
  const tx = nested(db);
  const line = await readLaunch(tx, accountId);
  if (!line) return { skipped: "no_launch" };
  if (!line.pre) return { skipped: "after_launch" };
  if (!(await ensurePassport(tx, accountId))) return { skipped: "not_person" };
  const told = await storyteller(tx, accountId, line, { now });
  const cheered =
    (await factCount(tx, accountId, "cheerleader")) >= FACT_CAPS.cheerleader
      ? { accepted: 0, legacy: [] }
      : await offer(
          tx,
          accountId,
          [...cheers]
            .filter(
              (c) => Date.parse(c.event_at) < Date.parse(line.launched_at),
            )
            .sort((a, b) => Date.parse(a.event_at) - Date.parse(b.event_at))
            .map((c) => ({
              stamp_id: "cheerleader",
              source: c.source,
              event_at: c.event_at,
            })),
          { now },
        );
  const played = await playedTogether(tx, accountId, line, { now });
  // The setup Stamps as they stood at launch, unless the account's own
  // first settle has already filed them.
  const setup = await settleLegacy(tx, accountId, { now, launch: line });
  // Any ladder level the pre-launch facts reach that is not held yet (a
  // fact the account's live calls recorded before this ran).
  const { rows } = await tx.query(
    `select stamp_id, count(*)::int as n from account_stamp_fact
      where account_id = $1::uuid and event_at < $2::timestamptz
      group by stamp_id`,
    [accountId, line.launched_at],
  );
  const levels = rows.flatMap((r) =>
    Array.from({ length: levelFor(r.stamp_id, r.n) }, (_, i) => ({
      stamp_id: r.stamp_id,
      level: i + 1,
    })),
  );
  const rest = levels.length
    ? await grantAcrossLaunch(tx, accountId, levels, {
        now,
        onlyLegacy: true,
        line,
      })
    : { legacy: [] };
  // The account's ladder history before launch is read: its ordinary
  // ladder grants stop waiting (0273), from its next earning call on.
  await tx.query(
    `update account_passport
        set legacy_history_at = coalesce(legacy_history_at, $2::timestamptz)
      where account_id = $1::uuid`,
    [accountId, new Date(now).toISOString()],
  );
  const legacy = [
    ...told.legacy,
    ...cheered.legacy,
    ...played.legacy,
    ...setup.legacy,
    ...(rest.legacy ?? []),
  ].map((g) => ({ stamp_id: g.stamp_id, level: g.level }));
  return {
    setup_settled: !line.settled,
    legacy,
    facts: {
      storyteller: told.accepted,
      cheerleader: cheered.accepted,
      played_together: played.accepted,
    },
  };
}
