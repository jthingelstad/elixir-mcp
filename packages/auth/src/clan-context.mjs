/** Approved private-context seam. Public game tools never read private Clan
 * state. Two readers, each authorizing and projecting in one statement:
 * `readOwnClanView` gives a person their own view of one clan (#535);
 * `readClanDirectory` gives a signed-in person, or an agent reading for its
 * approved owner (12.0.0), the clan directory's tiles, the policy's public
 * part only (#768). People's places (`place#<tag>` rows) are read here
 * too, under one rule: a place belongs to the claim that wrote it
 * (`placeOwnedBy`), for Clan's own view and clan map (`readOwnedPlaces`),
 * the player map and Near you. The agent policy-context reader retired with
 * `clans_context` in 12.0.0, and its grant storage and op in 0256
 * (DECISIONS "`clans_context` retires"). */
import { ELIXIR_ORIGIN } from "@elixir-mcp/contracts";
import {
  actionsWaitingFor,
  countedCategories,
  effectivePolicyValues,
  ownStandingLine,
  policySummaryOf,
} from "@elixir-mcp/clan-engine";

// ---- a person's own view of their clan (#535) ------------------------------

/** Clan's roles, highest first: the read acts as the person's verified player
 *  with the highest in-game role in the clan (Clan's own order, `clansOf`). */
const ROLE_ORDER = ["leader", "coLeader", "elder", "member"];

// Authorization and projection in one statement, so one snapshot: the
// person's verified own claims (primary or alt) with open membership in the
// clan, then, only when there is one, the policy, the clan's size, the saved
// verdict snapshot and the open Actions. A caller who is refused never reads
// a private row. A tag has one verified claim (claim_one_verified_per_tag),
// so an unverified claimant of a verified tag is not in `who`.
const OWN_VIEW_SQL = `
with who as (
  select c.player_tag, m.role, c.is_primary
    from account a
    join claim c on c.account_id = a.account_id
    join clan_membership m on m.player_tag = c.player_tag
   where a.account_id = $1 and a.kind = 'person' and a.status = 'approved'
     and c.status = 'verified'
     and (c.is_primary or c.relationship in ('primary', 'alt'))
     and m.clan_tag = $2 and m.left_observed_at is null
     and m.role in ('member','elder','coLeader','leader')
), allowed as (
  select exists (select 1 from who) as ok
), pointer as (
  select s.body from clan_state s, allowed
   where allowed.ok and s.pk = 'policy#' || $2
)
select
  (select coalesce(jsonb_agg(jsonb_build_object(
            'player_tag', player_tag, 'role', role, 'is_primary', is_primary)),
          '[]'::jsonb) from who) as who,
  (select p.body from clan_state p join pointer
      on p.pk = 'policy#' || $2 || '#v' || (pointer.body ->> 'version')) as policy,
  (select s.body from clan_state s, allowed
    where allowed.ok and s.pk = 'clan_size#' || $2) as size,
  (select s.body -> 'snapshot' from clan_state s, allowed
    where allowed.ok and s.pk = 'verdicts#' || $2) as verdicts,
  (select coalesce(jsonb_agg(s.body), '[]'::jsonb) from clan_state s, allowed
    where allowed.ok and s.partition_key = 'clan#' || $2
      and starts_with(s.sort_key, 'card#')
      and s.body ->> 'status' = 'proposed') as cards`;

/** Clan's page for one Action, or the clan's Feed, where Actions wait, for
 *  one not numbered. */
const actionUrl = (clanTag, number) =>
  `${ELIXIR_ORIGIN}/clan/${clanTag.replace(/^#/, "")}/${
    Number.isInteger(number) ? `actions/${number}` : "feed"
  }`;

/**
 * A person's own view of one clan in Clan, for their own connection
 * (Jamie, 2026-10-12, #535): the policy summary, their own standing line and
 * the Actions waiting for them, each a summary line with a url. Never another
 * member's line or clock, never a removal Action, never evidence, a log or a
 * decision; reads only the saved snapshot and writes nothing.
 *
 * `{ refused: "not_a_person" }` for an agent or an integration (the person's
 * own connection only, never an owned agent); `{ refused: "not_verified_member" }`
 * when none of the person's verified own players is a current member;
 * otherwise `{ view }`.
 */
