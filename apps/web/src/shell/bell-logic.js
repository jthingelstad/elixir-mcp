import { cheerCounts } from "../home/cheer-set.js";
// player.js first: it, moved.js and clan/lib/base.js import each other,
// and player.js reads HOME as it loads.
import { playerHref } from "../lib/player.js";
import { passportHref } from "../lib/passport.js";
import { SETTINGS } from "../lib/settings.js";
import { eventGroup, eventLabel } from "../views/account/events.js";

/**
 * What the bell works out on its own, away from the drawing (2026-11-12).
 * The read is `/api/me/bell` (services/web-api/src/bell.mjs); Actions
 * waiting stay Home's old Needs you (home/logic.js needsYou).
 */

/** How many things the badge counts: the rows that need you (always,
 *  while they wait) and what came since you last opened it, an unread
 *  answer until you read it. */
export function bellCount(needRows, bell) {
  return (needRows ?? 0) + (bell?.new ?? 0);
}

/** The bell's name with what its badge counts, read aloud on the button:
 *  "Notifications, 2 need you, 3 new". */
export function bellLabel(label, { need = 0, fresh = 0 } = {}) {
  const parts = [
    need > 0 ? `${need} ${need === 1 ? "needs" : "need"} you` : null,
    fresh > 0 ? `${fresh} new` : null,
  ].filter(Boolean);
  return parts.length ? `${label}, ${parts.join(", ")}` : label;
}

/** The read as it stands once the bell was opened: reactions and followers
 *  before the marker are no longer new. An unread answer stays new until it
 *  is read, in Settings › Feedback, as it always has been. */
