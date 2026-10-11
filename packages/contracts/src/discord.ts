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
 *  versions, optionally naming one thread of its channel
 *  (`?thread_id=<id>`: a thread, or a post in a forum channel; 2026-10-11).
 *  Any other query string is refused rather than dropped: it would change
 *  where, or how, the messages go. */
const WEBHOOK_URL =
  /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v\d{1,2})?\/webhooks\/([0-9]{15,25})\/([A-Za-z0-9_-]{40,120})(?:\/?\?thread_id=([0-9]{15,25}))?$/;

export interface DiscordWebhook {
  /** Normalized: https://discord.com/api/webhooks/<id>/<token>, with
   *  ?thread_id=<id> when it posts into one thread. */
  url: string;
  id: string;
  token: string;
  /** The thread every message goes to, or null for the channel itself. */
  thread_id: string | null;
}

/** A pasted webhook in its one canonical spelling, or null. */
export function parseDiscordWebhook(input: unknown): DiscordWebhook | null {
  if (typeof input !== "string") return null;
  const m = WEBHOOK_URL.exec(input.trim().replace(/\/+$/, ""));
  if (!m) return null;
  const id = m[1] ?? "";
  const token = m[2] ?? "";
  const threadId = m[3] ?? null;
  const base = `https://discord.com/api/webhooks/${id}/${token}`;
  return {
    url: threadId ? `${base}?thread_id=${threadId}` : base,
    id,
    token,
    thread_id: threadId,
  };
}

/** The address of one call on a webhook: `path` under it (a message's
 *  `/messages/<id>`), with its thread and any other query. Built from the
 *  parsed parts, never by appending to a pasted string. */
export function discordWebhookCall(
  hook: DiscordWebhook,
  path = "",
  query: Record<string, string> = {},
): string {
  const params = new URLSearchParams(query);
  if (hook.thread_id) params.set("thread_id", hook.thread_id);
  const q = params.toString();
  return `https://discord.com/api/webhooks/${hook.id}/${hook.token}${path}${q ? `?${q}` : ""}`;
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
  const shown = `discord.com/api/webhooks/${w.id}/…${w.token.slice(-4)}`;
  return w.thread_id ? `${shown} (thread ${w.thread_id})` : shown;
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
 *  timeline-discord/ lane: an account's timeline (`timeline`, `hello`),
 *  or a clan's activity in its own channel (`clan_activity`,
 *  `clan_hello`; Clan Settings, Social, 2026-10-10). */
export interface TimelineDiscordMessage {
  v: 1;
  kind: TimelineDiscordKind;
  /** The account, or for a clan's kinds its channel's id: the id the
   *  webhook is sealed to and the relay files its records under. */
  account_id: string;
  /** The webhook, sealed and bound to the account (or channel). */
  webhook: SealedBox;
  posts: TimelineDiscordPost[];
}

export const TIMELINE_DISCORD_KINDS = [
  "timeline",
  "hello",
  "clan_activity",
  "clan_hello",
] as const;
export type TimelineDiscordKind = (typeof TIMELINE_DISCORD_KINDS)[number];

/** A clan's channel, whose webhook is sealed under the clan's purpose. */
export const isClanDiscordKind = (kind: string): boolean =>
  kind === "clan_activity" || kind === "clan_hello";

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
  if (!(TIMELINE_DISCORD_KINDS as readonly string[]).includes(m.kind))
    errors.push("kind:invalid");
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

/** One webhook's pace record, shared by every destination that posts
 *  through it (a person's timeline and their agent's, say), so a reused
 *  webhook is paced as the one channel it is. */
export function timelineDiscordPaceKey(fingerprint: string): string {
  return `timeline-discord-state/pace/${fingerprint}.json`;
}

/** Where the relay says how the account's last delivery went. */
export function timelineDiscordStatusKey(accountId: string): string {
  return `timeline-discord-state/${accountId}/status.json`;
}

/** The relay's last word on an account's webhook: `ok` after a
 *  delivery, `gone` when Discord said the webhook no longer exists or
 *  refused it, `forum` when it posts to a forum channel, which takes no
 *  plain message (the sync then turns the cross-posting off for either),
 *  `failing` when Discord refused a message for another reason (that
 *  line is skipped; the rest are still delivered). */