export async function readOwnClanView(db, account, clanTag) {
  if ((account?.kind ?? null) !== "person" || !account.accountId)
    return { refused: "not_a_person" };
  const { rows } = await db.query(OWN_VIEW_SQL, [account.accountId, clanTag]);
  const row = rows[0];
  const players = row?.who ?? [];
  if (players.length === 0) return { refused: "not_verified_member" };
  const acting = [...players].sort(
    (a, b) =>
      ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
      (b.is_primary === true) - (a.is_primary === true) ||
      (a.player_tag < b.player_tag ? -1 : 1),
  )[0];
  const who = { player_tag: acting.player_tag, role: acting.role };
  const set = Boolean(row.policy);
  const version = set ? Number(row.policy.version) : null;
  if (set && (!Number.isSafeInteger(version) || version < 1))
    throw new Error("Invalid policy revision");
  const values = effectivePolicyValues(set ? row.policy.values : null);
  const members = Number.isInteger(row.size?.members) ? row.size.members : null;
  const policy = {
    ...policySummaryOf({ set, version, values, members }),
    version,
  };
  const verdicts = row.verdicts ?? null;
  const line =
    policy.active && verdicts && verdicts.policy_version === version
      ? ownStandingLine({
          verdicts,
          playerTag: who.player_tag,
          values,
          version,
        })
      : null;
  const reason = !set
    ? "no_policy"
    : !policy.active
      ? "too_few_members"
      : !line
        ? "not_evaluated"
        : null;
  let standing = null;
  let actions = null;
  if (reason === null) {
    const { version: policyVersion, ...rest } = line;
    standing = {
      policy_version: policyVersion,
      evaluated_at: verdicts.evaluated_at ?? null,
      ...rest,
    };
    const waiting = actionsWaitingFor(row.cards, who).map((a) => ({
      ...a,
      url: actionUrl(clanTag, a.number),
    }));
    actions = { count: waiting.length, waiting };
  }
  return {
    view: {
      schema_version: 1,
      reason,
      clan_tag: clanTag,
      you: who,
      policy,
      standing,
      actions,
      read_at: new Date().toISOString(),
    },
  };
}

// ---- the clan directory (#768) ---------------------------------------------

/** The policy fields a directory tile carries, and nothing else. A saved
 *  version also holds who saved it, their note, and every minimum and clock;
 *  none of those leaves the database here. */
const DIRECTORY_POLICY_FIELDS = [
  "war_intent",
  "posture",
  "goal_together",
  "war_enabled",
  "ranked_enabled",
  "donations_enabled",
  "trophies_enabled",
  "removal_enabled",
  "confirm_days",
];

/** [engineering, 2026-11-12] A bound on one read; the page says when it is
 *  reached rather than dropping clans without a word. */
export const DIRECTORY_LIMIT = 500;

// Authorization and projection in one statement: only an approved person
// reads, or an approved agent whose owner is an approved person, reading as
// that owner (`yours` is the owner's); the policy leaves the database
// already cut to the tile's fields. Listed: every recorded clan whose policy pointer names a saved
// version (saving a policy is how a clan opts in, DECISIONS); the pattern
// below is word for word the predicate of the partial index
// `clan_state_policy_pointer` (0260), so the ledger is never scanned whole
// (services/migrate/test/clan-directory-plan.test.mjs). Ordered by
// name, then tag: never by size, trophies or anything a ranking could read.
const DIRECTORY_SQL = `
with allowed as (
  select case when a.kind = 'agent' then o.account_id else a.account_id end
           as account_id
    from account a
    left join account o on o.account_id = a.owned_by_account_id
   where a.account_id = $1 and a.status = 'approved'
     and (a.kind = 'person'
          or (a.kind = 'agent' and o.kind = 'person' and o.status = 'approved'))
), listed as (
  select substr(pointer.pk, length('policy#') + 1) as clan_tag,
         (pointer.body ->> 'version')::int as version,
         v.body -> 'values' as saved,
         coalesce(v.body ->> 'saved_at', pointer.body ->> 'saved_at') as saved_at
    from allowed, clan_state pointer
    join clan_state v on v.pk = pointer.pk || '#v' || (pointer.body ->> 'version')
   where pointer.pk ~ '^policy##[0289PYLQGRJCUV]{3,12}$'
     and ($4::text is null or pointer.pk = 'policy#' || $4)
), mine as (
  -- The reader's own current clans, read once by their claims, never
  -- once per listed clan.
  select distinct m.clan_tag
    from allowed, claim cl
    join clan_membership m on m.player_tag = cl.player_tag
   where cl.account_id = allowed.account_id
     and cl.status = 'verified'
     and (cl.is_primary or cl.relationship in ('primary', 'alt'))
     and m.left_observed_at is null
)
select l.clan_tag, c.name, c.type, c.description,
       (select jsonb_object_agg(f, l.saved -> f)
          from unnest($2::text[]) f where l.saved ? f) as policy,
       l.saved_at,l.version,
       s.members, s.required_trophies,
       l.clan_tag in (select clan_tag from mine) as yours
  from listed l
  join clan c on c.clan_tag = l.clan_tag
  left join lateral (
    select d.members, d.required_trophies from clan_snapshot_daily d
     where d.clan_tag = l.clan_tag
     order by d.day desc, d.observed_at desc limit 1
  ) s on true
 order by lower(coalesce(c.name, '')), l.clan_tag
 limit $3`;

