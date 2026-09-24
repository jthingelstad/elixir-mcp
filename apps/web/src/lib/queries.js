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
import { useScope } from "./scope.js";

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

/**
 * The root of a console's own keys: `["me"]` for yours, `["agent", id]`
 * for an agent's (2026-09-23). Every read that an agent's console shares
 * with yours keys under its console's root, so switching can never paint
 * one account's data under the other's header, and invalidating a root
 * refetches everything that console shows. The hooks below read the
 * scope themselves; yours keep exactly the keys they always had.
 */
export const rootFor = (agent) => (agent ? ["agent", agent] : keys.me);
export const scopedKey = (agent, ...rest) => [...rootFor(agent), ...rest];

/** An agent's own `me`, for its console and for the rail's counts. It
 *  keeps the envelope: a 404 is "not your agent", an answer, not an error. */
export const useAgentMe = (agent) =>
  useQuery({
    queryKey: rootFor(agent),
    queryFn: answered(() => api.me(agent)),
    enabled: Boolean(agent),
  });

export const useUsage = () => {
  const agent = useScope();
  return useQuery({
    queryKey: scopedKey(agent, "usage"),
    queryFn: payload(() => api.usage(agent)),
  });
};

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

export const useMyRequests = (enabled = true) => {
  const agent = useScope();
  return useQuery({
    queryKey: scopedKey(agent, "requests"),
    queryFn: payload(() => api.myRequests(agent)),
    enabled,
  });
};

export const useActivityEvents = (enabled = true) => {
  const agent = useScope();
  return useQuery({
    queryKey: scopedKey(agent, "events"),
    queryFn: payload(() => api.activity(agent)),
    enabled,
  });
};

export const useMyTimeline = (enabled = true) => {
  const agent = useScope();
  return useQuery({
    queryKey: scopedKey(agent, "feed"),
    queryFn: payload(() => api.myTimeline(agent)),
    enabled,
  });
};

export const useSessions = () =>
  useQuery({ queryKey: keys.sessions, queryFn: payload(api.sessions) });

export const useConnections = () => {
  const agent = useScope();
  return useQuery({
    queryKey: scopedKey(agent, "connections"),
    queryFn: payload(() => api.connections(agent)),
  });
};

export const useMyPrincipals = () =>
  useQuery({
    queryKey: keys.principals,
    queryFn: payload(api.myPrincipals),
  });

/** An agent's own log and identities, keyed under its principal so
 *  invalidating ["me", "principals"] takes the agent list and every
 *  agent's detail with it. */
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

export const useMyFeedback = () => {
  const agent = useScope();
  return useQuery({
    queryKey: scopedKey(agent, "feedback"),
    queryFn: payload(() => api.myFeedback(agent)),
  });
};

export const useVerifyList = () =>
  useQuery({ queryKey: keys.verifyList, queryFn: payload(api.verifyList) });

/** A call record branches on the status (404 is "no such request",
 *  403 "not yours"), so it keeps the envelope. */
export const useCallRecord = (id) => {
  const agent = useScope();
  return useQuery({
    queryKey: scopedKey(agent, "requests", id),
    queryFn: answered(() => api.callRecord(id, agent)),
    enabled: Boolean(id),
  });
};

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
 *  console's root: the session and everything that is the reader's own,
 *  or, on an agent's console, everything that is the agent's. */
export function useInvalidate() {
  const queryClient = useQueryClient();
  const agent = useScope();
  return (queryKey = rootFor(agent)) =>
    queryClient.invalidateQueries({ queryKey });
}
