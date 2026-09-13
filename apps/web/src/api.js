/** Site API client: same-origin /api/*, cookie-authed, contract header on
 *  every request (the CSRF marker web-api requires on state changes).
 *  The envelope, timeout and failure accounting are the family's, in
 *  @elixir-mcp/client; this file is only the console's route map. */

import { createClient } from "@elixir-mcp/client";
import { trackEvent } from "./analytics.js";

const client = createClient({
  headers: { "x-elixir-client": "web" },
  // A failure that never reached the origin is the class of problem only
  // the browser can count (2026-09-12: three stalls in front of the edge,
  // ~1 min each, no trace anywhere); a slow one is counted too.
  onEvent: (event, label) => trackEvent(`web.${event}`, label),
  onSlow: (info) => console.warn("[elixir] slow request", info),
});

const request = (method, path, body) => client.request(method, path, body);

export const api = {
  me: () => request("GET", "/api/me"),
  requestAccess: (body) => request("POST", "/api/request-access", body),
  sendLoginEmail: (email) => request("POST", "/api/auth", { email }),
  redeemToken: (token) => request("POST", "/api/auth/redeem", { token }),
  redeemCode: (email, code) =>
    request("POST", "/api/auth/code", { email, code }),
  // The cross-context handoff (0083): the screen that asked polls; the
  // screen that opened the link from elsewhere confirms.
  pollSignIn: (poll_id) => request("POST", "/api/auth/poll", { poll_id }),
  confirmHandoff: (confirm) =>
    request("POST", "/api/auth/handoff", { confirm }),
  sessions: () => request("GET", "/api/me/sessions"),
  revokeSession: (session_id) =>
    request("POST", "/api/me/sessions/revoke", { session_id }),
  revokeSessionsEverywhere: () =>
    request("POST", "/api/me/sessions/revoke", { everywhere: true }),
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
  sendFeedback: (message, category, context, request_id) =>
    request("POST", "/api/feedback", {
      message,
      category,
      context,
      request_id,
    }),
  adminFeedback: () => request("GET", "/api/admin/feedback"),
  adminCall: (request_id) =>
    request("GET", `/api/admin/calls/${encodeURIComponent(request_id)}`),
  adminConnections: () => request("GET", "/api/admin/connections"),
  adminRevokeConnection: (family_id) =>
    request("POST", "/api/admin/connections/revoke", { family_id }),
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
  raiseGateway: (name, card) =>
    request("POST", "/api/gateways", { name, card }),
  gatewayCards: () => request("GET", "/api/gateways/cards"),
  pickGatewayCard: (id, card) =>
    request("POST", "/api/me/gateway-card", { id, card }),
  requestRole: (role, note) =>
    request("POST", "/api/me/role-request", { role, note }),
  adminAccounts: () => request("GET", "/api/admin/accounts"),
  adminSetRole: (account_id, role) =>
    request("POST", "/api/admin/accounts", { account_id, role }),
  myCollections: () => request("GET", "/api/me/collections"),
  myClans: () => request("GET", "/api/me/clans"),
  verifyList: () => request("GET", "/api/me/verify"),
  verifyStart: (player_tag) =>
    request("POST", "/api/me/verify", { player_tag }),
  verifyStatus: (id) =>
    request("GET", `/api/me/verify/${encodeURIComponent(id)}`),
  // Tags travel without their hash (lib/tag-url.js): the reader puts it back.
  battleActivity: (player_tag) =>
    request(
      "GET",
      `/api/me/battle-activity/${encodeURIComponent(String(player_tag).replace(/^#/, ""))}`,
    ),
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
