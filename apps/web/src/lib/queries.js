/**
 * The console's queries: one place for keys and one hook per read, so
 * two screens cannot disagree about the same data and a mutation knows
 * what to invalidate.
 *
 * Key convention: the reader's OWN things start with "me" - the session
 * itself is ["me"], usage ["me", "usage"], claims' activity ["me",
 * "activity", tag]. Invalidating ["me"] therefore refetches everything
 * that is theirs, which is what a sign-in, a claim or a timezone change
 * wants. Public reads (status, corpus stats) have their own roots.
 *
 * A hook's data is the payload (unwrap throws the envelope as ApiError,
 * so a refused read is `error`, with its status), except where a view
 * branches on the status itself; those use answered() and keep the
 * envelope.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { answered, unwrap } from "@elixir-mcp/client";
import { api } from "../api.js";

export const keys = {
  me: ["me"],
  usage: ["me", "usage"],
  clans: ["me", "clans"],
  activity: (tag) => ["me", "activity", tag],
  requests: ["me", "requests"],
  events: ["me", "events"],
  feed: ["me", "feed"],
  gateways: ["me", "gateways"],
  sessions: ["me", "sessions"],
  email: ["me", "email"],
  emailSends: ["me", "email", "sends"],
  emailRecord: (id) => ["me", "email", "sends", id],
  connections: ["me", "connections"],
  principals: ["me", "principals"],
  collections: ["me", "collections"],
  feedback: ["me", "feedback"],
  verifyList: ["me", "verify"],
  callRecord: (id) => ["me", "requests", id],
  principalEvents: (id) => ["me", "principals", id, "events"],
  principalIdentities: (id) => ["me", "principals", id, "identities"],
  gatewayCards: ["gateway-cards"],
  gatewayDetail: (id) => ["me", "gateways", id],
  adminGateways: ["admin", "gateways"],
  adminRequests: ["admin", "requests"],
  adminAccounts: ["admin", "accounts"],
  adminUsage: ["admin", "usage"],
  adminConnections: ["admin", "connections"],
  adminFeedback: ["admin", "feedback"],
  adminServiceTokens: ["admin", "service-tokens"],
  adminCall: (id) => ["admin", "calls", id],
  adminEmailSends: ["admin", "email", "sends"],
  adminCards: ["admin", "cards"],
  adminEmail: (id) => ["admin", "email", "sends", id],
  adminIntegrations: ["admin", "integrations"],
  adminCollections: ["admin", "collections"],
  status: ["status"],
  efficiency: ["efficiency"],
  stats: ["stats"],
  exploreCollections: ["explore", "collections"],
};

const payload = (call) => () => call().then(unwrap);

export const useUsage = () =>
  useQuery({ queryKey: keys.usage, queryFn: payload(api.usage) });

export const useEmailPrefs = () =>
  useQuery({ queryKey: keys.email, queryFn: payload(api.emailPrefs) });

export const useMyEmailSends = (enabled = true) =>
  useQuery({
    queryKey: keys.emailSends,
    queryFn: payload(api.myEmailSends),
    enabled,
  });

/** An email record branches on the status like a call record (404 is
 *  "not one of yours"), so it keeps the envelope. */
export const useEmailRecord = (id) =>
  useQuery({
    queryKey: keys.emailRecord(id),
    queryFn: answered(() => api.emailRecord(id)),
    enabled: Boolean(id),
  });

export const useMyClans = () =>
  useQuery({ queryKey: keys.clans, queryFn: payload(api.myClans) });

export const useBattleActivity = (tag) =>
  useQuery({
    queryKey: keys.activity(tag),
    queryFn: payload(() => api.battleActivity(tag)),
    enabled: Boolean(tag),
  });

export const useMyRequests = (enabled = true) =>
  useQuery({
    queryKey: keys.requests,
    queryFn: payload(api.myRequests),
    enabled,
  });

export const useActivityEvents = (enabled = true) =>
  useQuery({
    queryKey: keys.events,
    queryFn: payload(api.activity),
    enabled,
  });

export const useMyTimeline = (enabled = true) =>
  useQuery({
    queryKey: keys.feed,
    queryFn: payload(api.myTimeline),
    enabled,
  });

export const useSessions = () =>
  useQuery({ queryKey: keys.sessions, queryFn: payload(api.sessions) });

export const useConnections = () =>
  useQuery({
    queryKey: keys.connections,
    queryFn: payload(api.connections),
  });

export const useMyPrincipals = () =>
  useQuery({
    queryKey: keys.principals,
    queryFn: payload(api.myPrincipals),
  });

/** An agent's own log and identities, keyed under its principal so
 *  invalidating ["me", "principals"] takes the agent list and every
 *  agent's detail with it. */
export const usePrincipalTimeline = (id) =>
  useQuery({
    queryKey: keys.principalEvents(id),
    queryFn: payload(() => api.principalTimeline(id)),
    enabled: Boolean(id),
  });

