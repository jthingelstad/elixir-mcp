/**
 * Blocks on the web's lists (2026-11-16): who the reader is in a block
 * with, either way, as the ids, page ids and player tags the lists name
 * people by, and the filter that takes them out of People to follow,
 * Find, Near you and the player map. The block itself, and the follows it
 * ends, are @elixir-mcp/claims blocks.mjs.
 */
import { blockedWith } from "@elixir-mcp/claims";

/** The accounts in a block with `accountId`, either way: their ids, page
 *  ids and own players' tags (primary and alts, any status). */
export async function blockedPeople(db, accountId, { enabled = true } = {}) {
  // Blocks act on these lists while comments are on (the stack's
  // CommentsEnabled), so a page with comments off makes no extra read;
  // the follow and cheer refusals (claims, routes/cheers.mjs) hold always.
  if (!enabled) return { ids: new Set(), pages: new Set(), tags: new Set() };
  const ids = await blockedWith(db, accountId);
  if (ids.size === 0) return { ids, pages: new Set(), tags: new Set() };
  const { rows } = await db.query(
    `select ap.passport_id, c.player_tag
       from unnest($1::uuid[]) as b(account_id)
       left join account_passport ap on ap.account_id = b.account_id
       left join claim c on c.account_id = b.account_id
                        and (c.is_primary or c.relationship in ('primary', 'alt'))`,
    [[...ids]],
  );
  return {
    ids,
    pages: new Set(rows.map((r) => r.passport_id).filter(Boolean)),
    tags: new Set(rows.map((r) => r.player_tag).filter(Boolean)),
  };
}

const LISTS = ["people", "players", "entries", "accounts"];

/** A People read without anyone in a block with the reader: each list
 *  the read holds (`people`, `players`, `entries`, `accounts`) loses the
 *  rows naming one of their players or their page. */
export function withoutBlocked(read, blocked) {
  if (!read || (blocked.tags.size === 0 && blocked.pages.size === 0))
    return read;
  const out = { ...read };
  const named = (row) =>
    blocked.tags.has(row?.tag) ||
    blocked.tags.has(row?.player_tag) ||
    blocked.tags.has(row?.primary_tag) ||
    blocked.pages.has(row?.account_id) ||
    blocked.pages.has(row?.page_id) ||
    blocked.pages.has(row?.id);
  for (const key of LISTS)
    if (Array.isArray(out[key])) out[key] = out[key].filter((r) => !named(r));
  if (Array.isArray(out.entries) && typeof out.on_map === "number")
    out.on_map = out.entries.length;
  return out;
}
