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
import { useCallback } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { answered, unwrap } from "@elixir-mcp/client";
import { api } from "../api.js";
import { sweepBattles } from "./battle-sweep.js";
import { bellSeenAt } from "../shell/bell-logic.js";
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
  feedback: ["me", "feedback"],
  // Whether your timeline's RSS link is on (never the link itself).
  rss: ["me", "rss"],
  // Your highlights of one battle, and the players you may post it as.
  highlights: (battle) => ["me", "highlights", battle],
  verifyList: ["me", "verify"],
  callRecord: (id) => ["me", "requests", id],
  principalIdentities: (id) => ["me", "principals", id, "identities"],
  gatewayCards: ["gateway-cards"],
  gatewayDetail: (id) => ["me", "gateways", id],
  adminGateways: ["admin", "gateways"],
  adminAccounts: ["admin", "accounts"],
  adminUsage: ["admin", "usage"],
  adminDiscord: (days) => ["admin", "discord", days],
  adminDiscordDetail: (key, feature) => [
    "admin",
    "discord",
    "detail",
    key,
    feature ?? "",
  ],
  adminConnections: ["admin", "connections"],
  adminFeedback: ["admin", "feedback"],
  adminFeedbackPage: (q) => ["admin", "feedback", "queue", q],
  adminFeedbackItem: (id) => ["admin", "feedback", "item", String(id)],
  adminServiceTokens: ["admin", "service-tokens"],
  adminCall: (id) => ["admin", "calls", id],
  adminEmailSends: ["admin", "email", "sends"],
  adminCards: ["admin", "cards"],
  adminEmail: (id) => ["admin", "email", "sends", id],
  adminIntegrations: ["admin", "integrations"],
  status: ["status"],
  efficiency: ["efficiency"],
  cards: ["cards"],
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

/** What a Follow of `tag` would cost (#760), or nothing until there is a
 *  plausible tag. A tag already normalized by the caller keys the read, so
 *  "#abc" and "ABC" share one answer. */
export const useFollowCost = (tag) => {
  const agent = useScope();
  return useQuery({
    queryKey: scopedKey(agent, "follow-cost", tag ?? ""),
    queryFn: payload(() => api.followCost(tag, agent)),
    enabled: Boolean(tag),
    staleTime: 30_000,
    retry: false,
  });
};

export const useMyClans = () => {
  const agent = useScope();
  return useQuery({
    queryKey: scopedKey(agent, "clans"),
    queryFn: payload(() => api.myClans(agent)),
  });
};

/** Home's reads. Under ["me"], so a change to what you track refetches them.
 *  The head is what the page paints from; each slow panel then reads alone. */
export const useHome = () =>
  useQuery({ queryKey: ["me", "home"], queryFn: payload(api.home) });

/** Home's clan card. It opens from the copy kept on an earlier visit; when
 *  that copy says `refresh` (past fifteen minutes), the card is built again
 *  while the page shows it, and the new one takes its place. One build per
 *  read however many places draw the card (Home, the bell); a build that
 *  fails leaves the kept card. */
export const useHomeClan = (enabled = true) => {
  const kept = useQuery({
    queryKey: ["me", "home", "clan"],
    queryFn: payload(() => api.homeClan()),
    enabled,
  });
  const due = kept.data?.clan?.refresh === true;
  const built = useQuery({
    queryKey: ["home-clan-rebuild", kept.dataUpdatedAt],
    queryFn: payload(() => api.homeClan(true)),
    enabled: enabled && due,
    staleTime: Infinity,
    retry: false,
  });
  return due && built.data?.clan?.ok ? { ...kept, data: built.data } : kept;
};

export const useHomeNeeds = () =>
  useQuery({
    queryKey: ["me", "home", "needs"],
    queryFn: payload(api.homeNeeds),
  });

/** The bell's dot (slice 7): Home's Needs you read, shared with Home, and
 *  read again at most every few minutes as you move between pages. */
export const useBellNeeds = (enabled = true) =>
  useQuery({
    queryKey: ["me", "home", "needs"],
    queryFn: payload(api.homeNeeds),
    staleTime: 5 * 60 * 1000,
    enabled,
  });

