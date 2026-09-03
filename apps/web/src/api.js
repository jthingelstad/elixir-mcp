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
  setRecording: (player_tag, action) =>
    request("POST", "/api/recordings", { player_tag, action }),
  clan: () => request("GET", "/api/clan"),
  usage: () => request("GET", "/api/me/usage"),
  connections: () => request("GET", "/api/me/connections"),
  revokeConnection: (family_id) =>
    request("POST", "/api/me/connections/revoke", { family_id }),
  adminUsage: () => request("GET", "/api/admin/usage"),
  adminRequests: () => request("GET", "/api/admin/requests"),
  adminDecide: (email_hash, decision) =>
    request("POST", "/api/admin/decide", { email_hash, decision }),
  adminGateways: () => request("GET", "/api/admin/gateways"),
  adminClans: () => request("GET", "/api/admin/clans"),
  adminClanAction: (clan_tag, action) =>
    request("POST", "/api/admin/clans", { clan_tag, action }),
  adminGatewayAction: (gateway_id, action) =>
    request("POST", "/api/admin/gateways", { gateway_id, action }),
  myGateways: () => request("GET", "/api/me/gateways"),
  raiseGateway: (name, static_ip) =>
    request("POST", "/api/gateways", { name, static_ip }),
};
