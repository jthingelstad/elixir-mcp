/** Approved private-context seam. Public game tools never read private Clan
 * state. This reader projects only eight fields after an explicit, credential-
 * bound grant and current recorded ownership/verified membership checks. */
import { OAUTH_SCOPE, FULL_OAUTH_SCOPE } from "@elixir-mcp/contracts";

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
