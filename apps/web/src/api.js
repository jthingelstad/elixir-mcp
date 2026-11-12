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

/** Whose `/api/me` a call reads: yours, or, on an agent's console, the
 *  agent's (`/api/agent/<public_id>`, the same routes run as the agent
 *  for its owner). The scoped calls below take the agent's public id as
 *  their last argument; omitted, they are yours, as they always were. */
const home = (agent) =>
  agent ? `/api/agent/${encodeURIComponent(agent)}` : "/api/me";

export const api = {
  me: (agent) => request("GET", home(agent)),
  // `timezone` is this browser's zone: a NEW account opens on it, an
  // existing one keeps its own (Jamie, 2026-10-08). Left out when the
  // browser will not say, and the account starts at UTC.
  // `playerTag` is the signup form's optional tag, sent only when given;
  // the server normalizes it and applies it after the email is proved.
  // `turnstileToken` is the page's Turnstile token (turnstile.js), left
  // out when Cloudflare gave none; the server records which.
  sendLoginEmail: (
    email,
    newsletterOptIn = true,
    timezone = null,
    playerTag = "",
    turnstileToken = "",
    // The signup form's "I am 13 or older" (#763); plain sign-in sends none.
    age13 = false,
  ) =>
    request("POST", "/api/auth", {
      email,
      newsletter_opt_in: newsletterOptIn,
      ...(timezone ? { timezone } : {}),
      ...(playerTag?.trim() ? { player_tag: playerTag.trim() } : {}),
      ...(turnstileToken ? { turnstile_token: turnstileToken } : {}),
      ...(age13 === true ? { age_13: true } : {}),
    }),
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
  dismissRefusal: (body, agent) =>
    request("POST", `${home(agent)}/connections/refusals/dismiss`, body),
  signOut: async () => {
    const result = await request("POST", "/api/session/signout", {});
    if (result.ok) {
      try {
        for (const key of Object.keys(sessionStorage))
          if (key.startsWith("clan-delivery:")) sessionStorage.removeItem(key);
      } catch {
        /* Draft storage is optional. */
      }
    }
    return result;
  },
  setTimezone: (timezone) => request("POST", "/api/me/timezone", { timezone }),
  /** Disconnect the Discord linked to this account (#531). */
  unlinkDiscord: () => request("POST", "/api/me/discord/unlink", {}),
  emailPrefs: () => request("GET", "/api/me/email"),
  setEmailPref: (kind, enabled) =>
    request("PUT", "/api/me/email", { kind, enabled }),
  /** How often the digest comes (tracking_report): "weekly" or "daily". */
  setDigestCadence: (cadence) =>
    request("PUT", "/api/me/email", { kind: "tracking_report", cadence }),
  myEmailSends: () => request("GET", "/api/me/email/sends"),
  emailRecord: (send_id) =>
    request("GET", `/api/me/email/sends/${encodeURIComponent(send_id)}`),
  addClaim: (player_tag) => request("POST", "/api/claims", { player_tag }),
  claimAction: (body) => request("POST", "/api/claims", body),
  /** What following this tag would cost, before the tap (#760): free when
   *  Elixir already records the player, else one of the pool's slots. */
  followCost: (player_tag, agent) =>
    request(
      "GET",
      `${home(agent)}/follow-cost?player_tag=${encodeURIComponent(player_tag)}`,
    ),
  usage: (agent) => request("GET", `${home(agent)}/usage`),
  explore: (tool, args) => request("POST", "/api/explore", { tool, args }),
  // Stats' door (2026-11-12): the same tools, for your own players and the
  // players you follow only; anyone else is refused before a tool runs.
  stats: (tool, args) => request("POST", "/api/me/stats", { tool, args }),
  // A private nickname is a WRITE through the tool bridge. The bridge
  // answers 200 with is_error for a tool's own refusal, so that is
  // turned into the failed envelope every other write returns, and
  // useWrite reads it as one.
  setNickname: async (player_tag, nickname) => {
    const r = await request("POST", "/api/explore", {
      tool: "elixir_nickname",
      args: { player_tag, nickname },
    });
    if (!r.ok || !r.data?.is_error) return r;
    const err = r.data.body?.error ?? {};
    return {
      ok: false,
      status: 422,
      data: {
        error: err.code ?? "refused",
        message: err.message ?? "The nickname was not saved.",
      },
    };
  },
  myFeedback: (agent) => request("GET", `${home(agent)}/feedback`),
  feedbackItem: (id, agent) =>
    request("GET", `${home(agent)}/feedback/${encodeURIComponent(id)}`),
  // One record for every page (0204): { message, category, area, refs,
  // context, follows_id }. request_id and send_id still ride as refs.
  sendFeedback: (body) => request("POST", "/api/feedback", body),
  adminFeedback: (q = {}) => {
    const params = new URLSearchParams(
      Object.entries(q).filter(
        ([, v]) => v !== undefined && v !== null && v !== "",
      ),
    ).toString();
    return request("GET", `/api/admin/feedback${params ? `?${params}` : ""}`);
  },
  adminFeedbackItem: (id) =>
    request("GET", `/api/admin/feedback/${encodeURIComponent(id)}`),
  adminCall: (request_id) =>
    request("GET", `/api/admin/calls/${encodeURIComponent(request_id)}`),
  adminEmailSends: () => request("GET", "/api/admin/email/sends"),
  adminCards: () => request("GET", "/api/admin/cards"),
  adminEmail: (send_id) =>
    request("GET", `/api/admin/email/sends/${encodeURIComponent(send_id)}`),
  adminConnections: () => request("GET", "/api/admin/connections"),
  adminRevokeConnection: (family_id) =>
    request("POST", "/api/admin/connections/revoke", { family_id }),
  adminServiceTokens: () => request("GET", "/api/admin/service-tokens"),
  adminServiceTokenAction: (body) =>
    request("POST", "/api/admin/service-tokens", body),
  // An answer: status, words, what shipped; `expected` is the status as
  // the page read it, so two answers cannot cross (409).
  answerFeedback: (body) => request("POST", "/api/admin/feedback", body),
  activity: (agent) => request("GET", `${home(agent)}/activity`),
  connections: (agent) => request("GET", `${home(agent)}/connections`),
  // Home's head, what the page paints from; each slow panel reads for itself.
  home: () => request("GET", "/api/me/home"),
  // `rebuild`: the card was served from its stored copy past fresh; build
  // it again (home_clan_card, #649).
  homeClan: (rebuild = false) =>
    request(
      "GET",
      rebuild ? "/api/me/home/clan?rebuild=1" : "/api/me/home/clan",
    ),
  // Home's feed: the timeline without your account's own lines (the bell's).
  // Thirty items a page; `cursor` reads on in the same week (G1).
  homeFeed: (cursor) =>
    request(
      "GET",
      cursor
        ? `/api/me/home/feed?${new URLSearchParams({ cursor })}`
        : "/api/me/home/feed",
    ),
  // One of Home's items' evidence, from the week the feed showed it in.
  homeFeedEvidence: (params) =>
    request("GET", `/api/me/home/feed?${new URLSearchParams(params)}`),
  homeNeeds: () => request("GET", "/api/me/home/needs"),
  // The bell (2026-11-12): reactions to your items, new followers and your
  // feedback's answers; opening it moves your seen marker. Yours alone.
  bell: () => request("GET", "/api/me/bell"),
  bellSeen: () => request("PUT", "/api/me/bell/seen"),
  homeWeek: (mode) =>
    request(
      "GET",
      mode
        ? `/api/me/home/week?mode=${encodeURIComponent(mode)}`
        : "/api/me/home/week",
    ),
  /** A player's page (#764): their record, follows, followers and badges. */
  playerPage: (tag) =>
    request("GET", `/api/player?tag=${encodeURIComponent(tag)}`),
  /** A sitting's games on a player's page (View games): `tag` and the
   *  evidence params Home's timeline read takes. */
  playerEvidence: (params) =>
    request("GET", `/api/player/evidence?${new URLSearchParams(params)}`),
  /** What following several players costs, before the tap: `player_tags`
   *  (a Follow me link's) or `clan_tag` (everyone in it now). */
  followPlan: ({ player_tags = null, clan_tag = null }) =>
    request(
      "GET",
      clan_tag
        ? `/api/me/follow-plan?clan_tag=${encodeURIComponent(clan_tag)}`
        : `/api/me/follow-plan?player_tags=${encodeURIComponent(player_tags.join(","))}`,
    ),
  /** Follow every one of them, in one confirmed act; refused whole at the
   *  limit. */
  followAll: (body) => request("POST", "/api/me/follow-all", body),
  /** Your follow slots, player by player: what uses a slot because of you
   *  and what is recorded anyway, as the Follow dialogs count them. */
  followSlots: () => request("GET", "/api/me/follow-slots"),
  firstAnswer: (playerTag) =>
    request(
      "GET",
      `/api/me/first-answer${playerTag ? `?player_tag=${encodeURIComponent(playerTag)}` : ""}`,
    ),
  revokeConnection: (family_id, agent) =>
    request("POST", `${home(agent)}/connections/revoke`, { family_id }),
  setConnectionScope: (family_id, scope, agent) =>
    request("POST", `${home(agent)}/connections/scope`, { family_id, scope }),
  setPrincipalScope: (account_id, scope) =>
    request("POST", "/api/me/principals/scope", { account_id, scope }),
  adminUsage: () => request("GET", "/api/admin/usage"),
  // The Discord quality ledger (2026-10-11): a window's numbers, and one
  // clan's or one timeline's posts whole.
  adminDiscord: (days) => request("GET", `/api/admin/discord?days=${days}`),
  adminDiscordDetail: (key, feature) =>
    request(
      "GET",
      `/api/admin/discord/${encodeURIComponent(key)}${feature ? `?feature=${encodeURIComponent(feature)}` : ""}`,
    ),
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
  adminAccounts: () => request("GET", "/api/admin/accounts"),
  adminSetRole: (account_id, role) =>
    request("POST", "/api/admin/accounts", { account_id, role }),
  myClans: (agent) => request("GET", `${home(agent)}/clans`),
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
  publicStatus: () => request("GET", "/api/public/status"),
  publicEfficiency: () => request("GET", "/api/public/efficiency"),
  publicCards: () => request("GET", "/api/public/cards"),
  publicBattle: (ref) =>
    request("GET", `/api/public/battles/${encodeURIComponent(ref)}`),
  // Highlights (#762): a person's own posts of their verified players'
  // battles, and a shared post's public read.
  myHighlights: (battle) =>
    request("GET", `/api/me/highlights?battle=${encodeURIComponent(battle)}`),
  postHighlight: ({ battle, player_tag, words }) =>
    request("POST", "/api/me/highlights", { battle, player_tag, words }),
  editHighlight: (id, words) =>
    request("PUT", `/api/me/highlights/${encodeURIComponent(id)}`, { words }),
  deleteHighlight: (id) =>
    request("DELETE", `/api/me/highlights/${encodeURIComponent(id)}`),
  shareHighlight: (id) =>
    request("POST", "/api/me/highlights/share", { highlight_id: id }),
  publicPost: (id) =>
    request("GET", `/api/public/highlights/${encodeURIComponent(id)}`),
  myRequests: (agent) => request("GET", `${home(agent)}/requests`),
  callRecord: (request_id, agent) =>
    request(
      "GET",
      `${home(agent)}/activity/calls/${encodeURIComponent(request_id)}`,
    ),
  timelineEvidence: (params, agent) =>
    request("GET", `${home(agent)}/timeline?${new URLSearchParams(params)}`),
  myTimeline: (agent) => request("GET", `${home(agent)}/timeline`),
  // Your cheer on a timeline item (#765): one of six, or null to take it
  // back. The item's subject tags let the server find it in your feed.
  // Yours alone: never an agent's console.
  cheer: ({ item_id, cheer, subjects }) =>
    request("PUT", "/api/me/cheers", { item_id, cheer, subjects }),
  // Which of a player page's or a battle page's items take your cheers.
  pageCheers: ({ player = null, battle = null }) =>
    request(
      "GET",
      player
        ? `/api/me/cheers?player=${encodeURIComponent(player)}`
        : `/api/me/cheers?battle=${encodeURIComponent(battle)}`,
    ),
  // People to follow ("suggested"), Find's From your battles ("battles")
  // and Your clan ("clan").
  people: (which) => request("GET", `/api/me/people/${which}`),
  // Your timeline's private RSS link (#765): whether it is on; making or
  // resetting it answers the link, the one time it is shown; off ends it.
  rssLink: () => request("GET", "/api/me/rss"),
  resetRssLink: () => request("POST", "/api/me/rss"),
  rssLinkOff: () => request("DELETE", "/api/me/rss"),
  // The Console's own place in the timeline (2026-10-20): the window end
  // the page showed. Never an agent's read pointer.
  markTimelineSeen: (to, agent) =>
    request("POST", `${home(agent)}/timeline/seen`, { to }),
  // The timeline cross-posted to Discord: { enabled, webhook (shortened),
  // ... }; saving takes { url?, enabled }.
  timelineDiscord: (agent) => request("GET", `${home(agent)}/timeline/discord`),
  saveTimelineDiscord: (body, agent) =>
    request("PUT", `${home(agent)}/timeline/discord`, body),
  // A thumbs up or down on one cross-posted line: { ledger_id, rating,
  // note? }, filed as feedback (2026-10-11).
  rateTimelineDiscord: (body, agent) =>
    request("POST", `${home(agent)}/timeline/discord/rate`, body),
  // A POST: claiming spends a one-time credential, so it must not be
  // reachable by a link scanner, a prefetch, or a cross-site top-level
  // navigation (#31).
  gatewayEnv: (id) => request("POST", "/api/me/gateway-env", { id }),
  // The operator stages a fresh token for their own collector (#540); it
  // replaces the one the machine holds.
  gatewayToken: (id) => request("POST", "/api/me/gateway-token", { id }),
  gatewayDetail: (id) =>
    request("GET", `/api/me/gateway-detail?id=${encodeURIComponent(id)}`),
  myClanAction: (body, agent) => request("POST", `${home(agent)}/clans`, body),
  // An agent's players (2026-09-23): the same writer as /api/claims, at an
  // address its console can scope. It watches, only.
  agentPlayerAction: (body, agent) =>
    request("POST", `${home(agent)}/players`, body),
  // Fire-and-forget: a failed view must never surface to a user, and must
  // never delay a render.
  rotatePrincipalToken: (account_id) =>
    request("POST", "/api/me/principals/rotate", { account_id }),
  setPrincipalStatus: (account_id, status) =>
    request("POST", "/api/me/principals/status", { account_id, status }),
  // Out of view or back (0215); only a suspended agent can be removed.
  setPrincipalRemoved: (account_id, removed) =>
    request("POST", "/api/me/principals/remove", { account_id, removed }),
  renamePrincipal: (account_id, name) =>
    request("POST", "/api/me/principals/rename", { account_id, name }),
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
};