export function bellSeenAt(bell, seenAt) {
  const reactions = (bell.reactions?.items ?? []).map((r) => ({
    ...r,
    new: false,
  }));
  const followers = (bell.followers?.players ?? []).map((p) => ({
    ...p,
    new: false,
  }));
  const answers = bell.answers ?? { items: [], new: 0 };
  const account = (bell.account?.items ?? []).map((a) => ({
    ...a,
    new: false,
  }));
  return {
    ...bell,
    seen_at: seenAt ?? bell.seen_at ?? null,
    new: answers.new ?? 0,
    reactions: { ...bell.reactions, items: reactions, new: 0 },
    followers: { ...bell.followers, players: followers, new: 0 },
    answers,
    account: { ...bell.account, items: account, new: 0 },
  };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Who a line of your account's names: one by name, else how many. */
function accountWho(a) {
  const one = a.players + a.clans === 1 ? a.subjects?.[0] : null;
  if (one) return one.name ?? one.tag;
  return [
    a.players ? plural(a.players, "player", "players") : null,
    a.clans ? plural(a.clans, "clan", "clans") : null,
  ]
    .filter(Boolean)
    .join(" and ");
}

/** What a line of your account's says, by kind; any other kind is its
 *  Settings label with whom it names. */
const ACCOUNT_LINE = {
  claim_added: (who) => `Added ${who}`,
  recording_started: (who) => `Recording started for ${who}`,
  recording_stopped: (who) => `Recording stopped for ${who}`,
  clan_added: (who) => `Added ${who}`,
  clan_removed: (who) => `Removed ${who}`,
  claim_verified: (who) => `Verified ${who}`,
  claim_ended: (who) => `No longer yours: ${who}`,
  claim_refused: (who) => `Not added: ${who}`,
};

/** Why a line matters, where the line alone does not say. */
const ACCOUNT_DETAIL = {
  claim_ended:
    "Another account verified it. If it is yours, tell us through the feedback form.",
  claim_refused:
    "Another account verified it. If it is yours, tell us through the feedback form.",
};

const ROMAN = ["I", "II", "III"];

/** A new Stamp (#1015): its name, with its level when it has levels, to
 *  the passport's sheet for it. */
export function stampRow(a) {
  const level =
    a.levels > 1 && ROMAN[a.level - 1] ? ` ${ROMAN[a.level - 1]}` : "";
  return {
    key: `stamp-${a.stamp_id}-${a.at}`,
    icon: "stamp",
    title: `New Stamp: ${a.name}${level}`,
    at: a.at,
    detail: null,
    to: passportHref(null, a.stamp_id),
    new: a.new === true,
  };
}

/** "Your passport is ready" (#1015): an account made before Stamps
 *  existed gets this one line, never a "New Stamp" line for each thing it
 *  had already done. */
export function passportReadyRow(a) {
  const n = Number(a.stamps) || 0;
  return {
    key: `passport-ready-${a.at}`,
    icon: "stamp",
    title: "Your passport is ready",
    at: a.at,
    detail:
      n === 1
        ? "1 Stamp you had already earned is in it."
        : `${n} Stamps you had already earned are in it.`,
    to: "/home/passport",
    new: a.new === true,
  };
}

/** Your account's lines (2026-11-12): each burst one line, "Recording
 *  started for 24 players". One player opens their page; the rest open
 *  Settings, where the account's whole log is. A new Stamp is its own
 *  line (stampRow). */
export const accountRows = (account) =>
  (account?.items ?? []).map((a) => {
    if (a.kind === "stamp_earned") return stampRow(a);
    if (a.kind === "passport_ready") return passportReadyRow(a);
    const who = accountWho(a);
    const say = ACCOUNT_LINE[a.kind];
    const title =
      who && say
        ? say(who)
        : who
          ? `${eventLabel(a.kind)}: ${who}`
          : a.events > 1
            ? `${eventLabel(a.kind)}, ${a.events} times`
            : eventLabel(a.kind);
    const one =
      a.players === 1 && a.clans === 0 && a.subjects?.[0]?.kind === "player"
        ? a.subjects[0].tag
        : null;
    const aboutPlayers = eventGroup(a.kind) === "players";
    return {
      key: `${a.kind}-${a.at}`,
      icon: aboutPlayers ? "user-round" : "settings",
      title,
      at: a.at,
      detail: ACCOUNT_DETAIL[a.kind] ?? null,
      to:
        one && a.kind !== "claim_ended"
          ? playerHref(one)
          : `${SETTINGS}/${aboutPlayers ? "players" : "sign-ins"}`,
      new: a.new === true,
    };
  });

/** One reaction row: the item's sentence and its counts, never who. */
export function reactionRow(r) {
  const counts = cheerCounts(r.cheers);
  const battle = String(r.battle_url ?? "").replace(/^https?:\/\/[^/]+/, "");
  return {
    key: r.item_id,
    icon: "heart",
    text: r.text,
    counts,
    words: counts.map((c) => `${c.label} ${c.count}`).join(", "),
    total: r.total,
    to: battle.startsWith("/battle/") ? battle : null,
    new: r.new === true,
  };
}

/** Followers: the named ones by their verified player, then one line for
 *  those counted. "New" means since you last opened the bell. No follow
 *  time is shown. */
export function followerRows(followers) {
  const rows = (followers?.players ?? []).map((p) => ({
    key: `${p.tag}-${p.followed_tag}`,
    icon: "user-plus",
    title: p.name ?? p.tag,
    tag: p.tag,
    name: p.name ?? null,
    // Their verified player is yours to follow back unless you already
    // own, follow or watch it (the bell's read says).
    followBack: p.can_follow_back === true,
    followed: p.followed_name ?? p.followed_tag,
    to: playerHref(p.tag),
    new: p.new === true,
  }));
  const unnamed = followers?.unnamed ?? 0;
  const counted =
    unnamed > 0
      ? `${unnamed} more ${unnamed === 1 ? "follower" : "followers"} with no verified player`
      : null;
  return { rows, counted };
}

/** Answers to your feedback, each to its page in Settings. */
export const answerRows = (answers) =>
  (answers?.items ?? []).map((a) => ({
    key: `answer-${a.id}`,
    icon: "message-square",
    title: "Elixir answered your feedback",
    about: a.about || null,
    at: a.responded_at ?? null,
    to: `${SETTINGS}/feedback/${a.id}`,
    new: a.new === true,
  }));

/**
 * The bell's events as one inbox (#1009): every row of every kind, each
 * with its kind and its key, split into New and Earlier. A row is New when
 * the read says so or when `keep` holds its key (what was new when the
 * bell last showed it, kept while you visit a row and come back); `drop`
 * holds the keys you have opened since, which are no longer new. Within
 * each part the kinds keep the order cheers, followers, answers, your
 * account, each newest first as the read sends it.
 */
export function bellGroups(bell, { keep = null } = {}) {
  if (!bell) return { fresh: [], earlier: [], counted: null };
  const { rows: followers, counted } = followerRows(bell.followers);
  const all = [
    ...(bell.reactions?.items ?? []).map((r) => ({
      kind: "cheer",
      ...reactionRow(r),
    })),
    ...followers.map((f) => ({ kind: "follower", ...f })),
    ...answerRows(bell.answers).map((a) => ({ kind: "answer", ...a })),
    ...accountRows(bell.account).map((a) => ({ kind: "account", ...a })),
  ];
  // Two lines of one kind at one instant keep apart.
  const seen = new Map();
  for (const row of all) {
    const n = (seen.get(row.key) ?? 0) + 1;
    seen.set(row.key, n);
    if (n > 1) row.key = `${row.key}~${n}`;
  }
  const isNew = (row) => row.new || keep?.has(row.key) === true;
  const marked = all.map((row) => ({ ...row, new: isNew(row) }));
  return {
    fresh: marked.filter((r) => r.new),
    earlier: marked.filter((r) => !r.new),
    counted,
  };
}
