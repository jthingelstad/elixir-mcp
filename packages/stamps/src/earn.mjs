/**
 * Earning (#1015, the hooks and the owner's reconciliation): the only
 * code that turns a successful write, or the owner's own recorded play,
 * into granted Stamps. Built on store.mjs's writers.
 *
 *  - settlePassport: after a successful setup write (verification, a
 *    picture, a place, an alt, Discord, a follow, a digest or map
 *    choice). Latches what the write proved, reads the snapshot,
 *    latches every profile step that is now done (a done step stays
 *    done), marks the list complete once, and grants every eligible
 *    level. One snapshot covers every setup Stamp, so a hook that missed
 *    (it threw, or the write came through a door with no hook) is
 *    repaired by the next settle of the same account.
 *  - earnFact: a ladder fact with its accepted action (a cheer, a
 *    post about a battle), then the level that count reaches.
 *  - reconcilePassport: the owner's bounded, idempotent pass from Home or
 *    their passport: a missed place save, Storyteller facts from the
 *    account's own posts about battles, Played Together days from the recorded
 *    battles read since the last pass, then a settle.
 *
 * Every function takes a client OUTSIDE a transaction (the store's
 * writers open their own) and an explicit `now`. Wins, trophies, rank
 * and win rate are read nowhere here, so they can never grant.
 *
 * A grant is its own notice: the bell reads account_stamp_earned
 * (services/web-api bell.mjs), one line per Stamp per pass, at its
 * highest level. Nothing here writes an event, a feed item or mail.
 */
import { createHash } from "node:crypto";
import { CLANMATE_TYPES, FRIENDLY_TYPES } from "@elixir-mcp/contracts";
import { FACT_CAPS } from "./catalog.mjs";
import { evaluatePassport } from "./eligibility.mjs";
import { grantAcrossLaunch, readLaunch, settleLegacy } from "./legacy.mjs";
import {
  accountZone,
  ensurePassport,
  latchProfile,
  readSnapshot,
  recordFact,
} from "./store.mjs";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** The reconciliation's bounds, per call [engineering, 2026-11-14]. */
export const RECONCILE = Object.freeze({
  /** Played Together reads friendly battles played in this many trailing
   *  days. A battle log holds 25 battles, so a battle recorded later
   *  than this after it was played is not expected. */
  LOOKBACK_DAYS: 30,
  /** Qualifying battles read in one call, oldest ingestion first. More
   *  waits for the next call (`more: true`). */
  BATTLES: 200,
  /** Facts offered to the store in one call, across both ladders. */
  FACTS: 40,
  /** Own posts about battles read in one call, oldest first. */
  HIGHLIGHTS: 60,
  /** A battle recorded at least this long ago counts as settled: the
   *  checkpoint moves only past settled battles, so a battle whose
   *  ingest transaction committed late is still read. */
  SETTLED_MS: 5 * 60_000,
});

/** The two-against-two friendlies: the teammate is the evidence. */
const TEAM_TYPES = CLANMATE_TYPES.filter((t) => /2v2/i.test(t));

/**
 * After a successful setup write: latch `latch` (latchProfile's patch)
 * when given, then settle. Returns { granted: [...], legacy: [...] }:
 * granted holds only the ordinary levels this call inserted (each a bell
 * line), legacy the levels it filed as earned before launch (never a
 * line; legacy.mjs), or { refused: 'not_person' }.
 *
 * For an account made before launch, the first settle files what stood
 * at launch as legacy before anything else (settleLegacy), so the write
 * that called it, made after launch, is still an ordinary grant.
 */
