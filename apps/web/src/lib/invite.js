import { CHAT_MAX, chatSafe } from "@elixir-mcp/clan-engine/chat";

/**
 * Bring your clanmates (2026-10-08): the words a member copies to invite
 * their clan. Since 0205 Elixir follows a new member's primary clan, so a
 * clanmate who signs up gets that clan's news in their digest: inviting
 * clanmates is how Elixir grows, and these lines are the whole mechanism.
 *
 * The link is the same for everyone: the canonical origin's signup, with
 * no referral code, invite id or tracking parameter (DECISIONS, "Invites
 * carry no referral ids"). Nothing records who copied or shared a line;
 * a copy or a share is counted as one aggregate event (`INVITE_EVENT`,
 * valued by channel), as Clan's copy buttons are.
 */
export const SITE = "elixir.poapkings.com";
export const SIGNUP_URL = `https://${SITE}/signin?signup`;

/** The aggregate event a copy or share sends, and its bounded values. */
export const INVITE_EVENT = "console.invite_copied";
export const INVITE_CHANNELS = Object.freeze({
  chat: "chat",
  message: "message",
  share: "share",
});

/** The clan's name as the game's chat filter will pass it, or null. */
const clanWords = (name) => {
  const safe = chatSafe(name ?? "");
  return safe ? safe : null;
};

/** "the POAP KINGS week", or "our clan's week" without a name. */
const week = (name) => (name ? `the ${name} week` : "our clan's week");

const chatLine = (name) =>
  `I'm on Elixir: follow friends and our clan, see how they play, cheer them on. Free with your player tag, plus ${week(name)} in a weekly email. Unofficial fan site: ${SITE}`;

/**
 * One line for in-game clan chat: plain text within the game's 200
 * characters, through the Clan chat filter's rewrites (packages/clan-engine
 * chat.mjs). The bare domain goes last, so if the filter ever masks it the
 * sentence before it still reads and still names Elixir. A clan name too
 * long to fit becomes "our clan's week" rather than a clipped line.
 */
export function clanChatLine(clanName) {
  const name = clanWords(clanName);
  const named = name ? chatSafe(chatLine(name)) : null;
  if (named && named.length <= CHAT_MAX) return named;
  return chatSafe(chatLine(null));
}

/** The longer note for Discord or a message; the page puts SIGNUP_URL
 *  after it, and the share sheet passes it as the url. */
export function clanMessage(clanName) {
  const name = (clanName ?? "").trim() || null;
  return [
    `I'm on Elixir, the missing social layer of Clash Royale. You follow your friends and your clan, see how they play, and cheer them on.`,
    `Sign up free with your email and player tag, and ${week(name)} comes in your digest, a weekly email: the River Race, who joined and who left.`,
    `It's an unofficial fan project, not endorsed by Supercell.`,
  ].join("\n\n");
}
