/**
 * The passport store: the one module that writes and reads passports,
 * earned Stamps, ladder facts and the profile list (migration 0269). The
 * web API's routes and, in later slices, the mutation hooks and the
 * owner's reconciliation call these; nothing else writes the tables.
 *
 * Each function takes a connected client (`db.query`), one connection
 * that carries nothing else at the same time (a route's leased client),
 * and must be called OUTSIDE a transaction: the writers open their own, so a Stamp is only
 * ever granted after the caller's own write has committed ("earn only
 * after the real write succeeds"). Writers serialize per account on the
 * passport row (`select ... for update`), so concurrent calls from two
 * Home tabs, a hook and a reconciliation cannot double-grant, insert
 * past a ladder's cap or race a fact into two days.
 *
 * Times come in as an explicit `now` (a Date or ISO string) from the
 * server, never from a browser. pg returns bigint as strings and dates as
 * Date objects, so every day leaves SQL through to_char and every count
 * through ::int, and every parameter is cast where it is used.
 */
import { createHash, randomInt } from "node:crypto";
import {
  CATALOG_VERSION,
  COUNTING,
  DIGEST_CHOICES,
  FACT_CAPS,
  MAP_CHOICES,
  PROFILE_STEPS,
  levelCount,
  levelFor,
  stampById,
} from "./catalog.mjs";
import { evaluatePassport } from "./eligibility.mjs";
import { publicEarned, publicPassport, summarize } from "./projection.mjs";

/** Twelve characters with no look-alikes (no l, o, 0 or 1): about 59
 *  bits, so ids cannot be walked. Matches 0269's check. */
const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
export const PASSPORT_ID = /^[a-km-np-z2-9]{12}$/;

export function newPassportId() {
  let id = "";
  for (let i = 0; i < 12; i++) id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return id;
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

const isoOf = (now) => {
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime()))
    throw new TypeError("an explicit now is required");
  return d.toISOString();
};

/**
 * The account's passport id, made on first call for a person account.
 * Returns { passport_id, created }, or null for an account that is not a
 * person (agents and integrations never get one).
 * Idempotent and safe to race: one row per account.
 */
export async function ensurePassport(db, accountId) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { rows } = await db.query(
        `insert into account_passport (account_id, passport_id)
         select account_id, $2::text from account
          where account_id = $1::uuid and kind = 'person'
         on conflict (account_id) do nothing
         returning passport_id`,
        [accountId, newPassportId()],
      );
      if (rows[0]) return { passport_id: rows[0].passport_id, created: true };
      const held = await db.query(
        `select passport_id from account_passport where account_id = $1::uuid`,
        [accountId],
      );
      return held.rows[0]
        ? { passport_id: held.rows[0].passport_id, created: false }
        : null;
    } catch (err) {
      // A random id taken by another account: draw again.
      if (err?.code === "23505" && /passport_id/.test(err.constraint ?? ""))
        continue;
      throw err;
    }
  }
  throw new Error("could not draw a free passport id");
}

/** The passport id an account already has, or null. Never writes. */
export async function passportIdOf(db, accountId) {
  const { rows } = await db.query(
    `select passport_id from account_passport where account_id = $1::uuid`,
    [accountId],
  );
  return rows[0]?.passport_id ?? null;
}

/** The account's zone if PostgreSQL knows it, else UTC. Read outside any
 *  transaction: a bad zone is an error, which would abort one. */
export async function accountZone(db, accountId) {
  const { rows } = await db.query(
    `select timezone from account where account_id = $1::uuid`,
    [accountId],
  );
  const zone = rows[0]?.timezone;
  if (!zone) return "UTC";
  try {
    await db.query(`select now() at time zone $1::text`, [zone]);
    return zone;
  } catch {
    return "UTC";
  }
}

/** Run `fn` in a transaction holding the account's passport row. Makes
 *  the passport first. Returns null (nothing run) for a non-person. */
