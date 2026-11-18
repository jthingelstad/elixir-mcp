/**
 * The launch line (#1015, migration 0272): what an account earned before
 * Stamps went live is a legacy grant, "Earned before <launch day>", and
 * never a "New Stamp" line in the bell, whichever of the account's first
 * hook, its reconciliation or the operator's {passport_backfill} runs
 * first after the deploy.
 *
 * The rule, one for every path: a level is legacy when the evidence that
 * stood at the launch instant already reaches it. Everything else is an
 * ordinary grant, a bell line.
 *
 *  - Setup Stamps (Player verified, Looking Good, On the Map, Full
 *    Roster, Linked, Inner Circle, Mutual, All Set): the account is
 *    evaluated once as it stood at launch (readLaunchSnapshot), by its
 *    rows' own instants: a claim made and verified before launch, a
 *    picture set before it, a Discord link, a digest choice and a place
 *    saved before it, follows made before it and their battles in the
 *    seven days before it. Those levels are written as legacy rows, then
 *    legacy_settled_at is set (settleLegacy). The settle that follows
 *    grants what is left as ordinary, so a verification made after launch
 *    is a bell line even when it is the account's first earning call.
 *  - Ladders (Played Together, Cheerleader, Storyteller): by the stored
 *    facts' own event instants. A level is legacy when the facts dated
 *    before launch reach its threshold (splitByLaunch); a level a fact
 *    from after launch completes is ordinary.
 *  - Accounts made after launch have nothing before it: every grant is
 *    ordinary, as it always was.
 *
 * Reads only the account's own rows, per account; the place is read from
 * Clan's store as its save instant, never as a place.
 */
import { visibleFriendSql } from "@elixir-mcp/claims";
import { readOwnedPlaces } from "@elixir-mcp/auth/clan-context";
import {
  ACTIVE_WINDOW_DAYS,
  COUNTING,
  DIGEST_CHOICES,
  FACT_CAPS,
  levelFor,
  stampById,
} from "./catalog.mjs";
import { evaluatePassport } from "./eligibility.mjs";
import { ensurePassport, grantStamps, readEarned } from "./store.mjs";

const iso = (v) => (v ? new Date(v).toISOString() : null);

/**
 * The launch as it applies to one account: { launched_at (ISO), pre
 * (the account was made before launch), settled (its setup Stamps were
 * already settled as of launch), history (the operator's backfill has
 * read its ladder history before launch, 0273, or the account was
 * approved after launch: until then it could not sign in, so it has no
 * follows, cheers or battle posts from before launch to read) }, or null
 * when there is no launch row (a database before 0272) or no such
 * account. Every move from requested to approved sets decided_at
 * (packages/auth gate.mjs); an account with none waits, the safe side.
 */