export const usePrincipalIdentities = (id) =>
  useQuery({
    queryKey: keys.principalIdentities(id),
    queryFn: payload(() => api.principalIdentities(id)),
    enabled: Boolean(id),
  });

export const useGatewayCards = ({ enabled = true } = {}) =>
  useQuery({
    queryKey: keys.gatewayCards,
    queryFn: payload(api.gatewayCards),
    enabled,
  });

export const useGatewayDetail = (id) =>
  useQuery({
    queryKey: keys.gatewayDetail(id),
    queryFn: payload(() => api.gatewayDetail(id)),
    enabled: Boolean(id),
  });

/** Admin reads: their own root, because they are the service's, not
 *  the reader's. */
export const useAdminGateways = ({ enabled = true } = {}) =>
  useQuery({
    queryKey: keys.adminGateways,
    queryFn: payload(api.adminGateways),
    enabled,
  });

const adminRead = (queryKey, call) => () =>
  useQuery({ queryKey, queryFn: payload(call) });

export const useAdminRequests = adminRead(
  keys.adminRequests,
  api.adminRequests,
);
export const useAdminAccounts = adminRead(
  keys.adminAccounts,
  api.adminAccounts,
);
export const useAdminUsage = adminRead(keys.adminUsage, api.adminUsage);
export const useAdminConnections = adminRead(
  keys.adminConnections,
  api.adminConnections,
);
export const useAdminFeedback = adminRead(
  keys.adminFeedback,
  api.adminFeedback,
);
export const useAdminServiceTokens = adminRead(
  keys.adminServiceTokens,
  api.adminServiceTokens,
);

/** A call attached to a feedback note; a miss (not in the log) is the
 *  error, and the panel says so. */
export const useAdminCall = (id) =>
  useQuery({
    queryKey: keys.adminCall(id),
    queryFn: payload(() => api.adminCall(id)),
    enabled: Boolean(id),
  });

/** Every product email sent, every account: the audit of what we send. */
export const useAdminEmailSends = adminRead(
  keys.adminEmailSends,
  api.adminEmailSends,
);

/** The card catalog with its archetype roles and the unattested queue. */
export const useAdminCards = adminRead(keys.adminCards, api.adminCards);

/** An email attached to a feedback note, or opened from the sends
 *  audit: the row and the body as sent. */
export const useAdminEmail = (id) =>
  useQuery({
    queryKey: keys.adminEmail(id),
    queryFn: payload(() => api.adminEmail(id)),
    enabled: Boolean(id),
  });

export const useAdminIntegrations = () =>
  useQuery({
    queryKey: keys.adminIntegrations,
    queryFn: payload(api.adminIntegrations),
  });

export const useAdminCollections = () =>
  useQuery({
    queryKey: keys.adminCollections,
    queryFn: payload(api.adminCollections),
  });

export const useMyCollections = () =>
  useQuery({
    queryKey: keys.collections,
    queryFn: payload(api.myCollections),
  });

export const useMyFeedback = () =>
  useQuery({ queryKey: keys.feedback, queryFn: payload(api.myFeedback) });

export const useVerifyList = () =>
  useQuery({ queryKey: keys.verifyList, queryFn: payload(api.verifyList) });

/** A call record branches on the status (404 is "no such request",
 *  403 "not yours"), so it keeps the envelope. */
export const useCallRecord = (id) =>
  useQuery({
    queryKey: keys.callRecord(id),
    queryFn: answered(() => api.callRecord(id)),
    enabled: Boolean(id),
  });

export const useMyGateways = () =>
  useQuery({ queryKey: keys.gateways, queryFn: payload(api.myGateways) });

/** Public: the service status. `refetchInterval` is the page's auto
 *  toggle - off by default and visible either way. */
export const usePublicStatus = (refetchInterval = false) =>
  useQuery({
    queryKey: keys.status,
    queryFn: payload(api.publicStatus),
    refetchInterval,
  });

/** Public: the session clock's cost and loss per day (0145). */
export const usePublicEfficiency = () =>
  useQuery({
    queryKey: keys.efficiency,
    queryFn: payload(api.publicEfficiency),
  });

/** The collections the lookup offers: one bridge call, cached like a
 *  record. A tool error reads as an empty list, as it always did. */
export const useExploreCollections = () =>
  useQuery({
    queryKey: keys.exploreCollections,
    queryFn: async () => {
      const r = unwrap(await api.explore("collections_browse"));
      return r.is_error ? [] : (r.body?.collections ?? []);
    },
  });

export const usePublicStats = () =>
  useQuery({ queryKey: keys.stats, queryFn: payload(api.publicStats) });

/** `invalidate(keys.sessions)` after a mutation: the read refetches and
 *  every screen showing it follows. `invalidate()` with no key is the
 *  session and everything that is the reader's own. */
export function useInvalidate() {
  const queryClient = useQueryClient();
  return (queryKey = keys.me) => queryClient.invalidateQueries({ queryKey });
}
