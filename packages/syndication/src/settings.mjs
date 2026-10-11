/** The setting behind the console's Timeline page: whether the account's
 *  timeline is cross-posted, and to which Discord webhook. The owner's
 *  alone (a person's own, or an agent's through its owner's console);
 *  never served to MCP or /api/v1. The webhook is sealed here, as it is
 *  saved, and is never read back whole: the console sees its shortened
 *  form, and only the relay opens it. */
import { randomUUID } from "node:crypto";
import {
  ELIXIR_ORIGIN,
  discordNotDelivered,
  parseDiscordWebhook,
  webhookDisplay,
  webhookFingerprint,
} from "@elixir-mcp/contracts";

const COLUMNS =
  "webhook_sealed, webhook_fp, webhook_display, enabled, enabled_at, disabled_reason, disabled_at";

const DISCLAIMER =
  "This material is unofficial and is not endorsed by Supercell. For more information see Supercell's Fan Content Policy: <https://www.supercell.com/fan-content-policy>.";

/** The line a save sends, so the owner sees at once that the webhook
 *  works (and the channel learns what will appear in it). */
export function helloContent(nowMs = Date.now()) {
  return [
    `Elixir will cross-post a timeline to this channel from <t:${Math.floor(nowMs / 1000)}:f>: each new item as one line, edited in place as it grows. [Elixir](<${ELIXIR_ORIGIN}/>)`,
    `-# ${DISCLAIMER}`,
  ].join("\n");
}

/** What an owner or leader reads when a save's hello line shows the
 *  webhook cannot be used (2026-10-11): a forum channel takes posts, not
 *  lines; a deleted webhook takes nothing. */
export const WEBHOOK_REFUSALS = {
  webhook_forum:
    "That webhook belongs to a forum channel, which takes posts, not lines. Use a text channel's webhook, or post into one thread: add ?thread_id= and the thread's id (Discord's Developer Mode, Copy Thread ID) to the end of the webhook.",
  webhook_gone:
    "Discord says that webhook no longer exists. Copy it again from the channel's settings, Integrations, Webhooks.",
};

/**
 * After a save sends its hello line: the relay's first word on this
 * webhook (contracts TimelineDiscordStatus), or null when none came in
 * `waitMs`. `id` is the account, or a clan's channel id; `fp` the
 * webhook's fingerprint; `sinceMs` when the hello was sent.
 */
export async function awaitFirstWord(
  readStatus,
  id,
  fp,
  sinceMs,
  {
    waitMs = 8000,
    pause = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = () => Date.now(),
  } = {},
) {
  const end = now() + waitMs;
  for (;;) {
    const status = await readStatus(id).catch(() => null);
    // Two seconds of slack for the relay's clock.
    if (
      status &&
      status.webhook === fp &&
      Date.parse(status.at) >= sinceMs - 2000
    )
      return status;
    if (now() >= end) return null;
    await pause(Math.min(750, Math.max(1, end - now())));
  }
}

/** The refusal a status says the save should answer, or null. */
export function refusalOf(status) {
  if (status?.state === "forum") return "webhook_forum";
  if (status?.state === "gone") return "webhook_gone";
  return null;
}

/** Turn an account's cross-posting off for a webhook its hello showed
 *  unusable (`reason` webhook_forum or webhook_gone). Only while that
 *  webhook (`fp`) is still the saved one: a save that replaced it during
 *  the wait keeps its own. Null when it was replaced. */
export async function refuseDiscordSetting(
  db,
  accountId,
  reason,
  fp,
  now = Date.now(),
) {
  const { rows } = await db.query(
    `update timeline_discord
        set enabled = false, disabled_reason = $2, disabled_at = $3,
            updated_at = $3
      where account_id = $1 and webhook_fp = $4
      returning ${COLUMNS}`,
    [accountId, reason, new Date(now), fp],
  );
  return rows[0] ?? null;
}

/** The relay's last deliveries (newest first) and how many in 30 days
 *  were not delivered, as a page shows them (2026-10-11). */
export function deliveriesView(history, now = Date.now()) {
  return {
    deliveries: Array.isArray(history?.entries) ? history.entries : [],
    not_delivered: discordNotDelivered(history, now),
  };
}