export async function settlePassport(db, accountId, { now, latch = null }) {
  const line = await readLaunch(db, accountId);
  const baseline = line?.pre
    ? await settleLegacy(db, accountId, { now, launch: line })
    : { legacy: [] };
  if (latch) {
    const stored = await latchProfile(db, accountId, latch, { now });
    if (stored === null) return { refused: "not_person" };
  }
  const snapshot = await readSnapshot(db, accountId, { now });
  if (!snapshot?.person) return { refused: "not_person" };
  const evaluation = evaluatePassport(snapshot, now);
  const done = evaluation.profile.steps
    .filter((s) => s.state === "done" && !s.latched)
    .map((s) => s.id);
  const completing =
    evaluation.profile.complete && !snapshot.latches.completed_at;
  if (done.length || completing)
    await latchProfile(
      db,
      accountId,
      { steps: done, complete: completing },
      { now },
    );
  if (!evaluation.grants.length)
    return { granted: [], legacy: baseline.legacy };
  const out = await grantAcrossLaunch(db, accountId, evaluation.grants, {
    now,
    line,
  });
  return out.refused
    ? { refused: out.refused }
    : { granted: out.granted, legacy: [...baseline.legacy, ...out.legacy] };
}

/**
 * A ladder fact with its accepted action, then its level. Returns
 * { accepted, reason?, count, level, granted, legacy }: a level the
 * facts dated before launch already reach is filed as legacy, never a
 * bell line (legacy.mjs). `onlyLegacy` (the operator's backfill) grants
 * only those.
 */
export async function earnFact(
  db,
  accountId,
  fact,
  { now, onlyLegacy = false },
) {
  const r = await recordFact(db, accountId, fact, { now });
  if (r.refused) return { ...r, granted: [], legacy: [] };
  if (r.level < 1) return { ...r, granted: [], legacy: [] };
  // A retry or a racing call already granted it: nothing is new.
  const levels = Array.from({ length: r.level }, (_, i) => ({
    stamp_id: fact.stamp_id,
    level: i + 1,
  }));
  const g = await grantAcrossLaunch(db, accountId, levels, {
    now,
    onlyLegacy,
  });
  return { ...r, granted: g.granted ?? [], legacy: g.legacy ?? [] };
}

/** The account's stored facts for one ladder: their count, source and
 *  qualifier digests, and the frozen day bounds. */
