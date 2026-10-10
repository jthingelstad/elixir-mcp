/** A clan's activity channel (Clan Settings, Social; Jamie, 2026-10-10):
 *  the clan's own Discord webhook, which categories of its timeline are
 *  posted there, and whether the clan's model rewrites them in the
 *  leaders' voice. Leaders' alone, through Elixir Clan; never MCP or
 *  `/api/v1`. The webhook is sealed as it is saved, bound to a random
 *  channel id that a new webhook replaces, and never read back whole:
 *  leaders see its shortened form, and only the relay opens it. What the
 *  policy allows and what a leader may switch is the engine's
 *  (`activityCategories`); this module keeps the row. */
import { randomUUID } from "node:crypto";
import {
  ELIXIR_ORIGIN,
  parseDiscordWebhook,
  webhookDisplay,
  webhookFingerprint,
} from "@elixir-mcp/contracts";

const COLUMNS = `channel_id, webhook_sealed, webhook_fp, webhook_display,
  enabled, enabled_at, disabled_reason, disabled_at, categories, rewrite,
  voice, set_by, set_by_name, updated_at`;

const DISCLAIMER =
  "This material is unofficial and is not endorsed by Supercell. For more information see Supercell's Fan Content Policy: <https://www.supercell.com/fan-content-policy>.";

const escape = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\\*_~`|>[\]<@]/g, (c) => `\\${c}`);

/** The line a connection sends, so the leader sees at once that the
 *  webhook works and the channel learns what will appear in it. */
export function clanHelloContent(clanName, nowMs = Date.now()) {
  return [
    `Elixir Clan will post ${clanName ? escape(clanName) : "the clan"}'s activity to this channel from <t:${Math.floor(nowMs / 1000)}:f>, as it happens. [Elixir Clan](<${ELIXIR_ORIGIN}/clan>)`,
    `-# ${DISCLAIMER}`,
  ].join("\n");
}

export async function readClanActivity(db, clanTag) {
  const { rows } = await db.query(
    `select ${COLUMNS} from clan_activity_discord where clan_tag = $1`,
    [clanTag],
  );
  return rows[0] ?? null;
}

/** The connection as leaders read it: never the URL, only its short
 *  form, and the relay's last word on it (contracts
 *  TimelineDiscordStatus) when it is about this webhook. */
export function clanActivityRowView(row, status = null) {
  if (!row) return null;
  const current = status && status.webhook === row.webhook_fp ? status : null;
  return {
    enabled: row.enabled,
    webhook: row.webhook_display,
    enabled_at: row.enabled_at?.toISOString() ?? null,
    disabled_reason: row.disabled_reason ?? null,
    disabled_at: row.disabled_at?.toISOString() ?? null,
    categories: row.categories ?? {},
    rewrite: row.rewrite,
    voice: row.voice ?? "",
    set_by: row.set_by,
    set_by_name: row.set_by_name ?? null,
    updated_at: row.updated_at?.toISOString() ?? null,
    delivery: current
      ? {
          state: current.state,
          at: current.at,
          http_status: current.http_status ?? null,
        }
      : null,
  };
}

/**
 * Connect a webhook, change one, switch posting on or off, or change
 * the categories, the rewrite and the voice. A new webhook gets a new
 * channel id (the relay's records start over) and, like turning it back
 * on, starts from now: nothing earlier is posted. Either one sends the
 * hello line through the relay. `seal` is clanActivitySeal(box).seal;
 * `change` holds only what the leader changed, already checked by the
 * caller (categories as booleans or null for the policy's default, the
 * voice cleaned). Returns { row, hello } or { error } (webhook_invalid,
 * webhook_required).
 */