/** What the console shows: never the URL, only its short form. */
export function settingView(row, status = null, history = null) {
  if (!row)
    return {
      enabled: false,
      webhook: null,
      enabled_at: null,
      disabled_reason: null,
      disabled_at: null,
      delivery: null,
      ...deliveriesView(null),
    };
  const current = status && status.webhook === row.webhook_fp ? status : null;
  return {
    enabled: row.enabled,
    webhook: row.webhook_display,
    enabled_at: row.enabled_at?.toISOString() ?? null,
    disabled_reason: row.disabled_reason ?? null,
    disabled_at: row.disabled_at?.toISOString() ?? null,
    // The relay's last delivery to this webhook: ok, gone, forum or
    // failing, with Discord's words for a refusal.
    delivery: current
      ? {
          state: current.state,
          at: current.at,
          http_status: current.http_status ?? null,
          reason: current.reason ?? null,
        }
      : null,
    ...deliveriesView(history),
  };
}

export async function readDiscordSetting(db, accountId) {
  const { rows } = await db.query(
    `select ${COLUMNS} from timeline_discord where account_id = $1`,
    [accountId],
  );
  return rows[0] ?? null;
}

/**
 * Turn cross-posting on (with a webhook, or the saved one), change its
 * webhook, or turn it off. Turning it on, or a new webhook, starts from
 * now (nothing earlier is posted) and sends the hello line through the
 * relay. `seal` is webhookSeal(box).seal. Returns { row, hello } or
 * { error } (webhook_invalid, webhook_required).
 */
export async function saveDiscordSetting(
  db,
  accountId,
  { url, enabled },
  { outbox = null, seal, now = Date.now() },
) {
  const existing = await readDiscordSetting(db, accountId);
  let hook = null;
  if (url !== undefined && url !== null && url !== "") {
    hook = parseDiscordWebhook(url);
    if (!hook) return { error: "webhook_invalid" };
  }
  const at = new Date(now);
  // A new webhook is sealed once, here; the saved one is kept as it is.
  const next = hook
    ? {
        sealed: seal(hook.url, accountId),
        fp: webhookFingerprint(hook.url),
        display: webhookDisplay(hook.url),
      }
    : existing
      ? {
          sealed: existing.webhook_sealed,
          fp: existing.webhook_fp,
          display: existing.webhook_display,
        }
      : null;
  if (enabled === false) {
    if (!existing) return { row: null };
    const { rows } = await db.query(
      `update timeline_discord
          set enabled = false, disabled_reason = 'owner', disabled_at = $2,
              updated_at = $2, webhook_sealed = $3, webhook_fp = $4,
              webhook_display = $5
        where account_id = $1
        returning ${COLUMNS}`,
      [accountId, at, next.sealed, next.fp, next.display],
    );
    return { row: rows[0] };
  }
  if (!next) return { error: "webhook_required" };
  const fresh = !existing?.enabled || next.fp !== existing.webhook_fp;
  const { rows } = await db.query(
    `insert into timeline_discord
            (account_id, webhook_sealed, webhook_fp, webhook_display, enabled,
             enabled_at, synced_to, updated_at)
     values ($1, $2, $3, $4, true, $5, $5, $5)
     on conflict (account_id) do update
        set webhook_sealed = excluded.webhook_sealed,
            webhook_fp = excluded.webhook_fp,
            webhook_display = excluded.webhook_display,
            enabled = true,
            enabled_at = case when $6 then excluded.enabled_at
                              else timeline_discord.enabled_at end,
            synced_to = case when $6 then excluded.synced_to
                             else timeline_discord.synced_to end,
            updated_at = excluded.updated_at,
            disabled_reason = null, disabled_at = null
     returning ${COLUMNS}`,
    [accountId, next.sealed, next.fp, next.display, at, fresh],
  );
  if (fresh && outbox)
    await outbox("timeline-discord", {
      v: 1,
      kind: "hello",
      account_id: accountId,
      webhook: next.sealed,
      posts: [
        {
          key: `hello-${randomUUID()}`,
          revision: 1,
          content: helloContent(now),
        },
      ],
    });
  return {
    row: rows[0],
    hello: fresh && !!outbox,
    ...(fresh && outbox ? { hello_at: now, fp: next.fp } : {}),
  };
}
