/**
 * Account handles (Jamie, 2026-11-15: "the accounts should have a username
 * for them"). Approved as a unique, optional @handle, public on the account
 * page, in follow lists and in Find, never in MCP (DECISIONS "What is
 * public about an account").
 *
 * A handle is 3 to 20 lowercase letters, digits and underscores (0278's
 * check), unique among the accounts that set one. It is typed with or
 * without the @ and in any case; Elixir keys it lowercase. Some words are
 * Elixir's own (reserved) and some are never a name a kid should meet
 * (blocked, matched anywhere in the handle, underscores and digits read
 * as nothing so "b_a_d" is "bad"). Admin clears a handle someone reports.
 *
 * Never on an MCP surface: the tools read packages, and this file is the
 * web API's alone.
 */

export const HANDLE = /^[a-z0-9_]{3,20}$/;

/** Elixir's own words, and words that would read as staff. */
const RESERVED = new Set([
  "admin",
  "administrator",
  "elixir",
  "elixirmcp",
  "poapkings",
  "support",
  "help",
  "staff",
  "mod",
  "moderator",
  "official",
  "supercell",
  "clashroyale",
  "system",
  "root",
  "settings",
  "account",
  "accounts",
  "you",
  "home",
  "find",
  "clan",
  "player",
  "null",
  "undefined",
  "everyone",
]);

/** Never part of a handle. Short on purpose: Admin's clear is the rest. */
const BLOCKED = [
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "dick",
  "pussy",
  "penis",
  "vagina",
  "porn",
  "nazi",
  "hitler",
  "rape",
  "nigg",
  "fag",
  "slut",
  "whore",
];

/** The handle as Elixir keys it: trimmed, one leading @ dropped,
 *  lowercase. Not checked. */
export const normalizeHandle = (raw) =>
  String(raw ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();

/** Why a handle cannot be had, before anyone else is asked: "invalid",
 *  "reserved", "blocked", or null when it may be. */
export function handleProblem(handle) {
  if (!HANDLE.test(handle)) return "invalid";
  const bare = handle.replace(/[_0-9]/g, "");
  if (RESERVED.has(handle) || RESERVED.has(bare)) return "reserved";
  const squashed = handle.replace(/_/g, "");
  if (BLOCKED.some((w) => squashed.includes(w) || bare.includes(w)))
    return "blocked";
  return null;
}

export const HANDLE_MESSAGES = {
  invalid: "Use 3 to 20 letters, numbers or _ (no spaces or other symbols).",
  reserved: "That one belongs to Elixir. Pick another.",
  blocked: "That one isn't allowed. Pick another.",
  taken: "Someone already has that one. Pick another.",
};

/** A handle to offer: the main player's in-game name, made a handle, with
 *  a number after it when it is taken. Null when nothing fits. */
export async function suggestHandle(db, accountId) {
  const { rows } = await db.query(
    `select p.name from claim c
       join player p on p.player_tag = c.player_tag
      where c.account_id = $1
        and (c.is_primary or c.relationship in ('primary', 'alt'))
      order by c.status = 'verified' desc, c.is_primary desc, c.created_at
      limit 1`,
    [accountId],
  );
  const base = String(rows[0]?.name ?? "")
    .normalize("NFKD")
    .replace(/[^\w]/g, "")
    .toLowerCase()
    .replace(/^_+|_+$/g, "")
    .slice(0, 16);
  if (base.length < 3 || handleProblem(base)) return null;
  for (const candidate of [
    base,
    ...Array.from({ length: 8 }, (_, i) => `${base}${i + 2}`),
  ]) {
    if (!(await handleOwner(db, candidate))) return candidate;
  }
  return null;
}

/** The account holding `handle`, or null. */
export async function handleOwner(db, handle) {
  const { rows } = await db.query(
    `select account_id from account where handle = $1`,
    [handle],
  );
  return rows[0]?.account_id ?? null;
}

/** Whether `raw` could be the reader's handle now. */
export async function checkHandle(db, accountId, raw) {
  const handle = normalizeHandle(raw);
  const problem = handleProblem(handle);
  if (problem) return { handle, available: false, error: problem };
  const owner = await handleOwner(db, handle);
  if (owner && owner !== accountId)
    return { handle, available: false, error: "taken" };
  return { handle, available: true, error: null };
}

/**
 * Set (or with null, remove) the reader's handle. Returns `{ ok, handle }`
 * or `{ error }`. The unique index decides a race: the loser is "taken".
 */
export async function setHandle(db, accountId, raw) {
  if (raw === null || raw === "") {
    await db.query(
      `update account set handle = null, handle_set_at = null
        where account_id = $1`,
      [accountId],
    );
    return { ok: true, handle: null };
  }
  const check = await checkHandle(db, accountId, raw);
  if (!check.available) return { error: check.error };
  try {
    await db.query(
      `update account set handle = $2,
              handle_set_at = case when handle is distinct from $2
                                   then now() else handle_set_at end
        where account_id = $1`,
      [accountId, check.handle],
    );
  } catch (err) {
    if (err?.code === "23505") return { error: "taken" };
    throw err;
  }
  return { ok: true, handle: check.handle };
}

/** The handles of the accounts that verified `tags`, as a Map tag to
 *  handle; a player no account verified, or whose account set none, is
 *  absent. Follow lists name a follower by a player, so the handle shown
 *  beside it is the one account that proved it. */
export async function handlesOfVerified(db, tags) {
  const list = [...new Set(tags.filter(Boolean))];
  if (!list.length) return new Map();
  const { rows } = await db.query(
    `select c.player_tag, a.handle from claim c
       join account a on a.account_id = c.account_id
                     and a.kind = 'person' and a.status = 'approved'
      where c.player_tag = any($1::text[]) and c.status = 'verified'
        and (c.is_primary or c.relationship in ('primary', 'alt'))
        and a.handle is not null`,
    [list],
  );
  return new Map(rows.map((r) => [r.player_tag, r.handle]));
}

/** Accounts whose handle starts with `raw` (Find), at most `limit`, each
 *  by its page id and its main player. */
export async function searchHandles(db, raw, { limit = 8 } = {}) {
  const q = normalizeHandle(raw).replace(/[^a-z0-9_]/g, "");
  if (q.length < 2) return [];
  const { rows } = await db.query(
    `select a.handle, ap.passport_id as id, v.player_tag as tag, p.name
       from account a
       join account_passport ap on ap.account_id = a.account_id
       left join lateral (
         select c.player_tag from claim c
          where c.account_id = a.account_id
            and (c.is_primary or c.relationship in ('primary', 'alt'))
          order by c.status = 'verified' desc, c.is_primary desc, c.created_at
          limit 1) v on true
       left join player p on p.player_tag = v.player_tag
      where a.handle like $1 || '%' escape '\\'
        and a.kind = 'person' and a.status = 'approved'
      order by a.handle = $3 desc, length(a.handle), a.handle
      limit $2`,
    [q.replace(/_/g, "\\_"), limit, q],
  );
  return rows.map((r) => ({
    id: r.id,
    handle: r.handle,
    player: r.tag ? { tag: r.tag, name: r.name ?? null } : null,
  }));
}
