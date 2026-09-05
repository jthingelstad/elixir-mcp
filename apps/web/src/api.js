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
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export const api = {
  me: () => request("GET", "/api/me"),
  requestAccess: (body) => request("POST", "/api/request-access", body),
  sendLoginEmail: (email) => request("POST", "/api/auth", { email }),
  redeemToken: (token) => request("POST", "/api/auth/redeem", { token }),
  redeemCode: (email, code) =>
    request("POST", "/api/auth/code", { email, code }),
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
  sendFeedback: (message, category, context) =>
    request("POST", "/api/feedback", { message, category, context }),
  adminFeedback: () => request("GET", "/api/admin/feedback"),
  adminServiceTokens: () => request("GET", "/api/admin/service-tokens"),
  adminServiceTokenAction: (body) =>
    request("POST", "/api/admin/service-tokens", body),
  adminFeedbackStatus: (feedback_id, status) =>
    request("POST", "/api/admin/feedback", { feedback_id, status }),
  activity: () => request("GET", "/api/me/activity"),
  connections: () => request("GET", "/api/me/connections"),
  revokeConnection: (family_id) =>
    request("POST", "/api/me/connections/revoke", { family_id }),
  adminUsage: () => request("GET", "/api/admin/usage"),
  adminRequests: () => request("GET", "/api/admin/requests"),
  adminDecide: (email_hash, decision) =>
    request("POST", "/api/admin/decide", { email_hash, decision }),
  adminGateways: () => request("GET", "/api/admin/gateways"),
  adminGatewayAction: (gateway_id, action) =>
    request("POST", "/api/admin/gateways", { gateway_id, action }),
  myGateways: () => request("GET", "/api/me/gateways"),
  gatewayLadder: () => request("GET", "/api/gateways/ladder"),
  raiseGateway: (name, static_ip) =>
    request("POST", "/api/gateways", { name, static_ip }),
  requestRole: (role, note) =>
    request("POST", "/api/me/role-request", { role, note }),
  adminAccounts: () => request("GET", "/api/admin/accounts"),
  adminSetRole: (account_id, role) =>
    request("POST", "/api/admin/accounts", { account_id, role }),
  myCollections: () => request("GET", "/api/me/collections"),
  myClans: () => request("GET", "/api/me/clans"),
  publicStats: () => request("GET", "/api/public/stats"),
  myClanAction: (body) => request("POST", "/api/me/clans", body),
  myCollectionAction: (body) => request("POST", "/api/me/collections", body),
};