const CLAN_TYPES = new Set(["open", "inviteOnly", "closed"]);
const POSTURES = new Set(["relaxed", "standard", "strict"]);
const INTENTS = new Set(["participating", "not_participating"]);

/** One tile's facts. The record's facts as the record has them (null when
 *  not recorded); the policy as the clan saved it, defaults filled in. */
function directoryTile(row) {
  const values = effectivePolicyValues(row.policy ?? {});
  const removal = values.removal_enabled === true;
  const confirm = Number(values.confirm_days);
  return {
    clan_tag: row.clan_tag,
    name: row.name ?? null,
    type: CLAN_TYPES.has(row.type) ? row.type : null,
    description: row.description?.trim() || null,
    members: Number.isInteger(row.members) ? row.members : null,
    required_trophies: Number.isInteger(row.required_trophies)
      ? row.required_trophies
      : null,
    yours: row.yours === true,
    policy: {
      version: row.version,
      war_intent: INTENTS.has(values.war_intent)
        ? values.war_intent
        : "unknown",
      posture: POSTURES.has(values.posture) ? values.posture : null,
      together: values.goal_together === true,
      counted: countedCategories(values),
      removal_day:
        removal && Number.isInteger(confirm) && confirm > 0 ? confirm : null,
      saved_at:
        row.saved_at === null || row.saved_at === undefined
          ? null
          : new Date(row.saved_at).toISOString(),
    },
  };
}

/**
 * The clan directory (#768): every recorded clan with a saved policy, for a
 * signed-in, approved person, or an approved agent of an approved person
 * reading as its owner (12.0.0, `clans_directory`). A tile is the clan's recorded name, type, size,
 * trophies to join and in-game description, and its policy's public part:
 * Clan Wars intent, how strict, playing together, what counts, and the day a
 * removal Action comes. Never who saved it, a note, a minimum, a member's
 * standing, the Recruit pitch, or any other Clan state.
 *
 * `{ refused: "not_a_person" }` for an integration, an unapproved person, and
 * an agent that is not approved or whose owner is not an approved person;
 * otherwise `{ directory }`.
 */
export async function readClanDirectory(db, account, clanTag = null) {
  const kind = account?.kind ?? null;
  if ((kind !== "person" && kind !== "agent") || !account.accountId)
    return { refused: "not_a_person" };
  const { rows } = await db.query(DIRECTORY_SQL, [
    account.accountId,
    DIRECTORY_POLICY_FIELDS,
    DIRECTORY_LIMIT + 1,
    clanTag,
  ]);
  if (rows.length === 0) {
    // An unapproved account reads no row at all; say so rather than "none".
    const ok = await db.query(
      `select 1 from account a
         left join account o on o.account_id = a.owned_by_account_id
        where a.account_id = $1 and a.status = 'approved'
          and (a.kind = 'person' or (a.kind = 'agent' and o.kind = 'person'
                                     and o.status = 'approved'))`,
      [account.accountId],
    );
    if (ok.rows.length === 0) return { refused: "not_a_person" };
  }
  return {
    directory: {
      schema_version: 1,
      clans: rows.slice(0, DIRECTORY_LIMIT).map(directoryTile),
      truncated: rows.length > DIRECTORY_LIMIT,
      read_at: new Date().toISOString(),
    },
  };
}

// ---- people's places: the one ownership rule ------------------------------

/** A verified own claim (primary or alt): the only claim a place is under. */
const ownClaim = (c) => `${c}.status = 'verified'
    and (${c}.is_primary or ${c}.relationship in ('primary', 'alt'))`;