export async function readLaunch(db, accountId) {
  const { rows } = await db.query(
    `select l.launched_at, (a.created_at < l.launched_at) as pre,
            (p.legacy_settled_at is not null) as settled,
            (p.legacy_history_at is not null
              or a.decided_at >= l.launched_at) as history
       from passport_launch l
       join account a on a.account_id = $1::uuid
       left join account_passport p on p.account_id = a.account_id`,
    [accountId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    launched_at: iso(r.launched_at),
    pre: r.pre === true,
    settled: r.settled === true,
    history: r.history === true,
  };
}

/** Whether any of these players had a place on the clan map saved before
 *  `at`. Only the save instant is read; the place never leaves Clan's
 *  store. A place saved again after launch has a later instant, and is
 *  then not known to predate it. */
async function placeSavedBefore(db, tags, at) {
  if (tags.length === 0) return false;
  // Only places these players' current claims wrote (2026-11-14).
  const places = await readOwnedPlaces(db, tags);
  const before = Date.parse(at);
  return places.some((p) => {
    const t = Date.parse(p?.set_at ?? "");
    return Number.isFinite(t) && t < before;
  });
}

/**
 * The account as it stood at `at` (the launch instant), in the snapshot
 * shape eligibility.mjs takes, from the instants the rows carry. A thing
 * whose time the record does not keep is taken as it is now when its row
 * predates launch (a claim's relationship, which primary): the safe
 * direction, since the worst case files a Stamp as legacy, quietly.
 * There are no profile-list latches at launch: that list began with it.
 */
export async function readLaunchSnapshot(db, accountId, at) {
  const {
    rows: [acct],
  } = await db.query(
    `select a.kind,
            (a.avatar_card_id is not null
              and coalesce(a.avatar_set_at, a.created_at) < $2::timestamptz)
              as picture,
            exists (select 1 from account_discord d
                     where d.account_id = a.account_id
                       and d.linked_at < $2::timestamptz) as discord,
            (select json_build_object('enabled', enabled,
                                      'cadence', coalesce(cadence, 'weekly'))
               from account_email_pref
              where account_id = a.account_id and kind = 'tracking_report'
                and via <> 'ops' and changed_at < $2::timestamptz) as digest
       from account a where a.account_id = $1::uuid`,
    [accountId, at],
  );
  if (!acct) return null;
  // Own claims made before launch; verified before it when the proof's
  // instant (verified_at, or the claim's own for one older than 0080)
  // predates it.
  const { rows: own } = await db.query(
    `select player_tag, is_primary,
            (relationship = 'alt' and not is_primary) as alt,
            (status = 'verified'
              and coalesce(verified_at, created_at) < $2::timestamptz)
              as verified
       from claim
      where account_id = $1::uuid and created_at < $2::timestamptz
        and (is_primary or relationship in ('primary', 'alt'))`,
    [accountId, at],
  );
  const primary = own.find((c) => c.is_primary) ?? null;
  const verifiedTags = own.filter((c) => c.verified).map((c) => c.player_tag);
  const { rows: follows } = await db.query(
    `select (select max(bp.battle_time) from battle_participant bp
              where bp.player_tag = c.player_tag
                and bp.battle_time < $2::timestamptz
                and bp.battle_time >= $2::timestamptz
                                      - make_interval(days => $3::int))
              as last_battle_at
       from claim c
      where c.account_id = $1::uuid and ${visibleFriendSql("c")} and c.created_at < $2::timestamptz`,
    [accountId, at, ACTIVE_WINDOW_DAYS],
  );
  const {
    rows: [mutual],
  } = await db.query(
    `select count(distinct v.account_id)::int as n
       from claim mine
       join claim v on v.player_tag = mine.player_tag
        and v.status = 'verified'
        and coalesce(v.verified_at, v.created_at) < $2::timestamptz
        and (v.is_primary or v.relationship in ('primary', 'alt'))
       join account va on va.account_id = v.account_id
        and coalesce(va.kind, 'person') = 'person'
      where mine.account_id = $1::uuid and ${visibleFriendSql("mine")} and mine.created_at < $2::timestamptz
        and v.account_id <> $1::uuid
        and exists (
          select 1 from claim back
            join claim mine2 on mine2.player_tag = back.player_tag
           where back.account_id = v.account_id
             and ${visibleFriendSql("back")}
             and back.created_at < $2::timestamptz
             and mine2.account_id = $1::uuid and mine2.status = 'verified'
             and coalesce(mine2.verified_at, mine2.created_at) < $2::timestamptz
             and (mine2.is_primary or mine2.relationship in ('primary', 'alt')))`,
    [accountId, at],
  );
  const { rows: facts } = await db.query(
    `select stamp_id, count(*)::int as n from account_stamp_fact
      where account_id = $1::uuid and event_at < $2::timestamptz
      group by stamp_id`,
    [accountId, at],
  );
  const placed = await placeSavedBefore(db, verifiedTags, at);
  const pref = acct.digest;
  const digest = pref
    ? pref.enabled === false
      ? "off"
      : DIGEST_CHOICES.includes(pref.cadence)
        ? pref.cadence
        : "weekly"
    : null;
  return {
    person: acct.kind === "person",
    primary: primary ? { verified: primary.verified === true } : null,
    own_verified: verifiedTags.length > 0,
    has_alt: own.some((c) => c.alt),
    picture_chosen: acct.picture === true,
    discord_linked: acct.discord === true,
    digest_choice: digest,
    map: { choice: placed ? "place" : null, place_saved: placed },
    follows: follows.map((f) => ({
      last_battle_at: iso(f.last_battle_at),
      battle_log_read_at: null,
    })),
    mutual_count: mutual.n,
    facts: Object.fromEntries(
      Object.keys(FACT_CAPS).map((id) => [
        id,
        facts.find((f) => f.stamp_id === id)?.n ?? 0,
      ]),
    ),
    latches: {},
    earned: await readEarned(db, accountId),
  };
}

/**
 * Settle the account's Stamps as they stood at launch, once: every level
 * the launch snapshot reaches is written as a legacy row, then
 * legacy_settled_at is set. A no-op for an account made after launch, or
 * one already settled. Safe to race: a level is inserted once, and the
 * marker is only set after the rows are in, so a concurrent settle that
 * sees it also sees them. Returns { legacy: [...granted rows] }.
 */
export async function settleLegacy(db, accountId, { now, launch = null }) {
  const line = launch ?? (await readLaunch(db, accountId));
  if (!line || !line.pre || line.settled) return { legacy: [] };
  if (!(await ensurePassport(db, accountId))) return { legacy: [] };
  const snapshot = await readLaunchSnapshot(db, accountId, line.launched_at);
  if (!snapshot?.person) return { legacy: [] };
  const evaluation = evaluatePassport(snapshot, line.launched_at);
  const out = evaluation.grants.length
    ? await grantStamps(db, accountId, evaluation.grants, {
        now,
        legacy: line.launched_at,
      })
    : { granted: [] };
  await db.query(
    `update account_passport
        set legacy_settled_at = coalesce(legacy_settled_at, $2::timestamptz)
      where account_id = $1::uuid`,
    [accountId, new Date(now).toISOString()],
  );
  return { legacy: out.granted ?? [] };
}

/** Each ladder's level as its facts dated before `at` reach it. */
async function ladderLevelsAt(db, accountId, stampIds, at) {
  const { rows } = await db.query(
    `select stamp_id, count(*)::int as n from account_stamp_fact
      where account_id = $1::uuid and stamp_id = any($2::text[])
        and event_at < $3::timestamptz
      group by stamp_id`,
    [accountId, stampIds, at],
  );
  return new Map(rows.map((r) => [r.stamp_id, levelFor(r.stamp_id, r.n)]));
}

/**
 * Split grants by the launch line: { legacy, ordinary }. Ladder levels
 * the pre-launch facts reach are legacy; setup Stamps are ordinary here
 * (settleLegacy has already filed the ones that stood at launch).
 *
 * For an account made before launch whose ladder history the backfill
 * has not read yet (0273), a ladder level that is not legacy is neither:
 * it waits. History not yet read (an older friendly, a battle post, a
 * cheer) may reach that level before launch, and an ordinary grant, a
 * bell line, can never be refiled. The facts stay; the account's next
 * earning call after the backfill grants it.
 */
export async function splitByLaunch(db, accountId, grants, line) {
  if (!line?.pre || !grants.length) return { legacy: [], ordinary: grants };
  const ladders = [
    ...new Set(
      grants
        .filter((g) => stampById(g.stamp_id)?.counting !== COUNTING.ONCE)
        .filter((g) => g.stamp_id in FACT_CAPS)
        .map((g) => g.stamp_id),
    ),
  ];
  if (!ladders.length) return { legacy: [], ordinary: grants };
  const at = await ladderLevelsAt(db, accountId, ladders, line.launched_at);
  const legacy = [];
  const ordinary = [];
  const ladder = new Set(ladders);
  for (const g of grants) {
    if ((at.get(g.stamp_id) ?? 0) >= g.level) legacy.push(g);
    else if (!ladder.has(g.stamp_id) || line.history) ordinary.push(g);
  }
  return { legacy, ordinary };
}

/**
 * Grant levels on either side of the launch line: the legacy ones first
 * (so an ordinary grant of a higher level, which brings the lower with
 * it, finds them held), then the ordinary ones. `onlyLegacy` (the
 * operator's backfill) leaves the ordinary ones for the account's own
 * next earning call. Returns { granted (ordinary, bell lines), legacy }.
 */
export async function grantAcrossLaunch(
  db,
  accountId,
  grants,
  { now, onlyLegacy = false, line = null },
) {
  const launch = line ?? (await readLaunch(db, accountId));
  const { legacy, ordinary } = await splitByLaunch(
    db,
    accountId,
    grants,
    launch,
  );
  const old = legacy.length
    ? await grantStamps(db, accountId, legacy, {
        now,
        legacy: launch.launched_at,
      })
    : { granted: [] };
  if (old.refused) return { refused: old.refused, granted: [], legacy: [] };
  const fresh =
    ordinary.length && !onlyLegacy
      ? await grantStamps(db, accountId, ordinary, { now })
      : { granted: [] };
  if (fresh.refused) return { refused: fresh.refused, granted: [], legacy: [] };
  return { granted: fresh.granted, legacy: old.granted };
}