async function storedFacts(db, accountId, stampId) {
  const { rows } = await db.query(
    `select source_hash, qualifier, day_starts_at, day_ends_at
       from account_stamp_fact
      where account_id = $1::uuid and stamp_id = $2::text`,
    [accountId, stampId],
  );
  return rows;
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

/**
 * Storyteller from the account's own posts about battles with words (what
 * were highlights until 0292): each one the stored facts do not already
 * hold (by source or by battle) is offered. Repairs a post whose hook
 * failed. A highlight counted before 0292 holds its battle, so the post
 * it became is never counted again. Bounded by RECONCILE.HIGHLIGHTS and
 * the fact budget.
 */
async function storytellerFromPosts(db, accountId, { now, budget }) {
  const facts = await storedFacts(db, accountId, "storyteller");
  if (facts.length >= FACT_CAPS.storyteller) return [];
  const sources = new Set(facts.map((f) => f.source_hash));
  const battles = new Set(facts.map((f) => f.qualifier));
  const { rows } = await db.query(
    `select post_id::text as post_id, battle_id, created_at
       from account_post
      where account_id = $1::uuid and battle_id is not null
        and status <> 'removed' and body ~ '[^[:space:]]'
      order by created_at, post_id
      limit $2::int`,
    [accountId, RECONCILE.HIGHLIGHTS],
  );
  const granted = [];
  for (const h of rows) {
    if (budget.left <= 0) break;
    const source = `post:${h.post_id}`;
    if (sources.has(sha256(`storyteller\n${source}`))) continue;
    const qualifier = `battle:${sha256(h.battle_id)}`;
    if (battles.has(qualifier)) continue;
    budget.left -= 1;
    const r = await earnFact(
      db,
      accountId,
      {
        stamp_id: "storyteller",
        source,
        battle_id: h.battle_id,
        event_at: h.created_at,
      },
      { now },
    );
    granted.push(...r.granted);
    battles.add(qualifier);
    if (r.reason === "capped") break;
  }
  return granted;
}

/**
 * The account's recorded friendly battles with a followed player, read
 * by ingestion since the checkpoint (battle.cursor, 0270), oldest first.
 *
 * The rule (docs/plans/stamps-build.md, Played Together): the battle is
 * a friendly by the record's own type (FRIENDLY_TYPES, CLANMATE_TYPES);
 * the account's side is one of its own VERIFIED players; the other is a
 * player it follows (relationship friend), never one of its own. In a
 * one-against-one friendly the followed player is the opponent; in a
 * two-against-two the followed player must be a TEAMMATE (a random
 * opponent is not evidence of playing together). A battle whose shape
 * the record cannot prove (a 2v2 type without four participants, any
 * other count) is left out, never guessed. Each own player is read as
 * its own range of its player/time cover, never `player_tag = any(...)`.
 */
export async function friendlyBattles(
  db,
  accountId,
  { now, after = "0", from = null, before = false, limit = RECONCILE.BATTLES },
) {
  const at = new Date(now).toISOString();
  from ??= new Date(
    Date.parse(at) - RECONCILE.LOOKBACK_DAYS * 86_400_000,
  ).toISOString();
  const { rows } = await db.query(
    `with own as (
       select player_tag from claim
        where account_id = $1::uuid and status = 'verified'
          and (is_primary or relationship in ('primary', 'alt'))),
     followed as (
       select player_tag from claim
        where account_id = $1::uuid and relationship = 'friend'
          and not is_primary
          and player_tag not in (select player_tag from own))
     select m.battle_id, m.battle_time, b.cursor::text as cursor,
            (b.created_at <= $3::timestamptz - make_interval(secs => $8::int))
              as settled
       from own
       cross join lateral (
         select bp.battle_id, bp.side, bp.battle_time, bp.type
           from battle_participant bp
          where bp.player_tag = own.player_tag
            and bp.battle_time >= $2::timestamptz
            and (bp.battle_time < $3::timestamptz
                 or (not $9::boolean and bp.battle_time = $3::timestamptz))
            and bp.type = any($4::text[])) m
       join battle b on b.battle_id = m.battle_id
       cross join lateral (
         select count(*)::int as n from battle_participant x
          where x.battle_id = m.battle_id) size
      where b.cursor > $5::bigint
        and exists (
          select 1 from battle_participant o
            join followed f on f.player_tag = o.player_tag
           where o.battle_id = m.battle_id
             and case
                   when size.n = 4 then o.side = m.side
                   when size.n = 2 and not (m.type = any($6::text[]))
                     then o.side <> m.side
                   else false
                 end)
      order by b.cursor, m.battle_id
      limit $7::int`,
    [
      accountId,
      from,
      at,
      [...FRIENDLY_TYPES, ...CLANMATE_TYPES],
      after,
      TEAM_TYPES,
      limit,
      Math.round(RECONCILE.SETTLED_MS / 1000),
      before,
    ],
  );
  return rows;
}

/**
 * Played Together days from the battles recorded since the checkpoint.
 * One local day counts once whatever the wins, the games or the number
 * of friends; a day the stored facts already hold (by its frozen
 * bounds) is skipped before the store is asked. Moves the checkpoint
 * past the settled battles it read. Returns { granted, more }.
 */
async function playedTogether(db, accountId, { now, budget }) {
  const facts = await storedFacts(db, accountId, "played_together");
  if (facts.length >= FACT_CAPS.played_together)
    return { granted: [], more: false };
  const {
    rows: [mark],
  } = await db.query(
    `select coalesce(played_cursor, 0)::text as cursor, played_epoch
       from account_passport where account_id = $1::uuid`,
    [accountId],
  );
  const rows = await friendlyBattles(db, accountId, {
    now,
    after: mark?.cursor ?? "0",
  });
  const zone = await accountZone(db, accountId);
  const inStoredDay = (t) =>
    facts.some(
      (f) =>
        f.day_starts_at &&
        t >= new Date(f.day_starts_at).getTime() &&
        t < new Date(f.day_ends_at).getTime(),
    );
  const tried = new Set();
  const granted = [];
  let capped = false;
  for (const r of rows) {
    const t = new Date(r.battle_time).getTime();
    const day = localDay(new Date(t), zone);
    if (tried.has(day) || inStoredDay(t) || budget.left <= 0) continue;
    tried.add(day);
    budget.left -= 1;
    const out = await earnFact(
      db,
      accountId,
      {
        stamp_id: "played_together",
        source: `battle:${r.battle_id}`,
        event_at: r.battle_time,
      },
      { now },
    );
    granted.push(...out.granted);
    if (out.reason === "capped") {
      capped = true;
      break;
    }
  }
  // The checkpoint: the last battle of the leading run of settled ones,
  // when the fact budget did not stop the walk before it.
  let through = null;
  for (const r of rows) {
    if (!r.settled) break;
    const day = localDay(new Date(r.battle_time), zone);
    if (
      !capped &&
      !tried.has(day) &&
      !inStoredDay(new Date(r.battle_time).getTime())
    )
      break;
    through = r.cursor;
  }
  if (capped && rows.length) through = rows.at(-1).cursor;
  // Only within the generation this pass read: a rewind since (the
  // account's players changed mid-pass) wins, and the next pass reads
  // the window again. Facts this pass recorded stay; they were true.
  if (through !== null && mark)
    await db.query(
      `update account_passport
          set played_cursor = greatest(coalesce(played_cursor, 0), $2::bigint)
        where account_id = $1::uuid and played_epoch = $3::int`,
      [accountId, through, mark.played_epoch],
    );
  return {
    granted,
    more: !capped && (rows.length >= RECONCILE.BATTLES || budget.left <= 0),
  };
}

/**
 * Forget the Played Together checkpoint, after the account's own or
 * followed players changed (a follow, an alt, a verification): the
 * battles already read were judged against the old set, so the next
 * reconciliation reads the look-back window again from the start. The
 * facts already held stay; reading again only adds days the new set
 * proves. The epoch counts up on every rewind, even of a null cursor, so
 * a pass that started before it (and read the old set) cannot move the
 * checkpoint after it: the pass writes only within the epoch it read.
 */
export async function rewindPlayed(db, accountId) {
  await db.query(
    `update account_passport
        set played_cursor = null, played_epoch = played_epoch + 1
      where account_id = $1::uuid`,
    [accountId],
  );
}

/**
 * The owner's reconciliation, `POST /api/me/passport/reconcile`.
 * `placeSaved` (optional, async () => boolean) answers whether the
 * person has a place on the clan map now: asked only while On the Map's
 * save is not latched, to repair a place save whose hook failed. Only
 * the boolean is read; no place is stored.
 *
 * Returns { granted, more } (more: the bound stopped the pass early;
 * call again), or null for an account that is not a person.
 */
export async function reconcilePassport(
  db,
  accountId,
  { now, placeSaved = null },
) {
  const passport = await ensurePassport(db, accountId);
  if (!passport) return null;
  const budget = { left: RECONCILE.FACTS };
  let latch = null;
  if (placeSaved) {
    const {
      rows: [list],
    } = await db.query(
      `select map_place_saved_at from account_profile_list
        where account_id = $1::uuid`,
      [accountId],
    );
    if (!list?.map_place_saved_at && (await placeSaved()))
      latch = { map_choice: "place", place_saved: true };
  }
  const told = await storytellerFromPosts(db, accountId, {
    now,
    budget,
  });
  const played = await playedTogether(db, accountId, { now, budget });
  const settled = await settlePassport(db, accountId, { now, latch });
  await db.query(
    `update account_passport set reconciled_at = $2::timestamptz
      where account_id = $1::uuid`,
    [accountId, new Date(now).toISOString()],
  );
  return {
    granted: [...told, ...played.granted, ...(settled.granted ?? [])],
    more: played.more,
  };
}
