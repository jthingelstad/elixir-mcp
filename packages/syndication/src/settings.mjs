/** The setting behind the console's Timeline page: whether the account's
 *  timeline is cross-posted, and to which Discord webhook. The owner's
 *  alone (a person's own, or an agent's through its owner's console);
 *  never served to MCP or /api/v1. The webhook is sealed here, as it is
 *  saved, and is never read back whole: the console sees its shortened
 *  form, and only the relay opens it. */
import { randomUUID } from "node:crypto";
import {
  ELIXIR_ORIGIN,
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

/** What the console shows: never the URL, only its short form. */
export function settingView(row, status = null) {
  if (!row)
    return {
      enabled: false,
      webhook: null,
      enabled_at: null,
      disabled_reason: null,
      disabled_at: null,
      delivery: null,
    };
  const current = status && status.webhook === row.webhook_fp ? status : null;
  return {
    enabled: row.enabled,
    webhook: row.webhook_display,
    enabled_at: row.enabled_at?.toISOString() ?? null,
    disabled_reason: row.disabled_reason ?? null,
    disabled_at: row.disabled_at?.toISOString() ?? null,
    // The relay's last delivery to this webhook: ok, gone or failing.
    delivery: current
      ? {
          state: current.state,
          at: current.at,
          http_status: current.http_status ?? null,
        }
      : null,
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
  return { row: rows[0], hello: fresh && !!outbox };
}
