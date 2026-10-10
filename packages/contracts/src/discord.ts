/**
 * Discord webhooks, the one shape for everything Elixir posts to Discord:
 * Actions in a clan's Discord (Clan, 2026-10-10) and the timeline
 * cross-posted to a channel (2026-10-10, Jamie: a person syndicates THEIR
 * timeline, an agent its clan's, "not filtered").
 *
 * The webhook address is a credential (anyone holding it can post in that
 * channel). It is accepted only as Discord's own webhook address, kept
 * sealed, never logged, and only that address is ever called: the relay
 * re-parses it before every request, so nothing else reaches the network
 * through it.
 */
import { createHash } from "node:crypto";

/** Discord's own webhook address, on any of its hostnames and API
 *  versions. A query string is refused rather than dropped:
 *  `?thread_id=` would change where the messages go. */
const WEBHOOK_URL =
  /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v\d{1,2})?\/webhooks\/([0-9]{15,25})\/([A-Za-z0-9_-]{40,120})$/;

export interface DiscordWebhook {
  /** Normalized: https://discord.com/api/webhooks/<id>/<token>. */
  url: string;
  id: string;
  token: string;
}

/** A pasted webhook in its one canonical spelling, or null. */
export function parseDiscordWebhook(input: unknown): DiscordWebhook | null {
  if (typeof input !== "string") return null;
  const m = WEBHOOK_URL.exec(input.trim().replace(/\/+$/, ""));
  if (!m) return null;
  const id = m[1] ?? "";
  const token = m[2] ?? "";
  return { url: `https://discord.com/api/webhooks/${id}/${token}`, id, token };
}

/** A short, stable name for one webhook that is not the credential:
 *  the first 16 hex of its sha256. The relay files message ids and its
 *  status under it, so a changed webhook starts fresh. */
export function webhookFingerprint(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

/** How the console shows a saved webhook: its id and the token's last
 *  four characters, never the whole token. */
export function webhookDisplay(url: string): string {
  const w = parseDiscordWebhook(url);
  if (!w) return "a Discord webhook";
  return `discord.com/api/webhooks/${w.id}/…${w.token.slice(-4)}`;
}

/** Discord's limit on a message's content. */
export const DISCORD_CONTENT_MAX = 2000;

/** A sealed value (AES-256-GCM): the webhook as the database and the
 *  outbox hold it. Only the web API (which seals it) and the relay
 *  (which opens it) hold the key. */
export interface SealedBox {
  v: 1;
  iv: string;
  tag: string;
  ct: string;
}

/** One message: a timeline item's line under its story id, or the
 *  test line a save sends (`key` hello-<uuid>). A key the relay has
 *  posted at this revision or later is skipped, a lower one edited. */
export interface TimelineDiscordPost {
  key: string;
  revision: number;
  content: string;
}

/** The object the sync (or a save's test line) writes to the outbox's
 *  timeline-discord/ lane. */
export interface TimelineDiscordMessage {
  v: 1;
  kind: "timeline" | "hello";
  account_id: string;
  /** The webhook, sealed and bound to the account. */
  webhook: SealedBox;
  posts: TimelineDiscordPost[];
}

const POST_KEY = /^(?:tl_[a-f0-9]{20}|hello-[a-f0-9-]{36})$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** Lines in one outbox object: one relay run posts them well inside its
 *  time budget, at Discord's pace for one webhook. */
export const DISCORD_POSTS_MAX = 20;

const sealed = (b: SealedBox | undefined) =>
  typeof b === "object" &&
  b !== null &&
  b.v === 1 &&
  [b.iv, b.tag, b.ct].every(
    (s) => typeof s === "string" && s.length <= 1024 && B64.test(s),
  );

export function validateTimelineDiscordMessage(
  msg: unknown,
): { ok: true; msg: TimelineDiscordMessage } | { ok: false; errors: string[] } {
  const m = msg as TimelineDiscordMessage;
  if (typeof m !== "object" || m === null)
    return { ok: false, errors: [":not-an-object"] };
  const errors: string[] = [];
  if (m.v !== 1) errors.push("v:unsupported");
  if (m.kind !== "timeline" && m.kind !== "hello") errors.push("kind:invalid");
  if (typeof m.account_id !== "string" || !UUID.test(m.account_id))
    errors.push("account_id:invalid");
  if (!sealed(m.webhook)) errors.push("webhook:invalid");
  if (
    !Array.isArray(m.posts) ||
    m.posts.length === 0 ||
    m.posts.length > DISCORD_POSTS_MAX
  )
    errors.push("posts:invalid");
  else
    m.posts.forEach((p, i) => {
      if (typeof p?.key !== "string" || !POST_KEY.test(p.key))
        errors.push(`posts[${i}].key:invalid`);
      if (!Number.isInteger(p?.revision) || p.revision < 1)
        errors.push(`posts[${i}].revision:invalid`);
      if (
        typeof p?.content !== "string" ||
        p.content.length === 0 ||
        p.content.length > DISCORD_CONTENT_MAX
      )
        errors.push(`posts[${i}].content:invalid`);
    });
  return errors.length === 0 ? { ok: true, msg: m } : { ok: false, errors };
}

/** Where the relay keeps one post's Discord message id: in the outbox
 *  bucket, outside the notified timeline-discord/ prefix. */
export function timelineDiscordStateKey(
  accountId: string,
  fingerprint: string,
  key: string,
): string {
  return `timeline-discord-state/${accountId}/${fingerprint}/${key}.json`;
}

/** Where the relay says how the account's last delivery went. */
export function timelineDiscordStatusKey(accountId: string): string {
  return `timeline-discord-state/${accountId}/status.json`;
}

/** The relay's last word on an account's webhook: `ok` after a
 *  delivery, `gone` when Discord said the webhook no longer exists or
 *  refused it (the sync then turns the account's cross-posting off),
 *  `failing` when Discord refused one message for another reason. */
export interface TimelineDiscordStatus {
  state: "ok" | "gone" | "failing";
  webhook: string;
  at: string;
  http_status?: number;
  posted?: number;
  edited?: number;
}
