import { CHAT_MAX, chatSafe } from "@elixir-mcp/clan-engine/chat";

/**
 * Bring your clanmates (2026-10-08): the words a member copies to invite
 * their clan. Since 0205 Elixir follows a new member's primary clan, so a
 * clanmate who signs up gets that clan's week in Monday's email: inviting
 * clanmates is how Elixir grows, and these lines are the whole mechanism.
 *
 * The link is the same for everyone: the canonical origin's signup, with
 * no referral code, invite id or tracking parameter (DECISIONS, "Invites
 * carry no referral ids"). Nothing records who copied or shared a line.
 */
export const SITE = "elixir.poapkings.com";
export const SIGNUP_URL = `https://${SITE}/console/signin?signup`;

/** The clan's name as the game's chat filter will pass it, or null. */
const clanWords = (name) => {
  const safe = chatSafe(name ?? "");
  return safe ? safe : null;
};

/** "the POAP KINGS week", or "our clan's week" without a name. */
const week = (name) => (name ? `the ${name} week` : "our clan's week");

const chatLine = (name) =>
  `I keep my battle history on Elixir. Sign up free with your player tag and it keeps yours too, plus ${week(name)} in your email every Monday. Unofficial fan site: ${SITE}`;

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
    `I've been keeping my Clash Royale battle history on Elixir. The game shows roughly your last 30 battles; Elixir records them as they come in, keeps them, and reads your season back on Ladder.`,
    `Sign up free with an email and add your player tag, and you also get ${week(name)} by email every Monday: the river race, who joined and left, and the week in battles.`,
    `It's an unofficial fan project, not endorsed by Supercell.`,
  ].join("\n\n");
}
