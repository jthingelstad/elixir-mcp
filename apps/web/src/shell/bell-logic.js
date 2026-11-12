import { cheerCounts } from "../home/cheer-set.js";
import { playerHref } from "../lib/player.js";
import { SETTINGS } from "../lib/settings.js";
import { eventGroup, eventLabel } from "../views/account/events.js";

/**
 * What the bell works out on its own, away from the drawing (2026-11-12).
 * The read is `/api/me/bell` (services/web-api/src/bell.mjs); Actions
 * waiting stay Home's old Needs you (home/logic.js needsYou).
 */

/** How many things in the bell are new: the rows that need you (always,
 *  while they wait) and what came since you last opened it. */
export function bellCount(needRows, bell) {
  return (needRows ?? 0) + (bell?.new ?? 0);
}

/** The bell's name with its count, read aloud on the button. */
export function bellLabel(label, count) {
  return count > 0 ? `${label}, ${count} new` : label;
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

/** Your account's lines (2026-11-12): each burst one line, "Recording
 *  started for 24 players". One player opens their page; the rest open
 *  Settings, where the account's whole log is. */
export const accountRows = (account) =>
  (account?.items ?? []).map((a, i) => {
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
    const tracking = eventGroup(a.kind) === "tracking";
    return {
      key: `${a.kind}-${a.at}-${i}`,
      title,
      at: a.at,
      detail: ACCOUNT_DETAIL[a.kind] ?? null,
      to:
        one && a.kind !== "claim_ended"
          ? playerHref(one)
          : `${SETTINGS}/${tracking ? "players" : "sign-ins"}`,
      new: a.new === true,
    };
  });

/** One reaction row: the item's sentence and its counts, never who. */
export function reactionRow(r) {
  const counts = cheerCounts(r.cheers);
  const battle = String(r.battle_url ?? "").replace(/^https?:\/\/[^/]+/, "");
  return {
    key: r.item_id,
    text: r.text,
    counts,
    words: counts.map((c) => `${c.label} ${c.count}`).join(", "),
    total: r.total,
    to: battle.startsWith("/battle/") ? battle : null,
    new: r.new === true,
  };
}

/** Followers: the named ones by their verified player, then one line for
 *  those counted. "New" means since you last opened the bell. */
export function followerRows(followers) {
  const rows = (followers?.players ?? []).map((p) => ({
    key: `${p.tag}-${p.followed_tag}`,
    title: p.name ?? p.tag,
    tag: p.tag,
    detail: `Follows ${p.followed_name ?? p.followed_tag}`,
    to: playerHref(p.tag),
    new: p.new === true,
  }));
  const unnamed = followers?.unnamed ?? 0;
  const counted =
    unnamed > 0
      ? `${unnamed} more ${unnamed === 1 ? "account follows" : "accounts follow"} you with no verified player, so ${unnamed === 1 ? "it is" : "they are"} counted, not named.`
      : null;
  return { rows, counted };
}

/** Answers to your feedback, each to its page in Settings. */
export const answerRows = (answers) =>
  (answers?.items ?? []).map((a) => ({
    key: a.id,
    title: a.about || "Your feedback",
    detail: a.new ? "Answered: not read yet" : "Answered",
    to: `${SETTINGS}/feedback/${a.id}`,
    new: a.new === true,
  }));
