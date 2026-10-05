/** Frozen presentation and explicit human delivery receipts. Legacy Actions
 * retain their original inbox semantics; today's defaults never rewrite them. */
import { CHAT_MAX } from "./chat.mjs";
import { leaderMessage, LEADER_MESSAGE } from "./render.mjs";

const TYPES = new Set([
  "promotion",
  "demotion",
  "awards_standings",
  "awards_announcement",
  "rules_announcement",
]);
const ANNOUNCEMENTS = new Set([
  "awards_standings",
  "awards_announcement",
  "rules_announcement",
]);

/** Keep every word: an oversized heading/body pair becomes two chat sends,
 * never a clipped winner list or a guessed larger merged-bubble limit. */
export function chatLines(message) {
  const title = String(message?.title ?? "");
  const body = String(message?.body ?? "");
  const joined = title ? `${title}: ${body}` : body;
  return joined.length <= CHAT_MAX ? [joined] : [title, body].filter(Boolean);
}

export function actionDelivery(card, { fresh = false } = {}) {
  if (card.delivery) return card.delivery;
  if (!TYPES.has(card.type)) return null;
  const messages = card.evidence?.messages ?? [
    {
      part: 1,
      message:
        card.evidence?.message ??
        card.message ??
        leaderMessage(card.type, {
          name: card.player_name,
          phrase: card.evidence?.phrase ?? "",
        }),
    },
  ];
  return {
    version: 1,
    channel: fresh ? "clan_chat" : "leader_message",
    parts: messages
      .filter((m) => m.message)
      .map(({ part, message }) => ({
        part,
        options: {
          clan_chat: { lines: chatLines(message) },
          ...(!fresh || ANNOUNCEMENTS.has(card.type)
            ? { leader_message: { title: message.title, body: message.body } }
            : {}),
        },
      })),
  };
}

/** Return only bounded, reviewed words. Legacy clients can continue to send
 * their existing title/body payload; missing past channel is never chat. */
export function deliveryWords(card, input, part = 1) {
  const delivery = actionDelivery(card);
  const options = delivery?.parts.find((m) => m.part === part)?.options;
  if (!options) throw new RangeError("no_message");
  const channel =
    input?.channel ??
    (input?.title !== undefined ? "leader_message" : delivery.channel);
  if (!Object.hasOwn(options, channel)) throw new RangeError("bad_message");
  if (channel === "clan_chat") {
    const lines = input?.lines;
    if (
      !Array.isArray(lines) ||
      !lines.length ||
      lines.length > 16 ||
      lines.some(
        (line) =>
          typeof line !== "string" || !line.trim() || line.length > CHAT_MAX,
      )
    )
      throw new RangeError("bad_message");
    return { channel, lines: [...lines] };
  }
  const { title, body } = input ?? {};
  if (
    typeof title !== "string" ||
    !title.trim() ||
    title.length > LEADER_MESSAGE.title ||
    typeof body !== "string" ||
    !body.trim() ||
    body.length > LEADER_MESSAGE.body
  )
    throw new RangeError("bad_message");
  return { channel, title, body };
}
