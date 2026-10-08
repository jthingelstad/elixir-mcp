/**
 * Feedback, one system for all of Elixir (Jamie, 2026-10-08; a beta gate).
 *
 * Every door files through `fileFeedback` and every answer goes through
 * `answerFeedback`: the MCP tool, the JSON API, the Console, Ladder,
 * Elixir Clan, the docs link and the email footer, and on the other side
 * the admin queue and the `{feedback_respond}` op. Before this the MCP tool
 * and the site API each carried their own insert, the admin page and the
 * op their own update, and Elixir Clan a whole copy in its ledger; they
 * drifted (categories, which fields could be attached, whether a revised
 * answer was news again).
 *
 * The record: who filed it (an account, never a player tag), the door it
 * came through (`surface`), the part of Elixir it is about (`area`), what
 * it points at (`feedback_ref`), what was said, and the loop: a status, an
 * answer the filer sees wherever they filed, and what shipped.
 *
 * Every function takes the caller's database client: one statement each,
 * so the tool's timed connection and the ops Lambda's own client both fit.
 */

import {
  FEEDBACK_ANSWER_STATUSES,
  FEEDBACK_AREAS,
  FEEDBACK_CATEGORIES,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_REFS_MAX,
  FEEDBACK_REF_KINDS,
  FEEDBACK_RESPONSE_MAX,
  FEEDBACK_STATUSES,
  FEEDBACK_SURFACES,
  normalizeTag,
} from "@elixir-mcp/contracts";