async function withPassportLock(db, accountId, fn) {
  const passport = await ensurePassport(db, accountId);
  if (!passport) return null;
  await db.query("begin");
  try {
    await db.query(
      `select 1 from account_passport where account_id = $1::uuid for update`,
      [accountId],
    );
    const out = await fn(passport);
    await db.query("commit");
    return out;
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

/** Every level from 1 to each asked level, validated against the
 *  catalog: a ladder's level 3 brings 1 and 2 with it. */
function expandGrants(grants) {
  const out = new Map();
  for (const g of grants ?? []) {
    const def = stampById(g?.stamp_id);
    const level = Number(g?.level);
    if (!def) throw new TypeError(`unknown stamp: ${g?.stamp_id}`);
    if (!Number.isInteger(level) || level < 1 || level > levelCount(def.id))
      throw new TypeError(`bad level ${g?.level} for ${def.id}`);
    for (let l = 1; l <= level; l++) out.set(`${def.id}#${l}`, [def.id, l]);
  }
  return [...out.values()];
}

/**
 * Grant levels. Idempotent: unique (account, Stamp, level), so a retry or
 * a racing call inserts nothing twice. Returns { granted } with ONLY the
 * newly inserted levels, [{ stamp_id, level, earned_at, earned_on }], the
 * caller's cue for a bell notice; or { refused: "not_person" }.
 * earned_on is the local day of `now` in the account's zone, frozen.
 *
 * `legacy` (the launch instant, legacy.mjs) writes legacy rows instead:
 * evidence from before launch, no trustworthy day, so earned_on is null,
 * legacy_before is the launch's local day in the account's zone ("Earned
 * before <day>") and legacy_source_to the launch instant. Such a row is
 * never a bell notice. A level already held, either kind, is left as it
 * is: nothing is ever rewritten.
 */
export async function grantStamps(
  db,
  accountId,
  grants,
  { now, legacy = null },
) {
  const at = isoOf(now);
  const launch = legacy === null ? null : isoOf(legacy);
  const pairs = expandGrants(grants);
  if (!pairs.length) return { granted: [] };
  const zone = await accountZone(db, accountId);
  const out = await withPassportLock(db, accountId, async () => {
    const { rows } = await db.query(
      `insert into account_stamp_earned
         (account_id, stamp_id, level, earned_at, earned_on, definition_version,
          legacy_before, legacy_source_to)
       select $1::uuid, g.stamp_id, g.level, $4::timestamptz,
              case when $7::timestamptz is null
                   then ($4::timestamptz at time zone $5::text)::date end,
              $6::int,
              ($7::timestamptz at time zone $5::text)::date,
              $7::timestamptz
         from unnest($2::text[], $3::smallint[]) as g(stamp_id, level)
       on conflict (account_id, stamp_id, level) do nothing
       returning stamp_id, level, earned_at,
                 to_char(earned_on, 'YYYY-MM-DD') as earned_on,
                 to_char(legacy_before, 'YYYY-MM-DD') as earned_before`,
      [
        accountId,
        pairs.map((p) => p[0]),
        pairs.map((p) => p[1]),
        at,
        zone,
        CATALOG_VERSION,
        launch,
      ],
    );
    return rows
      .map((r) => ({
        stamp_id: r.stamp_id,
        level: Number(r.level),
        earned_at: new Date(r.earned_at).toISOString(),
        earned_on: r.earned_on,
        ...(r.earned_before ? { earned_before: r.earned_before } : {}),
      }))
      .sort(
        (a, b) => a.stamp_id.localeCompare(b.stamp_id) || a.level - b.level,
      );
  });
  return out === null ? { refused: "not_person" } : { granted: out };
}

/**
 * Record one accepted source event toward a ladder (Played Together,
 * Cheerleader, Storyteller).
 *
 *   fact = {
 *     stamp_id,   'played_together' | 'cheerleader' | 'storyteller'
 *     source,     the source event's stable server-side identity, e.g.
 *                 'cheer:<id>', 'highlight:<id>', 'battle:<id>'; hashed
 *     event_at,   the source row's own stored instant, never a browser's
 *     battle_id,  Storyteller only: the canonical battle highlighted
 *   }
 *
 * One source event is accepted once. A day ladder's local day is taken
 * from the account's zone at first acceptance and stored with that day's
 * UTC bounds; an event inside a recorded day's bounds belongs to that day
 * whatever the zone is now, so a zone change never replays an event into
 * another day. Past the ladder's top threshold nothing more is stored.
 *
 * Returns { accepted, reason?, count, level }: reason is one of
 * duplicate_source, same_day, same_battle, capped, future; count is the
 * Stamp's stored facts after the call and level what that count reaches.
 * { refused: "not_person" } for an account with no passport to hold it.
 */
export async function recordFact(db, accountId, fact, { now }) {
  const at = Date.parse(isoOf(now));
  const def = stampById(fact?.stamp_id);
  if (!def || !(def.id in FACT_CAPS))
    throw new TypeError(`not a ladder stamp: ${fact?.stamp_id}`);
  if (typeof fact.source !== "string" || !fact.source)
    throw new TypeError("a fact needs its source event's identity");
  const eventMs = Date.parse(
    fact.event_at instanceof Date ? fact.event_at.toISOString() : fact.event_at,
  );
  if (!Number.isFinite(eventMs)) throw new TypeError("a fact needs event_at");
  const byBattle = def.counting === COUNTING.BATTLES;
  if (byBattle && (typeof fact.battle_id !== "string" || !fact.battle_id))
    throw new TypeError("a battle fact needs battle_id");
  const cap = FACT_CAPS[def.id];
  const sourceHash = sha256(`${def.id}\n${fact.source}`);
  const eventAt = new Date(eventMs).toISOString();
  const zone = byBattle ? null : await accountZone(db, accountId);

  const out = await withPassportLock(db, accountId, async () => {
    const counted = async () =>
      (
        await db.query(
          `select count(*)::int as n from account_stamp_fact
            where account_id = $1::uuid and stamp_id = $2::text`,
          [accountId, def.id],
        )
      ).rows[0].n;
    const answer = (accepted, count, reason) => ({
      accepted,
      ...(reason ? { reason } : {}),
      count,
      level: levelFor(def.id, count),
    });
    const before = await counted();
    if (eventMs > at) return answer(false, before, "future");
    const seen = await db.query(
      `select 1 from account_stamp_fact
        where account_id = $1::uuid and stamp_id = $2::text
          and source_hash = $3::text`,
      [accountId, def.id, sourceHash],
    );
    if (seen.rows.length) return answer(false, before, "duplicate_source");
    if (before >= cap) return answer(false, before, "capped");
    if (!byBattle) {
      const within = await db.query(
        `select 1 from account_stamp_fact
          where account_id = $1::uuid and stamp_id = $2::text
            and day_starts_at <= $3::timestamptz and day_ends_at > $3::timestamptz`,
        [accountId, def.id, eventAt],
      );
      if (within.rows.length) return answer(false, before, "same_day");
    }
    const inserted = byBattle
      ? await db.query(
          `insert into account_stamp_fact
             (account_id, stamp_id, qualifier, source_hash, event_at)
           values ($1::uuid, $2::text, $3::text, $4::text, $5::timestamptz)
           on conflict do nothing returning 1`,
          [
            accountId,
            def.id,
            `battle:${sha256(fact.battle_id)}`,
            sourceHash,
            eventAt,
          ],
        )
      : await db.query(
          `with d as (
             select ($4::timestamptz at time zone $5::text)::date as day)
           insert into account_stamp_fact
             (account_id, stamp_id, qualifier, source_hash, event_at,
              local_day, day_starts_at, day_ends_at)
           select $1::uuid, $2::text, 'day:' || to_char(d.day, 'YYYY-MM-DD'),
                  $3::text, $4::timestamptz, d.day,
                  d.day::timestamp at time zone $5::text,
                  (d.day + 1)::timestamp at time zone $5::text
             from d
           on conflict do nothing returning 1`,
          [accountId, def.id, sourceHash, eventAt, zone],
        );
    if (!inserted.rows.length)
      return answer(false, before, byBattle ? "same_battle" : "same_day");
    return answer(true, before + 1);
  });
  return out === null ? { refused: "not_person" } : out;
}

const LATCH_COLUMNS = Object.freeze({
  add_player: "add_player_at",
  verify_player: "verify_player_at",
  picture: "picture_at",
  follow_active: "follow_active_at",
  digest: "digest_at",
  map: "map_at",
});

/**
 * Latch profile-list state after a successful write (later slices' hooks):
 *   { steps: ['picture', ...],         latch these steps done
 *     digest_choice: 'weekly'|'daily'|'off',  an explicit digest choice
 *     map_choice: 'place'|'not_now',   an explicit map choice
 *     place_saved: true,               a place save that succeeded
 *     complete: true }                 the list finished (set once)
 * A latch keeps its first instant; the choices keep the latest. Returns
 * the stored row's public-safe fields, or null for a non-person.
 */
export async function latchProfile(db, accountId, patch, { now }) {
  const at = isoOf(now);
  const steps = new Set(patch?.steps ?? []);
  for (const s of steps)
    if (!(s in LATCH_COLUMNS)) throw new TypeError(`unknown step: ${s}`);
  const digest = patch?.digest_choice ?? null;
  if (digest !== null && !DIGEST_CHOICES.includes(digest))
    throw new TypeError(`bad digest choice: ${digest}`);
  const map = patch?.map_choice ?? null;
  if (map !== null && !MAP_CHOICES.includes(map))
    throw new TypeError(`bad map choice: ${map}`);
  if (digest) steps.add("digest");
  if (map) steps.add("map");
  const placeSaved = patch?.place_saved === true;
  const complete = patch?.complete === true;
  const latch = (step) => steps.has(step);
  const { rows } = await db.query(
    `insert into account_profile_list as l
       (account_id, add_player_at, verify_player_at, picture_at,
        follow_active_at, digest_choice, digest_at, map_choice, map_at,
        map_place_saved_at, completed_at, updated_at)
     select a.account_id,
            case when $2::boolean then $12::timestamptz end,
            case when $3::boolean then $12::timestamptz end,
            case when $4::boolean then $12::timestamptz end,
            case when $5::boolean then $12::timestamptz end,
            $8::text,
            case when $6::boolean then $12::timestamptz end,
            $9::text,
            case when $7::boolean then $12::timestamptz end,
            case when $10::boolean then $12::timestamptz end,
            case when $11::boolean then $12::timestamptz end,
            $12::timestamptz
       from account a where a.account_id = $1::uuid and a.kind = 'person'
     on conflict (account_id) do update set
       add_player_at = coalesce(l.add_player_at, excluded.add_player_at),
       verify_player_at = coalesce(l.verify_player_at, excluded.verify_player_at),
       picture_at = coalesce(l.picture_at, excluded.picture_at),
       follow_active_at = coalesce(l.follow_active_at, excluded.follow_active_at),
       digest_choice = coalesce(excluded.digest_choice, l.digest_choice),
       digest_at = coalesce(l.digest_at, excluded.digest_at),
       map_choice = coalesce(excluded.map_choice, l.map_choice),
       map_at = coalesce(l.map_at, excluded.map_at),
       map_place_saved_at = coalesce(l.map_place_saved_at, excluded.map_place_saved_at),
       completed_at = coalesce(l.completed_at, excluded.completed_at),
       updated_at = excluded.updated_at
     returning list_version, digest_choice, map_choice,
               (map_place_saved_at is not null) as place_saved,
               (completed_at is not null) as complete`,
    [
      accountId,
      latch("add_player"),
      latch("verify_player"),
      latch("picture"),
      latch("follow_active"),
      latch("digest"),
      latch("map"),
      digest,
      map,
      placeSaved,
      complete,
      at,
    ],
  );
  return rows[0] ?? null;
}

/** The account's primary claim as the public projection takes it. */
async function readPrimary(db, accountId) {
  const { rows } = await db.query(
    `select c.player_tag as tag, p.name, (c.status = 'verified') as verified,
            a.avatar_card_id
       from claim c
       join account a on a.account_id = c.account_id
       left join player p on p.player_tag = c.player_tag
      where c.account_id = $1::uuid and c.is_primary`,
    [accountId],
  );
  return rows[0] ?? null;
}

export async function readEarned(db, accountId) {
  const { rows } = await db.query(
    `select stamp_id, level::int as level,
            to_char(earned_on, 'YYYY-MM-DD') as earned_on,
            to_char(legacy_before, 'YYYY-MM-DD') as legacy_before
       from account_stamp_earned where account_id = $1::uuid
      order by stamp_id, level`,
    [accountId],
  );
  return rows;
}

/**
 * Someone's public passport by its id, for any signed-in member: the
 * projection in projection.mjs, or null when no approved person account
 * holds the id. Never writes, never grants.
 */
export async function readPublicPassport(db, passportId) {
  if (typeof passportId !== "string" || !PASSPORT_ID.test(passportId))
    return null;
  const { rows } = await db.query(
    `select p.account_id, p.passport_id
       from account_passport p join account a on a.account_id = p.account_id
      where p.passport_id = $1::text and a.kind = 'person'
        and a.status = 'approved'`,
    [passportId],
  );
  if (!rows[0]) return null;
  const { account_id: accountId } = rows[0];
  return publicPassport({
    passport_id: rows[0].passport_id,
    primary: await readPrimary(db, accountId),
    earned: await readEarned(db, accountId),
  });
}

/**
 * The passport of the player's canonical verified owner in one row, for a
 * player's page: `{ id, count, marks }` (projection.mjs summarize), or null.
 * The owner is the same as @elixir-mcp/tools/social verifiedAccount: the
 * person account whose verified primary or alt claim is the player, so a
 * main and an alt give the same passport. The conditions match
 * readPublicPassport (an approved person account holding the passport),
 * and the earned rows pass the public whitelist before they are counted.
 * One statement, for the page's statement budget. Never writes: an owner
 * with no passport row yet is null.
 */
export async function readPlayerPassport(db, tag) {
  const { rows } = await db.query(
    `select ap.passport_id,
            coalesce(
              json_agg(json_build_object(
                'stamp_id', e.stamp_id,
                'level', e.level,
                'earned_on', to_char(e.earned_on, 'YYYY-MM-DD'),
                'legacy_before', to_char(e.legacy_before, 'YYYY-MM-DD')))
                filter (where e.stamp_id is not null),
              '[]') as earned
       from (select c.account_id
               from claim c join account a using (account_id)
              where c.player_tag = $1 and c.status = 'verified'
                and (c.is_primary or c.relationship in ('primary', 'alt'))
                and coalesce(a.kind, 'person') = 'person'
              order by c.verified_at limit 1) owner
       join account a on a.account_id = owner.account_id
        and a.kind = 'person' and a.status = 'approved'
       join account_passport ap on ap.account_id = owner.account_id
       left join account_stamp_earned e on e.account_id = owner.account_id
      group by ap.passport_id`,
    [tag],
  );
  const row = rows[0];
  if (!row) return null;
  return summarize({
    id: String(row.passport_id),
    earned: publicEarned(row.earned),
  });
}

/**
 * Everything eligibility needs about one account at `now`, read in a few
 * statements (eligibility.mjs documents the shape). Reads only.
 *
 * Followed players' activity is read per follow with a lateral subquery
 * on (player_tag, battle_time), never `player_tag = any($1)`. The map
 * step and On the Map read only the profile list's stored choice and
 * place-save latch: the place itself is Clan's private state and is not
 * read here.
 */
export async function readSnapshot(db, accountId, { now }) {
  const at = isoOf(now);
  const {
    rows: [acct],
  } = await db.query(
    `select a.kind, a.avatar_card_id, a.welcome_finished_at,
            exists (select 1 from account_discord d
                     where d.account_id = a.account_id) as discord_linked,
            (select json_build_object('enabled', enabled,
                                      'cadence', coalesce(cadence, 'weekly'))
               from account_email_pref
              where account_id = a.account_id and kind = 'tracking_report'
                and via <> 'ops') as digest
       from account a where a.account_id = $1::uuid`,
    [accountId],
  );
  if (!acct) return null;
  const {
    rows: [own],
  } = await db.query(
    `select bool_or(is_primary) as has_primary,
            bool_or(is_primary and status = 'verified') as primary_verified,
            bool_or((is_primary or relationship in ('primary', 'alt'))
                    and status = 'verified') as own_verified,
            bool_or(relationship = 'alt' and not is_primary) as has_alt
       from claim where account_id = $1::uuid`,
    [accountId],
  );
  const { rows: follows } = await db.query(
    `select c.player_tag,
            (select max(bp.battle_time) from battle_participant bp
              where bp.player_tag = c.player_tag
                and bp.battle_time <= $2::timestamptz
                and bp.battle_time >= $2::timestamptz - interval '7 days')
              as last_battle_at,
            (select ps.last_admitted_at from poll_state ps
              where ps.subject_tag = c.player_tag
                and ps.endpoint = 'player_battlelog') as battle_log_read_at
       from claim c
      where c.account_id = $1::uuid and c.relationship = 'friend'
        and not c.is_primary`,
    [accountId, at],
  );
  const {
    rows: [mutual],
  } = await db.query(
    `select count(distinct v.account_id)::int as n
       from claim mine
       join claim v on v.player_tag = mine.player_tag
        and v.status = 'verified'
        and (v.is_primary or v.relationship in ('primary', 'alt'))
       join account va on va.account_id = v.account_id
        and coalesce(va.kind, 'person') = 'person'
      where mine.account_id = $1::uuid and mine.relationship = 'friend'
        and not mine.is_primary and v.account_id <> $1::uuid
        and exists (
          select 1 from claim back
            join claim mine2 on mine2.player_tag = back.player_tag
           where back.account_id = v.account_id
             and back.relationship = 'friend' and not back.is_primary
             and mine2.account_id = $1::uuid and mine2.status = 'verified'
             and (mine2.is_primary or mine2.relationship in ('primary', 'alt')))`,
    [accountId],
  );
  const { rows: facts } = await db.query(
    `select stamp_id, count(*)::int as n from account_stamp_fact
      where account_id = $1::uuid group by stamp_id`,
    [accountId],
  );
  const {
    rows: [list],
  } = await db.query(
    `select add_player_at, verify_player_at, picture_at, follow_active_at,
            digest_choice, digest_at, map_choice, map_at, map_place_saved_at,
            completed_at
       from account_profile_list where account_id = $1::uuid`,
    [accountId],
  );
  const earned = await readEarned(db, accountId);
  const iso = (v) => (v ? new Date(v).toISOString() : null);
  const pref = acct.digest;
  const prefChoice = pref
    ? pref.enabled === false
      ? "off"
      : DIGEST_CHOICES.includes(pref.cadence)
        ? pref.cadence
        : "weekly"
    : null;
  const factCount = Object.fromEntries(
    Object.keys(FACT_CAPS).map((id) => [
      id,
      facts.find((f) => f.stamp_id === id)?.n ?? 0,
    ]),
  );
  const latches = Object.fromEntries(
    PROFILE_STEPS.map(({ id }) => [id, iso(list?.[LATCH_COLUMNS[id]])]),
  );
  latches.completed_at = iso(list?.completed_at);
  return {
    person: acct.kind === "person",
    primary: own.has_primary
      ? { verified: own.primary_verified === true }
      : null,
    own_verified: own.own_verified === true,
    has_alt: own.has_alt === true,
    picture_chosen: acct.avatar_card_id != null || Boolean(list?.picture_at),
    discord_linked: acct.discord_linked === true,
    // The person's own latest choice; an older digest setting of their
    // own (not an operator's) counts, as Home's welcome reads it.
    digest_choice: list?.digest_choice ?? prefChoice,
    map: {
      choice: list?.map_choice ?? null,
      place_saved: Boolean(list?.map_place_saved_at),
    },
    follows: follows.map((f) => ({
      last_battle_at: iso(f.last_battle_at),
      battle_log_read_at: iso(f.battle_log_read_at),
    })),
    mutual_count: mutual.n,
    facts: factCount,
    latches,
    earned,
    legacy_welcome_finished: Boolean(acct.welcome_finished_at),
  };
}

/**
 * The owner's passport: the public projection plus the profile list and
 * exact progress, for the account itself only. Ensures the owner's own
 * passport row (the one write a read may make, and only for the caller's
 * own account). Never grants: eligible levels wait for a hook or the
 * owner's reconciliation. Null for a non-person.
 *
 *   {
 *     passport, catalog_version,            as the public read
 *     owner: {
 *       profile: { version, complete, completed_at, steps: [{ id, state, latched }],
 *                  older_welcome_finished },
 *       stamps: [{ stamp_id, earned_level, progress: { count, next, top, unknown, pending? } }]
 *     }
 *   }
 */
export async function readOwnerPassport(db, accountId, { now }) {
  const passport = await ensurePassport(db, accountId);
  if (!passport) return null;
  const snapshot = await readSnapshot(db, accountId, { now });
  if (!snapshot) return null;
  const evaluation = evaluatePassport(snapshot, now);
  return {
    ...publicPassport({
      passport_id: passport.passport_id,
      primary: await readPrimary(db, accountId),
      earned: snapshot.earned,
    }),
    owner: {
      profile: {
        ...evaluation.profile,
        older_welcome_finished: snapshot.legacy_welcome_finished,
      },
      stamps: evaluation.stamps.map((s) => ({
        stamp_id: s.stamp_id,
        earned_level: s.earned_level,
        progress: s.progress,
      })),
    },
  };
}