/** The bell's other sections (2026-11-12): reactions, followers, answers and
 *  how many are new since you last opened it. Read as often as the dot. */
export const useBell = (enabled = true, { fresh = false } = {}) =>
  useQuery({
    queryKey: ["me", "bell"],
    queryFn: payload(api.bell),
    staleTime: 5 * 60 * 1000,
    // The open sheet reads it again, whatever the dot last read.
    ...(fresh ? { refetchOnMount: "always" } : {}),
    enabled,
  });

/** Opening the bell: what is in it now is seen. The dot goes out at once;
 *  the sheet keeps showing what was new while it stays open. */
export function useBellSeen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.bellSeen().then(unwrap),
    onSuccess: (data) =>
      queryClient.setQueryData(["me", "bell"], (old) =>
        old ? bellSeenAt(old, data?.seen_at ?? null) : old,
      ),
  });
}

/** No mode is the week's opening mode, which the read works out. */
export const useHomeWeek = (mode, enabled = true) =>
  useQuery({
    queryKey: ["me", "home", "week", mode ?? null],
    queryFn: payload(() => api.homeWeek(mode)),
    enabled,
  });

/** A player's page (#764). Under ["me"]: who you follow changes it. */
export const usePlayerPage = (tag) =>
  useQuery({
    queryKey: ["me", "player", tag ?? ""],
    queryFn: answered(() => api.playerPage(tag)),
    enabled: Boolean(tag),
    staleTime: 30_000,
  });

/** A player's record, the Record tab of their page (2026-11-12, from
 *  Explore's player and profile records): what Elixir recorded over 30
 *  days and the last profile read, through the bridge Find's search uses.
 *  Read only when the tab is open: each is one call on the hourly bucket. */
export const usePlayerRecord = (tag, enabled) =>
  useQuery({
    queryKey: ["me", "player-record", tag ?? ""],
    enabled: Boolean(tag) && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const read = async (tool) => {
        const r = await api.explore(tool, { player_tag: tag });
        if (!r.ok) throw new Error("request failed");
        if (!r.data?.is_error) return r.data?.body ?? null;
        // Only "not recorded" is an absent half; a timeout or a server
        // failure is the tab's error state, with its retry.
        const code = r.data.body?.error?.code;
        if (code === "not_recorded" || code === "not_found") return null;
        throw new Error(code ?? "refused");
      };
      const [summary, profile] = await Promise.all([
        read("players_summary"),
        read("players_profile"),
      ]);
      return { summary, profile };
    },
  });

/** Read a player's page again (its games changed under an open View games). */
export const useRefreshPlayerPage = (tag) => {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: ["me", "player", tag ?? ""] });
};

/** A sitting's games on a player's page (View games, G7): the page's own
 *  read, so it works for any player the page shows. */
export const usePlayerEvidence = (params) =>
  useQuery({
    queryKey: ["me", "player-evidence", params],
    staleTime: 0,
    queryFn: payload(() => api.playerEvidence(params)),
    enabled: Boolean(params),
  });

/** What following a list of players, or a clan, costs (#764). */
export const useFollowPlan = (ask, enabled = true) =>
  useQuery({
    queryKey: [
      "me",
      "follow-plan",
      ask?.clan_tag ?? "",
      (ask?.player_tags ?? []).join(","),
    ],
    queryFn: payload(() => api.followPlan(ask)),
    enabled:
      enabled && Boolean(ask?.clan_tag || (ask?.player_tags ?? []).length),
    staleTime: 15_000,
    retry: false,
  });

/** Your follow slots, player by player (Settings, 2026-11-12). Under
 *  ["me"], so a Follow or a stop anywhere refreshes the meter. */
export const useFollowSlots = () =>
  useQuery({
    queryKey: ["me", "follow-slots"],
    queryFn: payload(() => api.followSlots()),
    staleTime: 15_000,
  });

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

/** Home's feed (2026-11-12): the timeline's items without your account's
 *  own lines, which the bell tells, thirty a page (G1). Yours, never an
 *  agent's. A read that timed out is not asked again on its own: the feed
 *  says so and offers Try again, rather than a blank box for 40 s. */
