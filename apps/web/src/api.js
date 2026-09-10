/** Site API client: same-origin /api/*, cookie-authed, contract header on
 *  every request (the CSRF marker web-api requires on state changes). */

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      "x-elixir-client": "web",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // Every /api route answers JSON. Anything else was produced in
    // FRONT of the API — an edge error page — so whatever status it
    // arrived with, this is a failure and must never read as success.
    return { ok: false, status: res.status, data: {}, error: "bad_response" };
  }
  return { ok: res.ok, status: res.status, data };
}

export const api = {
  me: () => request("GET", "/api/me"),
  requestAccess: (body) => request("POST", "/api/request-access", body),
  sendLoginEmail: (email) => request("POST", "/api/auth", { email }),
  redeemToken: (token) => request("POST", "/api/auth/redeem", { token }),
  redeemCode: (email, code) =>
    request("POST", "/api/auth/code", { email, code }),
  dismissRefusal: (body) =>
    request("POST", "/api/me/connections/refusals/dismiss", body),
  signOut: () => request("POST", "/api/session/signout", {}),
  setTimezone: (timezone) => request("POST", "/api/me/timezone", { timezone }),
  addClaim: (player_tag) => request("POST", "/api/claims", { player_tag }),
  claimAction: (body) => request("POST", "/api/claims", body),
  clan: () => request("GET", "/api/clan"),
  usage: () => request("GET", "/api/me/usage"),
  explore: (tool, args) => request("POST", "/api/explore", { tool, args }),
  adminCollections: () => request("GET", "/api/admin/collections"),
  adminCollectionAction: (body) =>
    request("POST", "/api/admin/collections", body),
  myFeedback: () => request("GET", "/api/me/feedback"),
  sendFeedback: (message, category, context) =>
    request("POST", "/api/feedback", { message, category, context }),
  adminFeedback: () => request("GET", "/api/admin/feedback"),
  adminServiceTokens: () => request("GET", "/api/admin/service-tokens"),
  adminServiceTokenAction: (body) =>
    request("POST", "/api/admin/service-tokens", body),
  adminFeedbackStatus: (feedback_id, status, response) =>
    request("POST", "/api/admin/feedback", {
      feedback_id,
      status,
      ...(response ? { response } : {}),
    }),
  activity: () => request("GET", "/api/me/activity"),
  connections: () => request("GET", "/api/me/connections"),
  firstAnswer: () => request("GET", "/api/me/first-answer"),
  revokeConnection: (family_id) =>
    request("POST", "/api/me/connections/revoke", { family_id }),
  setConnectionScope: (family_id, scope) =>
    request("POST", "/api/me/connections/scope", { family_id, scope }),
  setPrincipalScope: (account_id, scope) =>
    request("POST", "/api/me/principals/scope", { account_id, scope }),
  adminUsage: () => request("GET", "/api/admin/usage"),
  adminRequests: () => request("GET", "/api/admin/requests"),
  adminDecide: (email_hash, decision) =>
    request("POST", "/api/admin/decide", { email_hash, decision }),
  adminGateways: () => request("GET", "/api/admin/gateways"),
  adminGatewayAction: (gateway_id, action) =>
    request("POST", "/api/admin/gateways", { gateway_id, action }),
  myGateways: () => request("GET", "/api/me/gateways"),
  gatewayLadder: () => request("GET", "/api/gateways/ladder"),
  raiseGateway: (name) => request("POST", "/api/gateways", { name }),
  requestRole: (role, note) =>
    request("POST", "/api/me/role-request", { role, note }),
  adminAccounts: () => request("GET", "/api/admin/accounts"),
  adminSetRole: (account_id, role) =>
    request("POST", "/api/admin/accounts", { account_id, role }),
  myCollections: () => request("GET", "/api/me/collections"),
  myClans: () => request("GET", "/api/me/clans"),
  publicStats: () => request("GET", "/api/public/stats"),
  publicStatus: () => request("GET", "/api/public/status"),
  myRequests: () => request("GET", "/api/me/requests"),
  callRecord: (request_id) =>
    request("GET", `/api/me/activity/calls/${encodeURIComponent(request_id)}`),
  myEvents: () => request("GET", "/api/me/events"),
  // A POST: claiming spends a one-time credential, so it must not be
  // reachable by a link scanner, a prefetch, or a cross-site top-level
  // navigation (#31).
  gatewayEnv: (id) => request("POST", "/api/me/gateway-env", { id }),
  gatewayDetail: (id) =>
    request("GET", `/api/me/gateway-detail?id=${encodeURIComponent(id)}`),
  myClanAction: (body) => request("POST", "/api/me/clans", body),
  // Fire-and-forget: a failed view must never surface to a user, and must
  // never delay a render.
  rotatePrincipalToken: (account_id) =>
    request("POST", "/api/me/principals/rotate", { account_id }),
  setPrincipalStatus: (account_id, status) =>
    request("POST", "/api/me/principals/status", { account_id, status }),
  renamePrincipal: (account_id, name) =>
    request("POST", "/api/me/principals/rename", { account_id, name }),
  principalEvents: (account_id) =>
    request(
      "GET",
      `/api/me/principals/events?account_id=${encodeURIComponent(account_id)}`,
    ),
  principalIdentities: (account_id) =>
    request(
      "GET",
      `/api/me/principals/identities?account_id=${encodeURIComponent(account_id)}`,
    ),
  removePrincipalIdentity: (account_id, external_id) =>
    request("POST", "/api/me/principals/identities/remove", {
      account_id,
      external_id,
    }),
  setRelationship: (player_tag, relationship) =>
    request("POST", "/api/claims", {
      action: "relationship",
      player_tag,
      relationship,
    }),
  myPrincipals: () => request("GET", "/api/me/principals"),
  createAgent: (body) => request("POST", "/api/me/agents", body),
  adminIntegrations: () => request("GET", "/api/admin/integrations"),
  adminIntegrationAction: (body) =>
    request("POST", "/api/admin/integrations", body),
  revokePrincipalToken: (token_id) =>
    request("POST", "/api/me/principals/revoke", { token_id }),
  myCollectionAction: (body) => request("POST", "/api/me/collections", body),
};
