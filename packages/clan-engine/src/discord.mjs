/**
 * Actions in a clan's Discord (Jamie, 2026-10-10): a leader connects a
 * Discord webhook in Clan settings, and each Action that leaders or
 * elders can take gets one message there. The message is the Action's
 * line, as the Actions page and the morning email say it, and a link to
 * the Action's own page wrapped in <> so Discord draws no preview. When
 * the Action closes, the same message is edited to say so and by whom.
 *
 * Decided with Jamie: titles name the member, removals included (the
 * leaders choose the channel); no clan name in the title; a member's own
 * "Going to be away?" prompt is never posted; Actions already open when
 * the webhook is connected are posted too.
 *
 * Pure: an action in, the message's text out.
 */

import { audienceOf } from "./actions.mjs";
import { actionLine } from "./mail.mjs";

/** Discord's limit on a message's text. */
export const DISCORD_MAX_CHARS = 2000;

/** Whether an action is posted at all: every one but a member's own. */
export const discordShareable = (card) => audienceOf(card).kind !== "member";

/** Discord reads these as Markdown; a member's name is shown as typed. */
const escape = (text) => String(text).replace(/([\\*_~`|>[\]()])/g, "\\$1");

/** The text of an action's message: what it is, how it closed, the link. */
export function discordActionMessage(card, { clanTag, appUrl }) {
  const base = `${appUrl.replace(/\/$/, "")}/${clanTag.replace(/^#/, "")}/actions`;
  const link = Number.isInteger(card.number) ? `${base}/${card.number}` : base;
  const title = actionLine({
    ...card,
    ...(card.player_name ? { player_name: escape(card.player_name) } : {}),
  }).slice(0, 300);
  const by = escape(card.decided_by_name ?? card.decided_by ?? "").slice(0, 60);
  const closed = {
    done: `✅ Completed${by ? ` by ${by}` : ""}`,
    declined: `❌ Declined${by ? ` by ${by}` : ""}`,
    withdrawn: "➖ Withdrawn: Elixir Clan no longer suggests it",
  }[card.status];
  return closed
    ? `~~**${title}**~~\n${closed}\n<${link}>`
    : `**${title}**\n<${link}>`;
}