export const HOME_FEED_KEY = ["me", "home", "feed"];
export const useHomeFeed = () =>
  useInfiniteQuery({
    queryKey: HOME_FEED_KEY,
    queryFn: ({ pageParam }) => api.homeFeed(pageParam).then(unwrap),
    initialPageParam: null,
    getNextPageParam: (last) => last?.next ?? undefined,
    retry: false,
  });

/** One of Home's items' evidence (View games, View crossing). */
export const useHomeFeedEvidence = (params) =>
  useQuery({
    queryKey: ["me", "home", "feed-evidence", params],
    staleTime: 0,
    queryFn: payload(() => api.homeFeedEvidence(params)),
    enabled: Boolean(params),
  });

/** Each item of a cached list, changed by `fn`: a plain read's `list`, or
 *  every page's of a paged one (Home's feed). */
const mapItems = (old, list, fn) =>
  !old
    ? old
    : Array.isArray(old.pages)
      ? {
          ...old,
          pages: old.pages.map((p) =>
            p?.[list] ? { ...p, [list]: p[list].map(fn) } : p,
          ),
        }
      : old[list]
        ? { ...old, [list]: old[list].map(fn) }
        : old;

/** Your timeline's RSS link (#765): on or off, and since when. */
export const useRssLink = () =>
  useQuery({ queryKey: keys.rss, queryFn: payload(api.rssLink) });

/** Your cheer on an item, shown at once: the cached copy takes the change
 *  before the write, the server's counts after it, and the copy from before
 *  if it was refused. Yours, never an agent's. Home's feed by default; a
 *  player page or a battle page passes its own cheers read
 *  (`usePageCheers`): `{ key, list: "items" }`. */
/** Home's feed, where most cheers are given. */
const CHEER_FEED_KEY = HOME_FEED_KEY;

export function useCheer({ key = CHEER_FEED_KEY, list = "timeline" } = {}) {
  const queryClient = useQueryClient();
  const put = (item) =>
    queryClient.setQueryData(key, (old) =>
      mapItems(old, list, (it) => (it.id === item.id ? item : it)),
    );
  return useMutation({
    mutationFn: async ({ item, next }) => {
      const res = await api.cheer({
        item_id: item.id,
        cheer: next,
        // The item's subjects, so the server rebuilds only their days to
        // find it (feed.mjs reads the same two fields). A page's item
        // carries the follows its cheers read came through instead.
        subjects: item.cheer_subjects ?? [
          ...new Set(
            [
              item.subject_tag,
              ...(item.subjects ?? []).map((s) => s.tag),
            ].filter(Boolean),
          ),
        ],
      });
      if (!res.ok) throw new Error(res.data?.message ?? "Not saved");
      return res.data;
    },
    onMutate: async ({ item, shown }) => {
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      put(shown);
      return { item };
    },
    onSuccess: (data, { shown }) => {
      put({ ...shown, cheers: data.cheers, my_cheer: data.my_cheer });
      // Every other copy of the item (Home's feed, a player page's or a
      // battle page's cheers read) takes the server's counts too, so a
      // stale copy never shows the old cheer or sends it again.
      const patch = (it) =>
        it.id === shown.id
          ? { ...it, cheers: data.cheers, my_cheer: data.my_cheer }
          : it;
      queryClient.setQueryData(CHEER_FEED_KEY, (old) =>
        mapItems(old, "timeline", patch),
      );
      queryClient.setQueriesData({ queryKey: ["me", "cheers"] }, (old) =>
        mapItems(old, "items", patch),
      );
    },
    onError: (_err, _vars, context) => {
      if (context?.item) put(context.item);
    },
  });
}

/** Which of a player page's or a battle page's items take cheers for you
 *  (the ones in your feed now), with their counts: `{ player }` or
 *  `{ battle }`. Signed in only; the page asks only then. */
export const pageCheersKey = ({ player = null, battle = null }) => [
  "me",
  "cheers",
  player ? "player" : "battle",
  player ?? battle ?? "",
];
export const usePageCheers = (ask, enabled = true) =>
  useQuery({
    queryKey: pageCheersKey(ask),
    queryFn: payload(() => api.pageCheers(ask)),
    enabled: enabled && Boolean(ask.player || ask.battle),
    staleTime: 30_000,
    retry: false,
  });