export class FeedbackError extends Error {
  constructor(status, code, message, hint) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POINTER = /^[A-Za-z0-9#:._/-]{1,120}$/;
const CONTEXT_KEYS_MAX = 12;
const CONTEXT_VALUE_MAX = 200;

/** One pointer as a door gave it, cleaned, or the reason it was not. */
function cleanRef(input) {
  const kind = String(input?.kind ?? "");
  const raw = String(input?.ref ?? "").trim();
  if (!FEEDBACK_REF_KINDS.includes(kind))
    return { dropped: { kind, ref: raw, reason: "unknown_kind" } };
  if (kind === "call" || kind === "email")
    return UUID.test(raw)
      ? { ref: { kind, ref: raw.toLowerCase() } }
      : { dropped: { kind, ref: raw, reason: "not_an_id" } };
  if (kind === "player" || kind === "clan") {
    try {
      return { ref: { kind, ref: normalizeTag(raw) } };
    } catch {
      return { dropped: { kind, ref: raw, reason: "not_a_tag" } };
    }
  }
  return POINTER.test(raw)
    ? { ref: { kind, ref: raw } }
    : { dropped: { kind, ref: raw, reason: "not_an_id" } };
}

/** The pointers a door gave, cleaned and de-duplicated; a bad one is
 *  dropped and said, never the report ("loses the attachment, never the
 *  report": the words are the valuable half). */
export function cleanRefs(list) {
  const refs = [];
  const dropped = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const out = cleanRef(item);
    if (out.dropped) {
      dropped.push(out.dropped);
      continue;
    }
    const key = `${out.ref.kind}\u0000${out.ref.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (refs.length >= FEEDBACK_REFS_MAX) {
      dropped.push({ ...out.ref, reason: "too_many" });
      continue;
    }
    refs.push(out.ref);
  }
  return { refs, dropped };
}

/** A call or an email is shown to the maintainer as the filer's, so it
 *  must be: a call by the filer or an agent they own, an email sent to
 *  the filer. Anything else is dropped as not_yours. */
async function ownedRefs(db, accountId, refs) {
  const calls = refs.filter((r) => r.kind === "call").map((r) => r.ref);
  const emails = refs.filter((r) => r.kind === "email").map((r) => r.ref);
  const ok = new Set();
  if (calls.length) {
    const { rows } = await db.query(
      `select distinct request_id::text as id from mcp_call_audit
        where request_id = any($1::uuid[])
          and (account_id = $2 or account_id in
               (select account_id from account where owned_by_account_id = $2))`,
      [calls, accountId],
    );
    for (const r of rows) ok.add(`call\u0000${r.id}`);
  }
  if (emails.length) {
    const { rows } = await db.query(
      `select send_id::text as id from email_send
        where send_id = any($1::uuid[]) and account_id = $2`,
      [emails, accountId],
    );
    for (const r of rows) ok.add(`email\u0000${r.id}`);
  }
  const kept = [];
  const dropped = [];
  for (const r of refs) {
    if (
      (r.kind === "call" || r.kind === "email") &&
      !ok.has(`${r.kind}\u0000${r.ref}`)
    )
      dropped.push({ ...r, reason: "not_yours" });
    else kept.push(r);
  }
  return { kept, dropped };
}

/** The page an item was written on, as small labelled facts: a door's
 *  free text (`context`, the MCP tool's string) and a page's own (path,
 *  page, player, mode, season...). Objects and long values are cut. */
export function cleanContext(input) {
  if (input === null || input === undefined || input === "") return null;
  const source =
    typeof input === "string" ? { context: input } : Object(input) || {};
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    if (Object.keys(out).length >= CONTEXT_KEYS_MAX) break;
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(key)) continue;
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "number" || typeof value === "boolean")
      out[key] = value;
    else if (typeof value === "string")
      out[key] = value.slice(0, CONTEXT_VALUE_MAX);
  }
  return Object.keys(out).length ? out : null;
}

/** Who filed it through what: principal kind, client, the filing call's
 *  own request id, and an agent's on_behalf_of. Small strings only. */
function cleanVia(via) {
  if (!via) return null;
  const out = {};
  for (const key of [
    "principal_kind",
    "client_name",
    "request_id",
    "on_behalf_of",
    "player_tag",
  ]) {
    const v = via[key];
    if (v !== null && v !== undefined && v !== "")
      out[key] = String(v).slice(0, 200);
  }
  return Object.keys(out).length ? out : null;
}

/** An owner's own feedback (or that of an agent the owner runs) is not
 *  news to the owner. */
export function isOwnerOwned(account) {
  return (
    account?.isOwner === true ||
    account?.role === "owner" ||
    account?.budget?.role === "owner"
  );
}

/**
 * File one item. `account` is the filer ({accountId, ...}); the door
 * names `surface` and `area`. Refuses an empty or over-long message, an
 * unknown category, area or surface; drops (and reports) a pointer that
 * is malformed or not the filer's, and a follows_id that is not theirs.
 * `notifyOwner` (best-effort, after the row is durable) tells Jamie.
 */
export async function fileFeedback(
  db,
  {
    account,
    surface,
    area,
    category = "general",
    message,
    context = null,
    refs = [],
    via = null,
    followsId = null,
    from = null,
    notifyOwner = null,
  },
) {
  const text = String(message ?? "").trim();
  if (!text)
    throw new FeedbackError(400, "bad_message", "Feedback message is empty.");
  if (text.length > FEEDBACK_MESSAGE_MAX)
    throw new FeedbackError(
      400,
      "bad_message",
      `Feedback is 1 to ${FEEDBACK_MESSAGE_MAX.toLocaleString("en-US")} characters; this is ${text.length.toLocaleString("en-US")}.`,
    );
  const cat = category ?? "general";
  if (!FEEDBACK_CATEGORIES.includes(cat))
    throw new FeedbackError(
      400,
      "bad_category",
      `Unknown category '${cat}'.`,
      `Valid categories: ${FEEDBACK_CATEGORIES.join(", ")}.`,
    );
  if (!FEEDBACK_AREAS.includes(area))
    throw new FeedbackError(400, "bad_area", `Unknown area '${area}'.`);
  if (!FEEDBACK_SURFACES.includes(surface))
    throw new FeedbackError(
      400,
      "bad_surface",
      `Unknown surface '${surface}'.`,
    );

  const cleaned = cleanRefs(refs);
  const owned = await ownedRefs(db, account.accountId, cleaned.refs);
  const kept = owned.kept;
  const dropped = [...cleaned.dropped, ...owned.dropped];

  let follows = null;
  if (followsId !== null && followsId !== undefined && followsId !== "") {
    const id = /^[1-9]\d{0,17}$/.test(String(followsId))
      ? String(followsId)
      : null;
    const { rows } = id
      ? await db.query(
          `select feedback_id from feedback where feedback_id = $1 and account_id = $2`,
          [id, account.accountId],
        )
      : { rows: [] };
    if (rows[0]) follows = rows[0].feedback_id;
    else
      dropped.push({
        kind: "follows",
        ref: String(followsId),
        reason: "not_yours",
      });
  }

  // The first call and email still ride the old columns for one release:
  // the code serving during the deploy reads them (0204, expand-contract).
  const firstCall = kept.find((r) => r.kind === "call")?.ref ?? null;
  const firstEmail = kept.find((r) => r.kind === "email")?.ref ?? null;
  const calls = kept.filter((r) => r.kind === "call").map((r) => r.ref);
  const ctx = cleanContext(context);
  const legacyContext =
    ctx || calls.length > 1
      ? { ...(ctx ?? {}), ...(calls.length > 1 ? { request_ids: calls } : {}) }
      : null;

  const { rows } = await db.query(
    `with f as (
       insert into feedback (account_id, surface, area, category, message, context,
                             request_id, send_id, via, follows_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning feedback_id),
     r as (
       insert into feedback_ref (feedback_id, kind, ref)
       select f.feedback_id, x.kind, x.ref
         from f, jsonb_to_recordset($11::jsonb) as x(kind text, ref text)
       returning 1)
     select feedback_id, (select count(*) from r)::int as refs from f`,
    [
      account.accountId,
      surface,
      area,
      cat,
      text,
      legacyContext ? JSON.stringify(legacyContext) : null,
      firstCall,
      firstEmail,
      cleanVia(via) ? JSON.stringify(cleanVia(via)) : null,
      follows,
      JSON.stringify(kept),
    ],
  );
  const feedbackId = rows[0].feedback_id;

  if (notifyOwner && !isOwnerOwned(account)) {
    try {
      await notifyOwner({
        kind: "feedback",
        category: cat,
        surface,
        area,
        message: text,
        from: from ?? "an account",
        feedbackId,
      });
    } catch (err) {
      console.error("owner_notify_enqueue_failed", err?.message);
    }
  }
  return {
    feedback_id: feedbackId,
    category: cat,
    area,
    refs: kept,
    dropped,
    follows_id: follows,
  };
}

/** The refs of these items, grouped by item id. */
async function refsOf(db, ids) {
  if (!ids.length) return new Map();
  const { rows } = await db.query(
    `select feedback_id, kind, ref from feedback_ref
      where feedback_id = any($1::bigint[]) order by kind, ref`,
    [ids],
  );
  const out = new Map();
  for (const r of rows) {
    const key = String(r.feedback_id);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push({ kind: r.kind, ref: r.ref });
  }
  return out;
}

const iso = (v) => (v instanceof Date ? v.toISOString() : (v ?? null));

/** What a filer sees of their own item. */
function mine(row, refs) {
  return {
    feedback_id: row.feedback_id,
    created_at: iso(row.created_at),
    surface: row.surface,
    area: row.area,
    category: row.category,
    message: row.message,
    context: row.context ?? null,
    refs: refs ?? [],
    follows_id: row.follows_id ?? null,
    status: row.status,
    response: row.response ?? null,
    responded_at: iso(row.responded_at),
    response_seen: row.responded_at ? row.response_seen_at !== null : null,
    shipped_in: row.shipped_in ?? null,
    related_tools: row.related_tools ?? null,
  };
}

const MINE_FIELDS = `feedback_id, created_at, surface, area, category, message, context,
  follows_id, status, response, responded_at, response_seen_at, shipped_in, related_tools`;

/** A filer's own items, newest first, a bounded page. Reading a list does
 *  not mark answers seen; the caller marks what it actually delivered. */
export async function listMine(
  db,
  accountId,
  { limit = 20, offset = 0, status = null, since = null, area = null } = {},
) {
  const params = [accountId];
  const where = ["account_id = $1"];
  if (status) {
    if (!FEEDBACK_STATUSES.includes(status))
      throw new FeedbackError(400, "bad_status", `Unknown status '${status}'.`);
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  if (since) {
    if (!Number.isFinite(Date.parse(since)))
      throw new FeedbackError(400, "bad_since", "since is an ISO instant.");
    params.push(since);
    where.push(`created_at > $${params.length}`);
  }
  if (area) {
    if (!FEEDBACK_AREAS.includes(area))
      throw new FeedbackError(400, "bad_area", `Unknown area '${area}'.`);
    params.push(area);
    where.push(`area = $${params.length}`);
  }
  const {
    rows: [{ total, unseen }],
  } = await db.query(
    `select count(*)::int as total,
            count(*) filter (where responded_at is not null and response_seen_at is null)::int as unseen
       from feedback where ${where.join(" and ")}`,
    params,
  );
  params.push(Math.min(Math.max(Number(limit) || 20, 1), 50));
  params.push(Math.max(Number(offset) || 0, 0));
  const { rows } = await db.query(
    `select ${MINE_FIELDS} from feedback where ${where.join(" and ")}
      order by feedback_id desc limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  const refs = await refsOf(
    db,
    rows.map((r) => r.feedback_id),
  );
  return {
    items: rows.map((r) => mine(r, refs.get(String(r.feedback_id)))),
    total,
    unseen,
  };
}

/** One of the filer's own items, with the items that follow it. Opening it
 *  is reading its answer: the answer is marked seen, unless someone else
 *  is reading it (an owner on their agent's page: `seen: false`). */
export async function itemMine(
  db,
  accountId,
  feedbackId,
  { seen = true } = {},
) {
  if (!/^[1-9]\d{0,17}$/.test(String(feedbackId ?? "")))
    throw new FeedbackError(404, "no_feedback", "No such feedback item.");
  const { rows } = await db.query(
    `select ${MINE_FIELDS} from feedback where feedback_id = $1 and account_id = $2`,
    [String(feedbackId), accountId],
  );
  if (!rows[0])
    throw new FeedbackError(404, "no_feedback", "No such feedback item.");
  const { rows: follows } = await db.query(
    `select feedback_id from feedback where follows_id = $1 and account_id = $2
      order by feedback_id`,
    [rows[0].feedback_id, accountId],
  );
  const refs = await refsOf(db, [rows[0].feedback_id]);
  if (seen) await markSeen(db, accountId, [rows[0].feedback_id]);
  return {
    ...mine(rows[0], refs.get(String(rows[0].feedback_id))),
    followed_by: follows.map((f) => f.feedback_id),
  };
}

/** Answers delivered to the filer, wherever they read them: the MCP page,
 *  the Console's item, Elixir Clan's sheet. Only answered items move. */
export async function markSeen(db, accountId, ids) {
  const list = (ids ?? []).map(String).filter((id) => /^\d+$/.test(id));
  if (!list.length) return 0;
  const { rowCount } = await db.query(
    `update feedback set response_seen_at = now()
      where account_id = $1 and feedback_id = any($2::bigint[])
        and responded_at is not null and response_seen_at is null`,
    [accountId, list],
  );
  return rowCount ?? 0;
}

/** The answers not yet read by their filer (meta.feedback_responses_pending). */
export async function unseenCount(db, accountId) {
  const { rows } = await db.query(
    `select count(*)::int as n from feedback
      where account_id = $1 and responded_at is not null and response_seen_at is null`,
    [accountId],
  );
  return rows[0].n;
}

/** Normalizes related_tools: a list, or a comma-separated string as the
 *  ops lane is typed by hand ("malformed array literal", 2026-09-09).
 *  null means unchanged; an empty list clears it. */
export function normalizeRelatedTools(value) {
  if (value === undefined || value === null) return null;
  const list = Array.isArray(value) ? value : String(value).split(",");
  return list.map((t) => String(t).trim()).filter(Boolean);
}

/**
 * Answer one item: a status, and usually words the filer reads. A new or
 * changed answer is news again (response_seen_at cleared, responded_at
 * moved, a timeline event, an email to a person); a status-only change
 * is not. `expected` makes it a compare-and-set against the item as last
 * read ({status, response, responded_at}); a mismatch answers updated 0.
 */
export async function answerFeedback(
  db,
  {
    feedbackId,
    status,
    response = null,
    shippedIn = undefined,
    relatedTools = undefined,
    expected = undefined,
  },
) {
  if (!FEEDBACK_ANSWER_STATUSES.includes(status))
    throw new FeedbackError(
      400,
      "bad_status",
      `An answer's status is ${FEEDBACK_ANSWER_STATUSES.join(", ")}.`,
    );
  if (!/^[1-9]\d{0,17}$/.test(String(feedbackId ?? "")))
    throw new FeedbackError(400, "bad_request", "feedback_id is required.");
  const words =
    response === null || response === undefined
      ? null
      : String(response).trim().slice(0, FEEDBACK_RESPONSE_MAX) || null;
  // Unset (undefined or null) leaves shipped_in as it is; '' clears it.
  const shipped =
    shippedIn === undefined || shippedIn === null
      ? null
      : String(shippedIn ?? "")
          .trim()
          .slice(0, 80) || "";
  const { rows } = await db.query(
    `with u as (
       update feedback set
         status = $2,
         response = coalesce($3, response),
         responded_at = case when $3::text is not null and $3 is distinct from response
                             then now() else responded_at end,
         response_seen_at = case when $3::text is not null and $3 is distinct from response
                                 then null else response_seen_at end,
         shipped_in = case when $4::text is null then shipped_in
                           when $4 = '' then null else $4 end,
         related_tools = coalesce($5, related_tools)
       where feedback_id = $1
         and ($6::boolean = false or (
           status = $7 and response is not distinct from $8::text
           and responded_at is not distinct from $9::timestamptz))
       returning feedback_id, account_id, status, responded_at,
                 (responded_at = now()) as answered),
     e as (
       insert into account_event (account_id, kind, detail)
       select account_id, 'feedback_responded',
              jsonb_build_object('feedback_id', feedback_id, 'status', status)
         from u where answered
       returning 1)
     select feedback_id, account_id, status, answered, (select count(*) from e)::int as events from u`,
    [
      String(feedbackId),
      status,
      words,
      shipped,
      normalizeRelatedTools(relatedTools),
      expected !== undefined,
      expected?.status ?? null,
      expected?.response ?? null,
      expected?.responded_at ?? null,
    ],
  );
  return rows[0]
    ? {
        updated: 1,
        feedback_id: rows[0].feedback_id,
        account_id: rows[0].account_id,
        status: rows[0].status,
        answered: rows[0].answered === true,
      }
    : { updated: 0 };
}

/** The fields the maintainer reads, on the queue and the item. */
const QUEUE_FIELDS = `f.feedback_id, f.account_id, f.surface, f.area, f.category, f.message,
  f.context, f.via, f.follows_id, f.status, f.response,
  to_char(f.responded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as responded_at,
  f.response_seen_at, f.shipped_in, f.related_tools, f.created_at,
  f.request_id, f.send_id,
  a.kind as account_kind, a.public_id as account_public_id,
  (select c.player_tag from claim c where c.account_id = f.account_id and c.is_primary) as from_player`;

/**
 * The maintainer's queue: newest first by default, oldest first for the
 * backlog, filtered by area, status, category or unanswered; paged by
 * `before`/`after` (a feedback id). Counts per area ride along so the
 * page can say where the work is.
 */
export async function feedbackQueue(
  db,
  {
    area = null,
    status = null,
    category = null,
    unanswered = false,
    before = null,
    after = null,
    oldestFirst = false,
    limit = 50,
  } = {},
) {
  const params = [];
  const where = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace("$?", `$${params.length}`));
  };
  if (area) {
    if (!FEEDBACK_AREAS.includes(area))
      throw new FeedbackError(400, "bad_area", `Unknown area '${area}'.`);
    add("f.area = $?", area);
  }
  if (status) {
    if (!FEEDBACK_STATUSES.includes(status))
      throw new FeedbackError(400, "bad_status", `Unknown status '${status}'.`);
    add("f.status = $?", status);
  }
  if (category) {
    if (!FEEDBACK_CATEGORIES.includes(category))
      throw new FeedbackError(
        400,
        "bad_category",
        `Unknown category '${category}'.`,
      );
    add("f.category = $?", category);
  }
  if (unanswered) where.push("(f.response is null or btrim(f.response) = '')");
  const filtered = [...where];
  const filterParams = [...params];
  if (before !== null && before !== undefined && /^\d+$/.test(String(before)))
    add("f.feedback_id < $?", String(before));
  if (after !== null && after !== undefined && /^\d+$/.test(String(after)))
    add("f.feedback_id > $?", String(after));
  const size = Math.min(Math.max(Number(limit) || 50, 1), 200);
  params.push(size + 1);
  const { rows } = await db.query(
    `select ${QUEUE_FIELDS},
            (select s.kind from email_send es join email_issue s on s.issue_id = es.issue_id
              where es.send_id = f.send_id) as send_kind,
            (select coalesce(es.subject, s.subject_line) from email_send es
               join email_issue s on s.issue_id = es.issue_id
              where es.send_id = f.send_id) as send_subject
       from feedback f join account a on a.account_id = f.account_id
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by f.feedback_id ${oldestFirst ? "asc" : "desc"} limit $${params.length}`,
    params,
  );
  const more = rows.length > size;
  const page = rows.slice(0, size);
  const refs = await refsOf(
    db,
    page.map((r) => r.feedback_id),
  );
  const { rows: counts } = await db.query(
    `select f.area, count(*)::int as total,
            count(*) filter (where f.response is null or btrim(f.response) = '')::int as unanswered
       from feedback f ${filtered.length ? `where ${filtered.join(" and ")}` : ""}
      group by f.area order by f.area`,
    filterParams,
  );
  const last = page.at(-1)?.feedback_id ?? null;
  return {
    items: page.map((r) => ({
      ...r,
      created_at: iso(r.created_at),
      response_seen_at: iso(r.response_seen_at),
      refs: refs.get(String(r.feedback_id)) ?? [],
    })),
    areas: counts,
    next: more ? (oldestFirst ? { after: last } : { before: last }) : null,
  };
}

/** One item for the maintainer, any filer's, with its thread. */
export async function feedbackItem(db, feedbackId) {
  if (!/^[1-9]\d{0,17}$/.test(String(feedbackId ?? "")))
    throw new FeedbackError(404, "no_feedback", "No such feedback item.");
  const { rows } = await db.query(
    `select ${QUEUE_FIELDS} from feedback f join account a on a.account_id = f.account_id
      where f.feedback_id = $1`,
    [String(feedbackId)],
  );
  if (!rows[0])
    throw new FeedbackError(404, "no_feedback", "No such feedback item.");
  const { rows: thread } = await db.query(
    `select feedback_id, follows_id, status, created_at from feedback
      where follows_id = $1 or feedback_id = $2 order by feedback_id`,
    [rows[0].feedback_id, rows[0].follows_id],
  );
  const refs = await refsOf(db, [rows[0].feedback_id]);
  return {
    ...rows[0],
    created_at: iso(rows[0].created_at),
    response_seen_at: iso(rows[0].response_seen_at),
    refs: refs.get(String(rows[0].feedback_id)) ?? [],
    thread: thread
      .filter((t) => String(t.feedback_id) !== String(rows[0].feedback_id))
      .map((t) => ({ ...t, created_at: iso(t.created_at) })),
  };
}

/** The unanswered backlog: count, oldest age, how many are over a day
 *  old, per area, and the oldest 25. A status-only acknowledgment is
 *  still unanswered. */
export async function feedbackPending(db, { area = null } = {}) {
  if (area && !FEEDBACK_AREAS.includes(area))
    throw new FeedbackError(400, "bad_area", `Unknown area '${area}'.`);
  const params = area ? [area] : [];
  const scope = `(f.response is null or btrim(f.response) = '')${area ? " and f.area = $1" : ""}`;
  const {
    rows: [counts],
  } = await db.query(
    `select count(*)::int as pending, min(f.created_at) as oldest_created_at,
            extract(epoch from now() - min(f.created_at))::int as oldest_age_seconds,
            count(*) filter (where f.created_at < now() - interval '1 day')::int as overdue
       from feedback f where ${scope}`,
    params,
  );
  const { rows: byArea } = await db.query(
    `select f.area, count(*)::int as pending from feedback f where ${scope}
      group by f.area order by f.area`,
    params,
  );
  const { rows } = await db.query(
    `select ${QUEUE_FIELDS} from feedback f join account a on a.account_id = f.account_id
      where ${scope} order by f.created_at, f.feedback_id limit 25`,
    params,
  );
  const refs = await refsOf(
    db,
    rows.map((r) => r.feedback_id),
  );
  return {
    ...counts,
    by_area: byArea,
    items: rows.map((r) => ({
      ...r,
      created_at: iso(r.created_at),
      response_seen_at: iso(r.response_seen_at),
      refs: refs.get(String(r.feedback_id)) ?? [],
    })),
  };
}