/**
 * A place belongs to the claim that wrote it (2026-11-14). A place is the
 * personal data of the person who picked it, stored under a player tag;
 * when the tag's verified claim moves to another account, or ends and is
 * verified again, the row stays behind. Every place row carries its
 * writer's account (`account_id`, stamped on every save; 0276 stamped the
 * older rows and deleted the orphans), and it counts for a claim only
 * when that stamp is the claim's account, so an older owner's place never
 * passes to the tag's next holder. A row that fails is no place, for
 * every reader: the owner's own view and the picker, the clan map, the
 * player map and Near you.
 * `s` is the clan_state row, `c` the claim it is read under.
 */
const placeOwnedBy = (s, c) =>
  `${s}.body ->> 'account_id' = ${c}.account_id::text`;

// One statement for a list of tags, each read by its key in the list's
// order (as the ledger's getMany): the place under the tag's verified own
// claim, when that claim wrote it. A tag with no such claim, or whose row
// another claim wrote, has none.
const OWNED_PLACES_SQL = `
select s.body
  from unnest($1::text[]) with ordinality as t(tag, ord)
  cross join lateral (
    select s.body from claim c
      join clan_state s on s.pk = 'place#' || c.player_tag
     where c.player_tag = t.tag
       and ${ownClaim("c")}
       and ${placeOwnedBy("s", "c")}
     limit 1) s
 order by t.ord`;

/** The ledger's own keys and the owner stamp stay here: a reader gets the
 *  place as Clan saved it, never whose account wrote it. */
const HIDDEN = new Set(["pk", "gsi1pk", "gsi1sk", "account_id"]);
const placeItem = (body) =>
  Object.fromEntries(Object.entries(body).filter(([k]) => !HIDDEN.has(k)));

/**
 * The places under these tags that their current verified own claims
 * wrote (`placeOwnedBy`), in the tags' order, absent ones left out. The
 * only read of `place#` rows by tag: Clan's own view and picker, its clan
 * map, the passport's "has a place" and its legacy check read through it.
 */
export async function readOwnedPlaces(db, tags) {
  if (!tags?.length) return [];
  const { rows } = await db.query(OWNED_PLACES_SQL, [tags]);
  return rows.map((r) => placeItem(r.body));
}

// ---- the player map and Near you (#768) ------------------------------------

/** [engineering, 2026-11-14] Bounds on one read; each says when it is
 *  reached rather than dropping people without a word. */
export const PLAYER_MAP_LIMIT = 1000;
export const NEAR_YOU_LIMIT = 50;

/**
 * The people on the player map: everyone who has set a place
 * (`place#<tag>`, written under each of their verified tags by Clan's
 * social service; Jamie, 2026-11-15: a place is a place, shown
 * everywhere), counted only under a tag that is still a verified own
 * claim (primary or alt) of an approved person, and only when that claim
 * wrote it (`placeOwnedBy`), so a tag that moved to another account never
 * carries the old owner's place. One
 * row per account: its primary player when verified, else its earliest
 * verified alt, so a person's players are never shown side by side.
 *
 * The pattern is word for word the predicate of the partial index
 * `clan_state_place` (0276), so the ledger is never
 * scanned whole (services/migrate/test/player-map-plan.test.mjs). `where`
 * narrows the places (Near you: a country and region) inside the
 * DISTINCT ON, where the index can serve it. Each place then finds its
 * tag's one verified claim by key (claim_one_verified_per_tag; the
 * LATERAL's limit keeps it a lookup), never by hashing the claim table
 * whole on the owner stamp.
 */
const onMap = (where = "true") => `
  select distinct on (c.account_id) c.account_id, c.player_tag,
         s.body ->> 'country' as country,
         s.body ->> 'region' as region,
         s.body ->> 'city' as city
    from clan_state s
    cross join lateral (
      select c.account_id, c.player_tag, c.is_primary, c.verified_at
        from claim c
       where c.player_tag = s.body ->> 'player_tag'
         and ${ownClaim("c")}
         and s.pk = 'place#' || c.player_tag
         and ${placeOwnedBy("s", "c")}
       limit 1) c
    join account a on a.account_id = c.account_id
                  and a.kind = 'person' and a.status = 'approved'
   where s.pk ~ '^place##[0289PYLQGRJCUV]{3,12}$'
     and ${where}
   order by c.account_id, c.is_primary desc, c.verified_at nulls last,
            c.player_tag`;

/** Only an approved person reads either: never an agent or an integration. */
const READER = `
  select a.account_id from account a
   where a.account_id = $1 and a.kind = 'person' and a.status = 'approved'`;