/** Home's People to follow, and Find's From your battles and Your clan
 *  (2026-11-12): each its own read. */
export const usePeople = (which, enabled = true) =>
  useQuery({
    queryKey: ["me", "people", which],
    queryFn: payload(() => api.people(which)),
    enabled,
    staleTime: 60_000,
  });

/** The battle page's highlight panel (#762): your posts of this battle
 *  and the verified players you may post it as. Yours, never an agent's. */
export const useMyHighlights = (battle, enabled = true) =>
  useQuery({
    queryKey: keys.highlights(battle),
    queryFn: payload(() => api.myHighlights(battle)),
    enabled: enabled && Boolean(battle),
  });

/** Move the Console's place in the timeline to the window end the page
 *  showed (Jamie, 2026-10-20: independent of what agents have read via
 *  MCP). The page's own copy takes the new place, so a return visit
 *  opens from it, and the console's `me` refetches so the rail's dot
 *  follows. Nothing else refetches: the feed's next read would move the
 *  window and ask to mark again. */
export function useMarkTimelineSeen() {
  const queryClient = useQueryClient();
  const agent = useScope();
  return useCallback(
    async (to) => {
      const res = await api.markTimelineSeen(to, agent);
      if (!res.ok) return res;
      const place = (old) =>
        old ? { ...old, seen_to: res.data.seen_to } : old;
      queryClient.setQueryData(scopedKey(agent, "feed"), place);
      // Home's feed shares your place (never an agent's); its first page
      // carries it.
      if (!agent)
        queryClient.setQueryData(HOME_FEED_KEY, (old) =>
          old?.pages?.length
            ? { ...old, pages: [place(old.pages[0]), ...old.pages.slice(1)] }
            : old,
        );
      const queryKey = rootFor(agent);
      await queryClient.cancelQueries({ queryKey, exact: true });
      await queryClient.invalidateQueries({ queryKey, exact: true });
      return res;
    },
    [queryClient, agent],
  );
}

/** The timeline's Discord cross-post. On an agent's settings page the
 *  agent is named outright; elsewhere it is the console's scope. */
export const useTimelineDiscord = (agentId = null) => {
  const scoped = useScope();
  const agent = agentId ?? scoped;
  return useQuery({
    queryKey: scopedKey(agent, "feed-discord"),
    queryFn: payload(() => api.timelineDiscord(agent)),
  });
};

