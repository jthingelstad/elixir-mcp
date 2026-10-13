/** Approved private-context seam. Public game tools never read private Clan
 * state. Two readers, each authorizing and projecting in one statement:
 * `readAgentPolicyContext` gives an agent eight fields after an explicit,
 * credential-bound grant and current recorded ownership/verified membership
 * checks; `readOwnClanView` gives a person their own view of one clan (#535). */
import {
  ELIXIR_ORIGIN,
  OAUTH_SCOPE,
  FULL_OAUTH_SCOPE,
} from "@elixir-mcp/contracts";
import {
  actionsWaitingFor,
  effectivePolicyValues,
  ownStandingLine,
  policySummaryOf,
} from "@elixir-mcp/clan-engine";

const CONTEXT_ELIGIBILITY_SQL = `
select a.account_id as agent_account_id, a.public_id, a.owned_by_account_id as owner_account_id,
       ac.clan_tag, t.token_id, a.kind as agent_kind, a.status as agent_status,
       o.kind as owner_kind, o.status as owner_status,
       a.kind = 'agent' and a.status = 'approved' and o.kind = 'person'
       and o.status = 'approved' and ac.clan_tag is not null
       and t.token_id is not null and exists (
         select 1 from claim c join clan_membership m on m.player_tag = c.player_tag
          where c.account_id = o.account_id and c.status = 'verified'
            and (c.is_primary or c.relationship = 'alt')
            and m.clan_tag = ac.clan_tag and m.left_observed_at is null
            and m.role in ('member','elder','coLeader','leader')
       ) as eligible
  from account a
  left join account o on o.account_id = a.owned_by_account_id
  left join account_clan ac on ac.account_id = a.account_id and ac.is_primary
  left join lateral (
    select min(st.token_id) as token_id
      from service_token st where st.account_id = a.account_id
        and st.revoked_at is null and st.audience = 'mcp'
      having count(*) = 1 and bool_and('cr:read' = any(string_to_array(coalesce(st.scope,$2),' ')))
  ) t on true
 where a.public_id = any($1::text[])`;

export async function agentContextEligibility(db, publicIds) {
  const { rows } = await db.query(CONTEXT_ELIGIBILITY_SQL, [
    publicIds,
    FULL_OAUTH_SCOPE,
  ]);
  return publicIds.map((public_id) => {
    const row = rows.find((r) => r.public_id === public_id);
    return row
      ? {
          ...row,
          eligible: row.eligible === true,
          reason:
            row.eligible === true
              ? null
              : row.agent_kind !== "agent"
                ? "not_an_agent"
                : row.agent_status !== "approved"
                  ? "agent_not_approved"
                  : row.owner_kind !== "person"
                    ? "invalid_owner"
                    : row.owner_status !== "approved"
                      ? "owner_not_approved"
                      : !row.clan_tag
                        ? "no_primary_assignment"
                        : !row.token_id
                          ? "credential_missing_ambiguous_or_without_read"
                          : "no_verified_owner_membership",
        }
      : { public_id, eligible: false, reason: "identity_not_found" };
  });
}

export async function readAgentPolicyContext(db, account) {
  if (
    account?.kind !== "agent" ||
    account.credentialType !== "service" ||
    !account.tokenId ||
    !account.scopes?.includes(OAUTH_SCOPE.READ)
  )
    return null;
  // Authorization and minimal projection share one database snapshot. Neither
  // a remembered account object nor last_known_clan_tag can authorize a read.
  const { rows } = await db.query(
    `
    with allowed as (
      select g.clan_tag from agent_policy_context_grant g
      join account a on a.account_id = g.agent_account_id
      join account o on o.account_id = g.owner_account_id
      join account_clan ac on ac.account_id = a.account_id and ac.is_primary
                          and ac.clan_tag = g.clan_tag
      join service_token t on t.token_id = g.token_id and t.account_id = a.account_id
      where a.account_id = $1 and g.token_id = $2 and g.revoked_at is null
        and a.kind = 'agent' and a.status = 'approved'
        and a.owned_by_account_id = g.owner_account_id
        and o.kind = 'person' and o.status = 'approved'
        and t.revoked_at is null and t.audience = 'mcp'
        and $3 = any(string_to_array(coalesce(t.scope,$4), ' '))
        and exists (select 1 from claim c
          join clan_membership m on m.player_tag = c.player_tag
          where c.account_id = o.account_id and c.status = 'verified'
            and (c.is_primary or c.relationship = 'alt')
            and m.clan_tag = g.clan_tag and m.left_observed_at is null
            and m.role in ('member','elder','coLeader','leader'))
    )
    select allowed.clan_tag,
           p.body ->> 'version' as policy_version,
           p.body ->> 'saved_at' as policy_saved_at,
           p.body #>> '{values,war_intent}' as war_intent
      from allowed
      left join clan_state pointer on pointer.pk = 'policy#' || allowed.clan_tag
      left join clan_state p on p.pk = 'policy#' || allowed.clan_tag || '#v' || (pointer.body ->> 'version')
  `,
    [account.accountId, account.tokenId, OAUTH_SCOPE.READ, FULL_OAUTH_SCOPE],
  );
  const row = rows[0];
  if (!row) return null;
  const version = Number(row.policy_version);
  if (
    row.policy_version !== null &&
    (!Number.isSafeInteger(version) || version < 1)
  )
    throw new Error("Invalid context policy revision");
  const set = row.policy_version !== null;
  const intent = ["participating", "not_participating"].includes(row.war_intent)
    ? row.war_intent
    : "unknown";
  const savedAt =
    row.policy_saved_at === null
      ? null
      : new Date(row.policy_saved_at).toISOString();
  return {
    schema_version: 1,
    clan_tag: row.clan_tag,
    status: set && intent !== "unknown" ? "known" : "unknown",
    reason: !set
      ? "no_policy"
      : intent === "unknown"
        ? "war_intent_unspecified"
        : null,
    war_intent: set ? intent : "unknown",
    policy_version: set ? version : null,
    policy_saved_at: savedAt,
    read_at: new Date().toISOString(),
  };
}

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

/** Clan's page for one Action, or its Actions list for one not numbered. */
const actionUrl = (clanTag, number) =>
  `${ELIXIR_ORIGIN}/clan/${clanTag.replace(/^#/, "")}/actions${
    Number.isInteger(number) ? `/${number}` : ""
  }`;

/**
 * A person's own view of one clan in Elixir Clan, for their own connection
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