export interface TimelineDiscordStatus {
  state: "ok" | "gone" | "forum" | "failing";
  webhook: string;
  at: string;
  http_status?: number;
  posted?: number;
  edited?: number;
  /** Discord's own words for the last refusal, when it gave any. */
  reason?: string;
}

/** Discord's error code for a message sent to a forum channel's webhook
 *  without naming a post: a forum takes threads, not plain messages. */
export const DISCORD_FORUM_NEEDS_THREAD = 220001;

/** Where the relay keeps the account's (or clan channel's) recent
 *  deliveries, for the page that set it up. */
export function timelineDiscordHistoryKey(accountId: string): string {
  return `timeline-discord-state/${accountId}/history.json`;
}

/** One delivery as its page shows it: a line posted or edited, refused
 *  by Discord (with Discord's reason), unknown (sent, but no answer came;
 *  never sent again), or not delivered (given up after its retries). */
export type DiscordDeliveryOutcome =
  "posted" | "edited" | "refused" | "unknown" | "not_delivered";

export interface DiscordDelivery {
  at: string;
  outcome: DiscordDeliveryOutcome;
  /** What it was about: a timeline item's id, an Action's number. */
  ref?: string;
  http_status?: number;
  /** Discord's own words for a refusal, or ours for one never sent. */
  reason?: string;
  /** The line's start, as posted. */
  excerpt?: string;
}

/** The last deliveries (newest first) and, by UTC day, how many were not
 *  delivered: bounded to DISCORD_HISTORY_MAX entries and
 *  DISCORD_HISTORY_DAYS days. */
export interface DiscordDeliveryHistory {
  entries: DiscordDelivery[];
  missed: Record<string, number>;
}

export const DISCORD_HISTORY_MAX = 20;
export const DISCORD_HISTORY_DAYS = 30;
const EXCERPT_MAX = 160;
const REASON_MAX = 200;
const MISSED: ReadonlySet<string> = new Set([
  "refused",
  "unknown",
  "not_delivered",
]);

const clip = (s: unknown, n: number): string | undefined => {
  if (typeof s !== "string" || s.length === 0) return undefined;
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/** `history` with `added` (oldest first) recorded, bounded. Pure. */
export function addDiscordDeliveries(
  history: DiscordDeliveryHistory | null | undefined,
  added: DiscordDelivery[],
  nowMs: number,
): DiscordDeliveryHistory {
  const cutoff = nowMs - DISCORD_HISTORY_DAYS * 86_400_000;
  const day = (iso: string) => iso.slice(0, 10);
  const missed: Record<string, number> = {};
  for (const [d, n] of Object.entries(history?.missed ?? {}))
    if (Date.parse(`${d}T23:59:59Z`) >= cutoff && Number.isInteger(n) && n > 0)
      missed[d] = n;
  const fresh = added.map((e) => {
    const out: DiscordDelivery = { at: e.at, outcome: e.outcome };
    if (e.ref) out.ref = String(e.ref).slice(0, 40);
    if (Number.isInteger(e.http_status) && e.http_status)
      out.http_status = e.http_status;
    const reason = clip(e.reason, REASON_MAX);
    if (reason) out.reason = reason;
    const excerpt = clip(e.excerpt, EXCERPT_MAX);
    if (excerpt) out.excerpt = excerpt;
    if (MISSED.has(e.outcome)) missed[day(e.at)] = (missed[day(e.at)] ?? 0) + 1;
    return out;
  });
  const entries = [...fresh.reverse(), ...(history?.entries ?? [])]
    .filter((e) => Date.parse(e.at) >= cutoff)
    .slice(0, DISCORD_HISTORY_MAX);
  return { entries, missed };
}

/** How many deliveries in the last DISCORD_HISTORY_DAYS were not made. */
export function discordNotDelivered(
  history: DiscordDeliveryHistory | null | undefined,
  nowMs: number,
): number {
  const cutoff = nowMs - DISCORD_HISTORY_DAYS * 86_400_000;
  let n = 0;
  for (const [d, c] of Object.entries(history?.missed ?? {}))
    if (Date.parse(`${d}T23:59:59Z`) >= cutoff) n += c;
  return n;
}