export const useTimelineEvidence = (params) => {
  const agent = useScope();
  return useQuery({
    queryKey: [...scopedKey(agent, "feed-evidence"), params],
    staleTime: 0,
    queryFn: payload(() => api.timelineEvidence(params, agent)),
    enabled: Boolean(params),
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

export const useAdminAccounts = adminRead(
  keys.adminAccounts,
  api.adminAccounts,
);
export const useAdminUsage = adminRead(keys.adminUsage, api.adminUsage);
/** The Discord features' quality over a window (the ledger, 0222). */
export const useAdminDiscord = (days) =>
  useQuery({
    queryKey: keys.adminDiscord(days),
    queryFn: payload(() => api.adminDiscord(days)),
  });
/** One clan's (by tag) or one timeline's (by account id) posts whole. */
export const useAdminDiscordDetail = (key, feature) =>
  useQuery({
    queryKey: keys.adminDiscordDetail(key, feature),
    queryFn: payload(() => api.adminDiscordDetail(key, feature)),
    enabled: Boolean(key),
  });
export const useAdminConnections = adminRead(
  keys.adminConnections,
  api.adminConnections,
);
/** The one queue (0204), filtered and paged on the server: `q` is
 *  { area, status, category, unanswered, before, after, order }. */
export const useAdminFeedback = (q = {}) =>
  useQuery({
    queryKey: keys.adminFeedbackPage(q),
    queryFn: payload(() => api.adminFeedback(q)),
  });

/** One item for the maintainer, any filer's, with its thread. */
export const useAdminFeedbackItem = (id) =>
  useQuery({
    queryKey: keys.adminFeedbackItem(id),
    queryFn: payload(() => api.adminFeedbackItem(id)),
    enabled: Boolean(id),
  });
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

export const useMyFeedback = () => {
  const agent = useScope();
  return useQuery({
    queryKey: scopedKey(agent, "feedback"),
    queryFn: payload(() => api.myFeedback(agent)),
  });
};

/** One of your own items (or, on an agent's console, the agent's), with
 *  what follows it. Opening it on your own console reads its answer. */
export const useMyFeedbackItem = (id) => {
  const agent = useScope();
  return useQuery({
    queryKey: scopedKey(agent, "feedback", String(id)),
    queryFn: payload(() => api.feedbackItem(id, agent)),
    enabled: Boolean(id),
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

export const useMyGateways = ({ enabled = true } = {}) =>
  useQuery({
    queryKey: keys.gateways,
    queryFn: payload(api.myGateways),
    enabled,
  });

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

/** Public: the card catalog, read once a session for each card's art
 *  (2026-10-08, Jamie: "Card art should be in the api response for
 *  cards"). It changes when Supercell adds a card or a form, so an hour
 *  is fresh enough; the edge keeps it as long. */
export const useCardCatalog = ({ enabled = true } = {}) =>
  useQuery({
    queryKey: keys.cards,
    queryFn: payload(api.publicCards),
    staleTime: 60 * 60 * 1000,
    enabled,
  });

/** One tool's answer through Stats' door (`/api/me/stats`, the explore
 *  bridge for your own players and those you follow), as Ladder reads it:
 *  the body, or a thrown error carrying the tool's code when the tool
 *  refused. Keyed under the reader's root, because what it reads is
 *  theirs and a timezone change (the days a battle falls on) or a sign
 *  in must refetch it. Ladder pages cache for minutes and never poll:
 *  a person's own reads spend no daily quota (#538) but do share the
 *  hourly bucket with their own MCP clients. */
async function toolRead(tool, args) {
  const r = unwrap(await api.stats(tool, args));
  if (r?.is_error) {
    const e = new Error(r.body?.error?.message ?? `${tool} refused`);
    e.code = r.body?.error?.code;
    e.hint = r.body?.error?.hint;
    throw e;
  }
  return r?.body ?? null;
}
const ladderKey = (tool, args) => ["me", "ladder", tool, args];
export const useToolRead = (tool, args, { enabled = true } = {}) =>
  useQuery({
    queryKey: ladderKey(tool, args),
    queryFn: () => toolRead(tool, args),
    enabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

/** Several reads of one tool, one query each (a page that reads one
 *  answer per mode, or one per deck it shows). Each is cached under the
 *  key useToolRead would use, so a read one page made is not made again
 *  by the next. */
export const useToolReads = (tool, list, { enabled = true } = {}) =>
  useQueries({
    queries: list.map((args) => ({
      queryKey: ladderKey(tool, args),
      queryFn: () => toolRead(tool, args),
      enabled,
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    })),
  });

/** The most pages one sweep reads: 12 of 40 is the newest 480 battles,
 *  twelve calls of the reader's hourly bucket at most. */
const SWEEP_PAGES = 12;

export const useBattleSweep = (
  args,
  { enabled = true, pages = SWEEP_PAGES } = {},
) =>
  useQuery({
    queryKey: ladderKey("battles_query:sweep", { ...args, pages }),
    queryFn: () => sweepBattles(toolRead, args, pages),
    enabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

/** `invalidate(keys.sessions)` after a mutation: the read refetches and
 *  every screen showing it follows. `invalidate()` with no key is the
 *  console's root: the session and everything that is the reader's own,
 *  or, on an agent's console, everything that is the agent's.
 *
 *  In-flight reads are cancelled first. A read with no data yet that is
 *  still in flight when the write lands is not refetched by
 *  invalidateQueries: TanStack joins the pending fetch, which read before
 *  the write, and the page shows the list without the row just created
 *  (the admin integrations journey, flaky on CI 2026-09-24). */
export function useInvalidate() {
  const queryClient = useQueryClient();
  const agent = useScope();
  return async (queryKey = rootFor(agent)) => {
    await queryClient.cancelQueries({ queryKey });
    return queryClient.invalidateQueries({ queryKey });
  };
}
