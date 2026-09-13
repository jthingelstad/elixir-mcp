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
  connections: ["me", "connections"],
  principals: ["me", "principals"],
  collections: ["me", "collections"],
  feedback: ["me", "feedback"],
  verifyList: ["me", "verify"],
  callRecord: (id) => ["me", "requests", id],
  status: ["status"],
  stats: ["stats"],
};

const payload = (call) => () => call().then(unwrap);

export const useUsage = () =>
  useQuery({ queryKey: keys.usage, queryFn: payload(api.usage) });

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

export const useMyEvents = (enabled = true) =>
  useQuery({ queryKey: keys.feed, queryFn: payload(api.myEvents), enabled });

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

export const usePublicStats = () =>
  useQuery({ queryKey: keys.stats, queryFn: payload(api.publicStats) });

/** `invalidate(keys.sessions)` after a mutation: the read refetches and
 *  every screen showing it follows. `invalidate()` with no key is the
 *  session and everything that is the reader's own. */
export function useInvalidate() {
  const queryClient = useQueryClient();
  return (queryKey = keys.me) => queryClient.invalidateQueries({ queryKey });
}
