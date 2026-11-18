/**
 * The app's queries: one place for keys and one hook per read, so
 * two screens cannot disagree about the same data and a mutation knows
 * what to invalidate.
 *
 * Key convention: the reader's OWN things start with "me" - the session
 * itself is ["me"], usage ["me", "usage"], their clans ["me", "clans"].
 * Invalidating ["me"] therefore refetches everything
 * that is theirs, which is what a sign-in, a claim or a timezone change
 * wants. Public reads (status, corpus stats) have their own roots.
 *
 * A hook's data is the payload (unwrap throws the envelope as ApiError,
 * so a refused read is `error`, with its status), except where a view
 * branches on the status itself; those use answered() and keep the
 * envelope.
 */
import { useCallback, useEffect } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { answered, unwrap } from "../client/index.ts";
import { api } from "../api.js";
import { sweepBattles } from "./battle-sweep.js";
import { reconcileOnOpen } from "./passport.js";
import { bellSeenAt } from "../shell/bell-logic.js";
import { useScope } from "./scope.js";

export const keys = {
  me: ["me"],
  usage: ["me", "usage"],
  clans: ["me", "clans"],
  requests: ["me", "requests"],
  events: ["me", "events"],
  feed: ["me", "feed"],
  gateways: ["me", "gateways"],
  sessions: ["me", "sessions"],
  email: ["me", "email"],
  push: ["me", "push"],
  emailSends: ["me", "email", "sends"],
  emailRecord: (id) => ["me", "email", "sends", id],
  connections: ["me", "connections"],
  principals: ["me", "principals"],
  feedback: ["me", "feedback"],
  // Whether your timeline's RSS link is on (never the link itself).
  rss: ["me", "rss"],
  // Your posts about one battle, and the players you may post it as:
  // under ["me", "posts"], so every post change reads it again.
  battlePosts: (battle) => ["me", "posts", "battle", battle],
  verifyList: ["me", "verify"],
  callRecord: (id) => ["me", "requests", id],
  principalIdentities: (id) => ["me", "principals", id, "identities"],
  gatewayCards: ["gateway-cards"],
  gatewayDetail: (id) => ["me", "gateways", id],
  adminGateways: ["admin", "gateways"],
  adminAccounts: ["admin", "accounts"],
  adminUsage: ["admin", "usage"],
  adminEfficiency: ["admin", "efficiency"],
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
  status: ["status"],
  cards: ["cards"],
};

const payload = (call) => () => call().then(unwrap);

/**
 * The root of a scope's own keys: `["me"]` for yours, `["agent", id]`
 * for an agent's (2026-09-23). Every read that an agent's pages share
 * with yours keys under its scope's root, so switching can never paint
 * one account's data under the other's header, and invalidating a root
 * refetches everything that scope shows. The hooks below read the
 * scope themselves; yours keep exactly the keys they always had.
 */
export const rootFor = (agent) => (agent ? ["agent", agent] : keys.me);
export const scopedKey = (agent, ...rest) => [...rootFor(agent), ...rest];

/** An agent's own `me`, for its pages and for the rail's counts. It
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

export const usePush = (enabled = true) =>
  useQuery({ queryKey: keys.push, queryFn: payload(api.push), enabled });

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

/** Your circle this week (2026-11-16): its own read, so the feed never
 *  waits on it. */