export async function saveClanActivity(
  db,
  clanTag,
  change,
  { seal, outbox = null, who, clanName = null, now = Date.now() },
) {
  const existing = await readClanActivity(db, clanTag);
  let hook = null;
  if (change.url !== undefined && change.url !== null && change.url !== "") {
    hook = parseDiscordWebhook(change.url);
    if (!hook) return { error: "webhook_invalid" };
  }
  if (!existing && !hook) return { error: "webhook_required" };
  const at = new Date(now);
  const newHook = hook && webhookFingerprint(hook.url) !== existing?.webhook_fp;
  const channelId = newHook ? randomUUID() : existing.channel_id;
  const next = newHook
    ? {
        sealed: seal(hook.url, channelId),
        fp: webhookFingerprint(hook.url),
        display: webhookDisplay(hook.url),
      }
    : {
        sealed: existing.webhook_sealed,
        fp: existing.webhook_fp,
        display: existing.webhook_display,
      };
  // Connecting a webhook turns posting on unless the leader said off.
  const enabled =
    typeof change.enabled === "boolean"
      ? change.enabled
      : newHook
        ? true
        : existing.enabled;
  const fresh = enabled && (newHook || !existing?.enabled);
  const categories = { ...(existing?.categories ?? {}) };
  for (const [k, v] of Object.entries(change.categories ?? {}))
    if (v === null) delete categories[k];
    else categories[k] = v;
  const { rows } = await db.query(
    `insert into clan_activity_discord
            (clan_tag, channel_id, webhook_sealed, webhook_fp, webhook_display,
             enabled, enabled_at, synced_to, updated_at, disabled_reason,
             disabled_at, categories, rewrite, voice, set_by, set_by_name)
     values ($1, $2, $3, $4, $5, $6, $7, $7, $7,
             case when $6 then null else 'leader' end,
             case when $6 then null else $7::timestamptz end,
             $8, $9, $10, $11, $12)
     on conflict (clan_tag) do update
        set channel_id = excluded.channel_id,
            webhook_sealed = excluded.webhook_sealed,
            webhook_fp = excluded.webhook_fp,
            webhook_display = excluded.webhook_display,
            enabled = excluded.enabled,
            enabled_at = case when $13 then excluded.enabled_at
                              else clan_activity_discord.enabled_at end,
            synced_to = case when $13 then excluded.synced_to
                             else clan_activity_discord.synced_to end,
            disabled_reason = case
              when excluded.enabled then null
              when clan_activity_discord.enabled then 'leader'
              else clan_activity_discord.disabled_reason end,
            disabled_at = case
              when excluded.enabled then null
              when clan_activity_discord.enabled then excluded.updated_at
              else clan_activity_discord.disabled_at end,
            updated_at = excluded.updated_at,
            categories = excluded.categories,
            rewrite = excluded.rewrite,
            voice = excluded.voice,
            set_by = excluded.set_by,
            set_by_name = excluded.set_by_name
     returning ${COLUMNS}`,
    [
      clanTag,
      channelId,
      next.sealed,
      next.fp,
      next.display,
      enabled,
      at,
      JSON.stringify(categories),
      typeof change.rewrite === "boolean"
        ? change.rewrite
        : (existing?.rewrite ?? false),
      typeof change.voice === "string" ? change.voice : (existing?.voice ?? ""),
      who.player_tag,
      who.name ?? null,
      fresh,
    ],
  );
  // A new channel starts over: nothing told to the old one is edited
  // in the new one.
  if (newHook && existing)
    await db.query(
      `delete from clan_activity_discord_told where clan_tag = $1`,
      [clanTag],
    );
  if (fresh && outbox)
    await outbox("timeline-discord", {
      v: 1,
      kind: "clan_hello",
      account_id: channelId,
      webhook: next.sealed,
      posts: [
        {
          key: `hello-${randomUUID()}`,
          revision: 1,
          content: clanHelloContent(clanName, now),
        },
      ],
    });
  return { row: rows[0], hello: fresh && !!outbox };
}

/** Disconnect: the row and what it told go; messages already in the
 *  channel stay. */
export async function removeClanActivity(db, clanTag) {
  const { rowCount } = await db.query(
    `delete from clan_activity_discord where clan_tag = $1`,
    [clanTag],
  );
  return rowCount > 0;
}
