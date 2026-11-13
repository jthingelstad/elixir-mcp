/** Approved private-context seam. Public game tools never read private Clan
 * state. Two readers, each authorizing and projecting in one statement:
 * `readOwnClanView` gives a person their own view of one clan (#535);
 * `readClanDirectory` gives a signed-in person, or an agent reading for its
 * approved owner (12.0.0), the clan directory's tiles, the policy's public
 * part only (#768). The agent policy-context reader retired with
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
         v.body -> 'values' as saved,
         coalesce(v.body ->> 'saved_at', pointer.body ->> 'saved_at') as saved_at
    from allowed, clan_state pointer
    join clan_state v on v.pk = pointer.pk || '#v' || (pointer.body ->> 'version')
   where pointer.pk ~ '^policy##[0289PYLQGRJCUV]{3,12}$'
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
       l.saved_at,
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
export async function readClanDirectory(db, account) {
  const kind = account?.kind ?? null;
  if ((kind !== "person" && kind !== "agent") || !account.accountId)
    return { refused: "not_a_person" };
  const { rows } = await db.query(DIRECTORY_SQL, [
    account.accountId,
    DIRECTORY_POLICY_FIELDS,
    DIRECTORY_LIMIT + 1,
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