export const HOME_CIRCLE_KEY = ["me", "home", "circle"];
export const useHomeCircle = () =>
  useQuery({
    queryKey: HOME_CIRCLE_KEY,
    queryFn: payload(api.homeCircle),
    staleTime: 60_000,
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

/** An account's page (2026-11-15). Under ["me"]: whether you follow it
 *  changes it. */
export const useAccountPage = (id) =>
  useQuery({
    queryKey: ["me", "account", id ?? ""],
    queryFn: answered(() => api.accountPage(id)),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

/** Your passport (#1015): the public projection plus `owner` (the
 *  profile steps and each Stamp's exact progress). */
export const useMyPassport = (enabled = true) =>
  useQuery({
    queryKey: ["me", "passport"],
    queryFn: answered(() => api.myPassport()),
    enabled,
    staleTime: 30_000,
  });

/** Your passport's reconciliation on open (#1015): after the first paint,
 *  quietly, bounded (lib/passport.js reconcilePassport), and not again
 *  within a minute of a finished run unless a write that could earn came
 *  between (reconcileOnOpen's gate). Once a pass answers, your passport
 *  reads again (progress can move without a new level); the bell reads
 *  again only when a Stamp was granted. Home calls it too. */
export function useReconcilePassport(enabled = true) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    reconcileOnOpen(() => api.reconcilePassport()).then((result) => {
      if (!result || result.read === 0) return;
      queryClient.invalidateQueries({ queryKey: ["me", "passport"] });
      if (result.granted > 0)
        queryClient.invalidateQueries({ queryKey: ["me", "bell"] });
    });
  }, [enabled, queryClient]);
}

/** Another member's passport by its id: the public projection alone. */
export const usePassport = (id) =>
  useQuery({
    queryKey: ["me", "passport-view", id ?? ""],
    queryFn: answered(() => api.passport(id)),
    enabled: Boolean(id),
    staleTime: 60_000,
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
        const r = await api.tool(tool, { player_tag: tag });
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

/** One sitting's page (2026-11-16): the item, a page of its games, the
 *  moments they proved. */
export const usePlayerSession = (params) =>
  useQuery({
    queryKey: ["me", "player-session", params],
    staleTime: 30_000,
    queryFn: answered(() => api.playerSession(params)),
    enabled: Boolean(params?.tag && params?.id),
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
/** One mode's feed (2026-11-17) is its own read under the feed's key, so
 *  its pages are cut in that mode; All modes is the key itself. Every
 *  write that patches the feed patches each mode's copy (setQueriesData). */
export const homeFeedKey = (mode = null, questionsOnly = false) => {
  const key = mode ? [...HOME_FEED_KEY, mode] : HOME_FEED_KEY;
  return questionsOnly ? [...key, "questions"] : key;
};
export const useHomeFeed = (mode = null, questionsOnly = false) =>
  useInfiniteQuery({
    queryKey: homeFeedKey(mode, questionsOnly),
    queryFn: ({ pageParam }) =>
      api.homeFeed(pageParam, mode, questionsOnly).then(unwrap),
    initialPageParam: null,
    getNextPageParam: (last) => last?.next ?? undefined,
    retry: false,
    // Nothing moves under the reader (2026-11-14): coming back to the tab
    // asks the pill's cheap count instead (useHomeFeedNew), and the feed is
    // read again when the reader taps it.
    refetchOnWindowFocus: false,
  });

/** How often an open Home asks whether its feed has new items. */
export const FEED_NEW_POLL_MS = 60_000;
export const HOME_FEED_NEW_KEY = ["me", "home", "feed-new"];

/** Home's "N new" pill (2026-11-14): how many items the stored week holds
 *  newer than `since`, the newest one the feed shows. One cheap read a
 *  minute while Home is open, and when the tab comes back; TanStack holds
 *  the interval while the tab is hidden (refetchIntervalInBackground is
 *  off). A failed count is no pill, never an error. */
export const useHomeFeedNew = (since, questionsOnly = false) =>
  useQuery({
    queryKey: [...HOME_FEED_NEW_KEY, since, questionsOnly],
    queryFn: async () => {
      const r = await api.homeFeedNew(since, questionsOnly);
      return r.ok ? (r.data?.new ?? 0) : 0;
    },
    enabled: Boolean(since),
    staleTime: 30_000,
    refetchInterval: FEED_NEW_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });

/** Read Home's feed again from its first page, as the pill's tap asks:
 *  the pages past the first are let go, so the read is one page. */
export async function reloadHomeFeed(
  queryClient,
  mode = null,
  questionsOnly = false,
) {
  const queryKey = homeFeedKey(mode, questionsOnly);
  queryClient.setQueryData(queryKey, (old) =>
    old?.pages?.length > 1
      ? { pages: old.pages.slice(0, 1), pageParams: old.pageParams.slice(0, 1) }
      : old,
  );
  await queryClient.refetchQueries({ queryKey, exact: true });
}

/** One of Home's items' evidence (View games, View crossing). */
export const useHomeFeedEvidence = (params) =>
  useQuery({
    queryKey: ["me", "home", "feed-evidence", params],
    staleTime: 0,
    queryFn: payload(() => api.homeFeedEvidence(params)),
    enabled: Boolean(params),
  });

/** A container's item or array of items, changed through the same cache
 * mapping: lists, paged reads and answered envelopes keep their shape. */
const mapItemValue = (value, fn) =>
  Array.isArray(value)
    ? value.map(fn)
    : value && typeof value === "object"
      ? fn(value)
      : value;

/** Each item at `list`, including a singular member post's `item`. */
const mapItems = (old, list, fn) =>
  !old
    ? old
    : Array.isArray(old.pages)
      ? {
          ...old,
          pages: old.pages.map((p) =>
            p?.[list] ? { ...p, [list]: mapItemValue(p[list], fn) } : p,
          ),
        }
      : old[list]
        ? { ...old, [list]: mapItemValue(old[list], fn) }
        : old.data?.[list]
          ? // An envelope Clan keeps whole (`answered`): `{ ok, data }`.
            {
              ...old,
              data: { ...old.data, [list]: mapItemValue(old.data[list], fn) },
            }
          : old;

/** Your timeline's RSS link (#765): on or off, and since when. */
export const useRssLink = () =>
  useQuery({ queryKey: keys.rss, queryFn: payload(api.rssLink) });

/** Your cheer on an item, shown at once: the cached copy takes the change
 *  before the write, the server's counts after it, and the copy from before
 *  if it was refused. Yours, never an agent's. Home's feed by default; a
 *  player page or a battle page passes its own cheers read
 *  (`usePageCheers`): `{ key, list: "items" }`.
 *
 *  Writes for one item go one at a time, in the order they were tapped
 *  (`cheerWrites`), so a quick cheer and take-back land in that order. The
 *  queue lives here, not in the component, so it drains even when the item
 *  unmounts (a group folded, a page left) before the first write answers.
 *  Only the newest tap's answer redraws the item; a refusal of the newest
 *  goes back to what the server last confirmed. */
/** Home's feed, where most cheers are given. */
const CHEER_FEED_KEY = HOME_FEED_KEY;

/** Per item id: the tail of its write chain, the newest tap's number, how
 *  many writes are out, the copy from before the first of them, and the
 *  last answer the server gave. */
const cheerWrites = new Map();
let cheerTaps = 0;

export function useCheer({
  key = CHEER_FEED_KEY,
  list = "timeline",
  exact = key !== CHEER_FEED_KEY,
} = {}) {
  const queryClient = useQueryClient();
  // Home's feed is one copy per mode (homeFeedKey): each takes the change.
  const put = (item) =>
    queryClient.setQueriesData({ queryKey: key, exact }, (old) =>
      mapItems(old, list, (it) => (it.id === item.id ? item : it)),
    );
  // Every other copy of the item (Home's feed, a player page's or a battle
  // page's cheers read) takes what the server confirmed too, so a stale
  // copy never shows the old cheer or sends it again.
  const everyCopy = (id, data) => {
    const patch = (it) =>
      it.id === id
        ? { ...it, cheers: data.cheers, my_cheer: data.my_cheer }
        : it;
    queryClient.setQueriesData({ queryKey: CHEER_FEED_KEY }, (old) =>
      mapItems(old, "timeline", patch),
    );
    queryClient.setQueriesData({ queryKey: ["me", "cheers"] }, (old) =>
      mapItems(old, "items", patch),
    );
    queryClient.setQueriesData({ queryKey: ["me", "account"] }, (old) =>
      mapItems(old, "timeline", patch),
    );
    queryClient.setQueriesData({ queryKey: ["me", "player"] }, (old) =>
      mapItems(mapItems(old, "timeline", patch), "moments", patch),
    );
    queryClient.setQueriesData({ queryKey: ["me", "player-session"] }, (old) =>
      mapItems(mapItems(old, "item", patch), "marks", patch),
    );
    queryClient.setQueriesData({ queryKey: ["me", "timeline-item"] }, (old) =>
      mapItems(old, "item", patch),
    );
    // A post's other copies: player/account lists, its member destination,
    // and Clan's Feed. Singular and listed copies share this mutator.
    queryClient.setQueriesData({ queryKey: ["me", "posts"] }, (old) =>
      mapItems(mapItems(old, "posts", patch), "item", patch),
    );
    queryClient.setQueriesData(
      {
        queryKey: ["me", "clan", "record"],
        predicate: (q) => q.queryKey[4] === "feed",
      },
      (old) => mapItems(old, "items", patch),
    );
  };
  const done = (id) => {
    const w = cheerWrites.get(id);
    if (w && --w.out === 0) cheerWrites.delete(id);
  };
  return useMutation({
    mutationFn: ({ item, next }) => {
      const w = cheerWrites.get(item.id);
      const send = async () => {
        const res = await api.cheer({
          item_id: item.id,
          cheer: next,
          subjects: itemSubjects(item),
          item: item.item_ref,
        });
        if (!res.ok) throw new Error(res.data?.message ?? "Not saved");
        return res.data;
      };
      const run = (w?.tail ?? Promise.resolve()).then(send, send);
      if (w) w.tail = run.catch(() => {});
      return run;
    },
    onMutate: ({ item, shown }) => {
      const tap = ++cheerTaps;
      const w = cheerWrites.get(item.id) ?? {
        tail: null,
        out: 0,
        before: item,
        confirmed: null,
      };
      w.out += 1;
      w.newest = tap;
      cheerWrites.set(item.id, w);
      void queryClient.cancelQueries({
        queryKey: key,
        exact,
      });
      put(shown);
      return { tap };
    },
    onSuccess: (data, { shown }, context) => {
      const w = cheerWrites.get(shown.id);
      if (w) w.confirmed = data;
      if (w && w.newest !== context?.tap) return;
      put({ ...shown, cheers: data.cheers, my_cheer: data.my_cheer });
      everyCopy(shown.id, data);
    },
    onError: (_err, { item }, context) => {
      const w = cheerWrites.get(item.id);
      if (!w || w.newest !== context?.tap) return;
      if (w.confirmed) everyCopy(item.id, w.confirmed);
      put(
        w.confirmed
          ? {
              ...w.before,
              cheers: w.confirmed.cheers,
              my_cheer: w.confirmed.my_cheer,
            }
          : w.before,
      );
    },
    onSettled: (_data, _err, { item }) => done(item.id),
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

/** One item's comments (2026-11-16), read when its thread opens: the item's
 *  id and the subject tags that find it in your feed. */
export const commentsKey = (itemId) => ["me", "comments", "item", itemId];
export const useItemComments = (it, enabled = true, around = null) => {
  const query = useInfiniteQuery({
    queryKey: around ? [...commentsKey(it?.id), around] : commentsKey(it?.id),
    queryFn: ({ pageParam }) =>
      api
        .comments({
          item_id: it.id,
          subjects: itemSubjects(it),
          item: it.item_ref,
          before: pageParam,
          around: pageParam ? null : around,
        })
        .then(unwrap),
    initialPageParam: null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    enabled: enabled && Boolean(it?.id),
    staleTime: 15000,
    retry: false,
  });
  const pages = query.data?.pages;
  return {
    ...query,
    data: pages
      ? {
          ...pages[0],
          comments: pages
            .slice()
            .reverse()
            .flatMap((p) => p.comments),
        }
      : undefined,
  };
};

/** One player's or account's posts (2026-11-17), as the reader may see
 *  them: a player page's and an account page's list. */
export const postsKey = (ask) => [
  "me",
  "posts",
  ask.player ? "player" : ask.account ? "account" : "mine",
  ask.player ?? ask.account ?? "",
];
export const usePosts = (ask, enabled = true) =>
  useQuery({
    queryKey: postsKey(ask),
    queryFn: payload(() => api.posts(ask)),
    enabled,
    staleTime: 30_000,
    retry: false,
  });

/** One member post retains the answered envelope, so an unavailable or
 * forbidden item remains an answer rather than a fabricated empty post. */
export const memberPostKey = (id) => ["me", "posts", "item", id];
export const memberItemKey = (id) => ["me", "timeline-item", id];
export const useMemberItem = (id, ref) =>
  useQuery({
    queryKey: [...memberItemKey(id), ref],
    queryFn: answered(() => api.memberItem(id, ref)),
    enabled: Boolean(id && ref),
  });
export const useMemberPost = (id) =>
  useQuery({
    queryKey: memberPostKey(id),
    queryFn: answered(() => api.memberPost(id)),
    enabled: Boolean(id),
  });

/** After a post is written, deleted or reported: Home's feed and every
 *  list of posts read again. */
export function usePostsChanged() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["me", "posts"] });
    queryClient.invalidateQueries({ queryKey: ["me", "timeline-item"] });
    queryClient.invalidateQueries({ queryKey: ["me", "comments"] });
    queryClient.invalidateQueries({
      queryKey: ["me", "clan", "record"],
      predicate: (q) => q.queryKey[4] === "feed",
    });
    return queryClient.invalidateQueries({ queryKey: HOME_FEED_KEY });
  }, [queryClient]);
}

/** The tags that find an item in your feed: a page's item carries the
 *  follows its cheers read came through, a feed item its own subjects. */
export const itemSubjects = (it) =>
  it?.cheer_subjects ?? [
    ...new Set(
      [it?.subject_tag, ...(it?.subjects ?? []).map((s) => s.tag)].filter(
        Boolean,
      ),
    ),
  ];

/** After a comment write: the item's thread and every card that shows
 *  its count and latest read again: Home's feed, a page's post list and
 *  Clan's Feed (a post's answers, #1104). A block also ends follows, so
 *  it refreshes everything that is yours. */
export function useCommentsChanged() {
  const queryClient = useQueryClient();
  return useCallback(
    (itemId, { everything = false } = {}) => {
      if (everything)
        return queryClient.invalidateQueries({ queryKey: keys.me });
      if (itemId)
        queryClient.invalidateQueries({ queryKey: commentsKey(itemId) });
      for (const surface of [
        "account",
        "player",
        "player-session",
        "cheers",
        "timeline-item",
      ])
        queryClient.invalidateQueries({ queryKey: ["me", surface] });
      queryClient.invalidateQueries({ queryKey: ["me", "posts"] });
      queryClient.invalidateQueries({
        queryKey: ["me", "clan", "record"],
        predicate: (q) => q.queryKey[4] === "feed",
      });
      return queryClient.invalidateQueries({ queryKey: HOME_FEED_KEY });
    },
    [queryClient],
  );
}

/** Who may comment on your play, and the people you block. */
export const useCommentSetting = (enabled = true) =>
  useQuery({
    queryKey: ["me", "comment-setting"],
    queryFn: payload(api.commentSetting),
    enabled,
    retry: false,
  });
export const useBlocks = (enabled = true) =>
  useQuery({
    queryKey: ["me", "blocks"],
    queryFn: payload(api.blocks),
    enabled,
    retry: false,
  });

/** Admin's comment queue. */
export const useAdminComments = () =>
  useQuery({
    queryKey: ["admin", "comments"],
    queryFn: payload(api.adminComments),
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

/** A first-day primary's collector progress. The server decides both the
 * opportunity and polling cadence from its source timestamps. This hook
 * stays on the page when the welcome view becomes the Timeline.
 */
export const onboardingPeopleKey = ["me", "onboarding-people"];
export const useOnboardingPeopleRead = (enabled) =>
  useQuery({
    queryKey: onboardingPeopleKey,
    queryFn: payload(api.onboardingPeople),
    enabled,
    retry: false,
    staleTime: 5000,
    refetchInterval: (query) => query.state.data?.poll_ms ?? false,
    refetchIntervalInBackground: false,
  });

/** The player map (#768): everyone who has set a place, for a signed-in
 *  person. */
export const usePlayerMap = (enabled = true) =>
  useQuery({
    queryKey: ["me", "player-map"],
    queryFn: payload(() => api.playerMap()),
    enabled,
    staleTime: 60_000,
  });

/** The battle page's post panel (#762; a highlight until 0292): your
 *  posts about this battle and the verified players you may post it as.
 *  Yours, never an agent's. */
export const useBattlePosts = (battle, enabled = true) =>
  useQuery({
    queryKey: keys.battlePosts(battle),
    queryFn: payload(() => api.postsOnBattle(battle)),
    enabled: enabled && Boolean(battle),
  });

/** Move the app's place in the timeline to the window end the page
 *  showed (Jamie, 2026-10-20: independent of what agents have read via
 *  MCP). The page's own copy takes the new place, so a return visit
 *  opens from it, and the scope's `me` refetches so the rail's dot
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
        queryClient.setQueriesData({ queryKey: HOME_FEED_KEY }, (old) =>
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
 *  agent is named outright; elsewhere it is the page's scope. */
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
/** The session clock's cost and loss per day (0145), for staff. */
export const useAdminEfficiency = adminRead(
  keys.adminEfficiency,
  api.adminEfficiency,
);
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

export const useMyFeedback = () => {
  const agent = useScope();
  return useQuery({
    queryKey: scopedKey(agent, "feedback"),
    queryFn: payload(() => api.myFeedback(agent)),
  });
};

/** One of your own items (or, on an agent's pages, the agent's), with
 *  what follows it. Opening it on your own pages reads its answer. */
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

/** One tool's answer through Stats' door (`/api/me/stats`, the tool
 *  bridge for your own players and those you follow), as Stats reads it:
 *  the body, or a thrown error carrying the tool's code when the tool
 *  refused. Keyed under the reader's root, because what it reads is
 *  theirs and a timezone change (the days a battle falls on) or a sign
 *  in must refetch it. Stats pages cache for minutes and never poll:
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
const statsKey = (tool, args) => ["me", "stats", tool, args];
export const useToolRead = (tool, args, { enabled = true } = {}) =>
  useQuery({
    queryKey: statsKey(tool, args),
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
      queryKey: statsKey(tool, args),
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
    queryKey: statsKey("battles_query:sweep", { ...args, pages }),
    queryFn: () => sweepBattles(toolRead, args, pages),
    enabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

/** `invalidate(keys.sessions)` after a mutation: the read refetches and
 *  every screen showing it follows. `invalidate()` with no key is the
 *  scope's root: the session and everything that is the reader's own,
 *  or, on an agent's pages, everything that is the agent's.
 *
 *  In-flight reads are cancelled first. A read with no data yet that is
 *  still in flight when the write lands is not refetched by
 *  invalidateQueries: TanStack joins the pending fetch, which read before
 *  the write, and the page shows the list without the row just created
 *  (an admin create-then-list journey, flaky on CI 2026-09-24). */
export function useInvalidate() {
  const queryClient = useQueryClient();
  const agent = useScope();
  return async (queryKey = rootFor(agent)) => {
    await queryClient.cancelQueries({ queryKey });
    return queryClient.invalidateQueries({ queryKey });
  };
}
