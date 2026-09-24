/**
 * The account an agent-scoped console request runs as
 * (docs/reviews/2026-09-23-CONSOLE-ACCOUNT-SWITCHER.md).
 *
 * The ONE ownership check for `/api/agent/<public_id>/...`: the agent must
 * be an agent, and its owner must be the signed-in person. Anything else is
 * null, which the handler answers as a 404, so a stranger's guess never
 * learns whether the id exists. A suspended agent still resolves: its
 * owner opens its console to resume it.
 *
 * The object mirrors a session's (services/auth sessions-store) so a route
 * reads it the same way, with two differences a route can rely on. `owner`
 * is the person: the one budget both of them spend, and the viewer. And
 * `timezone` is the person's, because the console prints times on the
 * clock of whoever is reading it.
 */
export async function resolveOwnedAgent(db, person, publicId) {
  const { rows } = await db.query(
    `select a.account_id, a.public_id, a.role, a.status,
            (select t.name from service_token t
              where t.account_id = a.account_id
              order by (t.revoked_at is null) desc, t.created_at desc
              limit 1) as name
       from account a
      where a.public_id = $1 and a.kind = 'agent'
        and a.owned_by_account_id = $2`,
    [publicId, person.accountId],
  );
  const a = rows[0];
  if (!a) return null;
  return {
    accountId: a.account_id,
    kind: "agent",
    publicId: a.public_id,
    name: a.name ?? a.public_id,
    status: a.status,
    role: a.role,
    isOwner: false,
    isAdmin: false,
    timezone: person.timezone,
    mcpDailyQuota: null,
    liveDailyQuota: null,
    emailHash: null,
    sessionId: person.sessionId,
    owner: person,
  };
}