// The whole map, by country, region and name: never by trophies or any
// score. `you` marks the reader's own pin.
const PLAYER_MAP_SQL = `
with reader as (${READER}),
on_map as (${onMap()})
select o.player_tag, p.name, o.country, o.region, o.city,
       o.account_id = reader.account_id as you
  from reader, on_map o
  left join player p on p.player_tag = o.player_tag
 order by o.country, coalesce(o.region, ''),
          lower(coalesce(p.name, o.player_tag)), o.player_tag
 limit $2`;

// The reader's own place (the newest their verified own claims wrote,
// read by key) and, in the same snapshot, the people on the player
// map in its country and region, the reader's own account and anyone whose
// players the reader already claims (owns, follows or watches) left out.
// Ordered by the place alone: the reader's city first, then by name.
// No place: no row.
const NEAR_YOU_SQL = `
with reader as (${READER}),
mine as (
  select s.body ->> 'country' as country,
         coalesce(s.body ->> 'region', '') as region,
         s.body ->> 'city' as city
    from reader
    join claim c on c.account_id = reader.account_id
                and ${ownClaim("c")}
    join clan_state s on s.pk = 'place#' || c.player_tag
                     and ${placeOwnedBy("s", "c")}
   order by s.body ->> 'set_at' desc nulls last
   limit 1
)
select mine.country as my_country, nullif(mine.region, '') as my_region,
       mine.city as my_city,
       n.player_tag, n.name, n.country, n.region, n.city
  from reader, mine
  left join lateral (
    select o.player_tag, p.name, o.country, o.region, o.city
      from (${onMap(
        `s.body ->> 'country' = mine.country
         and coalesce(s.body ->> 'region', '') = mine.region`,
      )}) o
      left join player p on p.player_tag = o.player_tag
     where o.account_id <> reader.account_id
       and not exists (
         select 1 from claim theirs
           join claim held on held.player_tag = theirs.player_tag
          where theirs.account_id = o.account_id
            and theirs.status = 'verified'
            and held.account_id = reader.account_id)
     order by coalesce(o.city = mine.city, false) desc,
              lower(coalesce(p.name, o.player_tag)), o.player_tag
     limit $2
  ) n on true`;

/** A place as the ledger holds it: codes and a GeoNames id, nothing finer. */
const placeCodes = (country, region, city) => ({
  country,
  region: region || null,
  city:
    city === null || city === undefined || city === "" ? null : Number(city),
});

/**
 * The player map (#768): everyone who has set a place, for a signed-in, approved
 * person. Each entry is a player's game name and tag, `you` for the
 * reader's own, and the place codes; never an account, a nickname or
 * anything finer than the picked place. `{ refused: "not_a_person" }` for
 * an agent, an integration or an account that is not approved.
 */
export async function readPlayerMap(db, account) {
  if (account?.kind !== "person" || !account.accountId)
    return { refused: "not_a_person" };
  const { rows } = await db.query(PLAYER_MAP_SQL, [
    account.accountId,
    PLAYER_MAP_LIMIT + 1,
  ]);
  return {
    entries: rows.slice(0, PLAYER_MAP_LIMIT).map((r) => ({
      player_tag: r.player_tag,
      name: r.name ?? null,
      you: r.you === true,
      place: placeCodes(r.country, r.region, r.city),
    })),
    truncated: rows.length > PLAYER_MAP_LIMIT,
  };
}

/**
 * Near you (#768): the reader's own place and the people on the player map
 * in its country and region (a country with no regions: the country), up
 * to NEAR_YOU_LIMIT, the reader's city first, then by name. `{ place:
 * null }` when the reader has set no place.
 */
export async function readNearYou(db, account) {
  if (account?.kind !== "person" || !account.accountId)
    return { refused: "not_a_person" };
  const { rows } = await db.query(NEAR_YOU_SQL, [
    account.accountId,
    NEAR_YOU_LIMIT + 1,
  ]);
  if (rows.length === 0) return { place: null, people: [], truncated: false };
  const first = rows[0];
  const people = rows
    .filter((r) => r.player_tag)
    .map((r) => ({
      player_tag: r.player_tag,
      name: r.name ?? null,
      place: placeCodes(r.country, r.region, r.city),
    }));
  return {
    place: placeCodes(first.my_country, first.my_region, first.my_city),
    people: people.slice(0, NEAR_YOU_LIMIT),
    truncated: people.length > NEAR_YOU_LIMIT,
  };
}
