/**
 * The quality ledger of what Elixir posts to Discord (0222; Jamie,
 * 2026-10-11: judge the quality "without having any access or visibility
 * to the client discord server").
 *
 * Every post, edit or skip Elixir decides on, for each of the three
 * features (a timeline's cross-post, Clan's Actions, a clan's activity
 * channel), is a `discord_post` row written where it is decided: the
 * timeline sync and the clan's channel in the timeline-sync Lambda, the
 * Actions wherever Clan shares them. What Discord answered comes back
 * later: the relay (the one component that hears Discord) writes a
 * receipt to the outbox's discord-receipt/ lane, which S3 hands the
 * timeline-sync queue, and `applyReceipts` fills the rows in; Clan's
 * Actions settle their own answers and fill theirs directly. A run of a
 * clan's model as its channel's editor is a `discord_run` row, its raw
 * inputs and answers an object in the archive bucket (discord-runs/).
 *
 * Read-back: each post is read back from Discord once, a day after it
 * was posted (still there or deleted, its reactions when Discord returns
 * them, whether a thread was started from it). No timer of its own: the
 * next delivery to the same webhook names up to three posts a day to a
 * week old never asked for (`readbackCandidates`, marking each), the relay reads
 * them after its own posts, and the answers come back as receipts.
 *
 * The ledger is for reading, never for delivering: a write here never
 * fails or holds up a post (`aside`: a savepoint inside a transaction,
 * and every failure logged and dropped). No webhook, no key, no player
 * tag: a webhook is its fingerprint, and a post is told by its items'
 * ids and kinds. Kept 90 days (the jobs Lambda's hourly sweep), its raw
 * runs 30 (the archive bucket's lifecycle).
 */
import { randomUUID } from "node:crypto";

/** How long the ledger keeps a row, in days (privacy and limits pages). */
export const QUALITY_KEEP_DAYS = 90;
/** The archive bucket's prefix for a run's raw inputs and answers. */
export const RUN_RAW_PREFIX = "discord-runs/";
/** The outbox lane the relay's receipts arrive on. */
export const RECEIPT_PREFIX = "discord-receipt/";
/** A receipt's outcomes, as the ledger keeps them. */
export const RECEIPT_OUTCOMES = new Set([
  "posted",
  "edited",
  "refused",
  "unknown",
  "not_delivered",
  "unchanged",
]);
const FEATURES = new Set(["timeline", "clan_actions", "clan_activity"]);
const ACTIONS = new Set(["post", "edit", "skip"]);
const MODES = new Set(["line", "code", "model"]);
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const FP = /^[a-f0-9]{16}$/;
const TEXT_MAX = 4000;
const REASON_MAX = 300;
/** Receipts one object may carry: a message's posts and its skips. */
export const RECEIPTS_MAX = 100;
/** A post is read back once it is this old ... */
export const READBACK_AFTER_MS = 24 * 3600_000;
/** ... and asked for until it is this old: a quiet webhook's posts are
 *  never read. */
export const READBACK_UNTIL_MS = 7 * 24 * 3600_000;
/** Posts one delivery reads back. */
export const READBACK_PER_DELIVERY = 3;
const REACTIONS_MAX = 20;

export const newLedgerId = () => randomUUID();
export const isLedgerId = (v) => typeof v === "string" && UUID.test(v);

const clip = (s, max) =>
  typeof s === "string" ? (s.length > max ? s.slice(0, max) : s) : null;
const when = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms) : null;
};
const intOr = (v, d = null) => (Number.isInteger(v) ? v : d);

/**
 * A write beside a delivery: inside a transaction, under a savepoint, so
 * a failure here never aborts the caller's work; outside one, as is.
 * Logged and dropped on failure; returns the write's result or null.
 */
export async function aside(db, what, fn, log = console) {
  let saved = false;
  try {
    await db.query("savepoint discord_quality");
    saved = true;
  } catch (err) {
    // 25P01: not in a transaction, where a failure aborts nothing.
    if (err?.code !== "25P01") {
      log.error?.("discord_quality_failed", what, err?.code ?? err?.name);
      return null;
    }
  }
  try {
    const out = await fn();
    if (saved) await db.query("release savepoint discord_quality");
    return out;
  } catch (err) {
    if (saved)
      await db.query("rollback to savepoint discord_quality").catch(() => {});
    log.error?.("discord_quality_failed", what, err?.code ?? err?.name);
    return null;
  }
}

/** A row as the ledger takes it, or null when it is not one. */
export function postRow(r) {
  if (!r || !isLedgerId(r.post_id)) return null;
  if (!FEATURES.has(r.feature) || !ACTIONS.has(r.action)) return null;
  if (!MODES.has(r.mode) || !FP.test(String(r.webhook_fp ?? ""))) return null;
  if (typeof r.destination !== "string" || !r.destination) return null;
  if (typeof r.post_key !== "string" || !r.post_key) return null;
  const handed = when(r.handed_at);
  if (!handed) return null;
  const items = (Array.isArray(r.items) ? r.items : [])
    .filter((it) => it && typeof it.id === "string")
    .slice(0, 50)
    .map((it) => ({
      id: it.id.slice(0, 120),
      kind: typeof it.kind === "string" ? it.kind.slice(0, 60) : null,
    }));
  return {
    post_id: r.post_id,
    feature: r.feature,
    account_id: isLedgerId(r.account_id) ? r.account_id : null,
    clan_tag: typeof r.clan_tag === "string" ? r.clan_tag : null,
    destination: r.destination.slice(0, 120),
    webhook_fp: r.webhook_fp,
    post_key: r.post_key.slice(0, 120),
    revision: intOr(r.revision, 0),
    action: r.action,
    mode: r.mode,
    items: JSON.stringify(items),
    content: clip(r.content, TEXT_MAX),
    skip_reason: clip(r.skip_reason, REASON_MAX),
    event_at: when(r.event_at),
    observed_at: when(r.observed_at),
    handed_at: handed,
    // A skip is settled when it is decided: it is never sent.
    outcome: r.action === "skip" ? "skipped" : null,
    outcome_at: r.action === "skip" ? handed : null,
    run_id: typeof r.run_id === "string" ? r.run_id.slice(0, 120) : null,
  };
}

const COLUMNS = [
  ["post_id", "uuid"],
  ["feature", "text"],
  ["account_id", "uuid"],
  ["clan_tag", "text"],
  ["destination", "text"],
  ["webhook_fp", "text"],
  ["post_key", "text"],
  ["revision", "int"],
  ["action", "text"],
  ["mode", "text"],
  ["items", "jsonb"],
  ["content", "text"],
  ["skip_reason", "text"],
  ["event_at", "timestamptz"],
  ["observed_at", "timestamptz"],
  ["handed_at", "timestamptz"],
  ["outcome", "text"],
  ["outcome_at", "timestamptz"],
  ["run_id", "text"],
];

/**
 * Record posts, edits and skips (rows that are not one are dropped). A
 * row already there (an Action handed over again after Discord asked to
 * slow down) keeps its id and takes the newer hand-off's time and text.
 */
export async function recordPosts(db, rows) {
  const ok = rows.map(postRow).filter(Boolean);
  if (!ok.length) return 0;
  const cols = COLUMNS.map(([c]) => c);
  await db.query(
    `insert into discord_post (${cols.join(", ")})
     select * from unnest(${COLUMNS.map(([, t], i) => `$${i + 1}::${t}[]`).join(", ")})
     on conflict (post_id) do update
        set handed_at = excluded.handed_at,
            content = excluded.content,
            revision = excluded.revision`,
    COLUMNS.map(([c]) => ok.map((r) => r[c])),
  );
  return ok.length;
}

/** A read-back's reactions as the ledger keeps them, or null when
 *  Discord returned none to read. */
function reactionsOf(list) {
  if (!Array.isArray(list)) return null;
  return list
    .filter((x) => x && Number.isInteger(x.count) && x.count > 0)
    .slice(0, REACTIONS_MAX)
    .map((x) => ({
      emoji: String(x.emoji ?? "?").slice(0, 64),
      count: x.count,
    }));
}

/** One receipt as the ledger takes it, or null: Discord's answer to a
 *  post (`outcome`), or what a read-back found (`present`). */
export function receiptRow(r) {
  if (!r || !isLedgerId(r.ledger_id)) return null;
  if (r.outcome === undefined && typeof r.present === "boolean")
    return {
      ledger_id: r.ledger_id,
      read: true,
      at: when(r.at) ?? new Date(),
      present: r.present,
      reactions: r.present ? reactionsOf(r.reactions) : null,
      thread: r.present ? r.thread === true : null,
    };
  if (!RECEIPT_OUTCOMES.has(r.outcome)) return null;
  return {
    ledger_id: r.ledger_id,
    outcome: r.outcome,
    at: when(r.at) ?? new Date(),
    http_status: intOr(r.http_status),
    reason: clip(r.reason, REASON_MAX),
    deleted: r.deleted === true,
  };
}

/**
 * Fill in what Discord answered. An answer never overwrites another,
 * except that a delivery's own answer replaces "unchanged" (a second copy
 * of a notification finding the line already told may be read first).
 * Returns how many rows took an answer.
 */
export async function applyReceipts(db, receipts) {
  const rows = receipts.map(receiptRow).filter(Boolean);
  const reads = rows.filter((r) => r.read);
  const ok = rows.filter((r) => !r.read);
  const readCount = reads.length ? await applyReads(db, reads) : 0;
  if (!ok.length) return readCount;
  const { rowCount } = await db.query(
    `update discord_post p
        set outcome = x.outcome, outcome_at = x.at,
            http_status = x.http_status, reason = x.reason
       from unnest($1::uuid[], $2::text[], $3::timestamptz[], $4::int[],
                   $5::text[]) as x(ledger_id, outcome, at, http_status, reason)
      where p.post_id = x.ledger_id
        and (p.outcome is null
             or (p.outcome = 'unchanged' and x.outcome <> 'unchanged'))`,
    [
      ok.map((r) => r.ledger_id),
      ok.map((r) => r.outcome),
      ok.map((r) => r.at),
      ok.map((r) => r.http_status),
      ok.map((r) => r.reason),
    ],
  );
  // An edit that found its message deleted in the channel says so of
  // the post it edits: gone, before any read-back.
  const gone = ok.filter((r) => r.deleted);
  if (gone.length)
    await db.query(
      `update discord_post o
          set present = false, checked_at = x.at
         from discord_post e,
              unnest($1::uuid[], $2::timestamptz[]) as x(ledger_id, at)
        where e.post_id = x.ledger_id
          and o.destination = e.destination
          and o.webhook_fp = e.webhook_fp
          and o.post_key = e.post_key
          and o.action = 'post'
          and (o.outcome = 'posted' or o.outcome is null)
          and o.checked_at is null`,
      [gone.map((r) => r.ledger_id), gone.map((r) => r.at)],
    );
  return (rowCount ?? 0) + readCount;
}

/** What the read-backs found, each into its post once: the first read
 *  stands. */
async function applyReads(db, reads) {
  const { rowCount } = await db.query(
    `update discord_post p
        set checked_at = x.at, present = x.present,
            reactions = x.reactions, thread = x.thread
       from unnest($1::uuid[], $2::timestamptz[], $3::boolean[], $4::jsonb[],
                   $5::boolean[]) as x(ledger_id, at, present, reactions, thread)
      where p.post_id = x.ledger_id and p.action = 'post'
        and p.checked_at is null`,
    [
      reads.map((r) => r.ledger_id),
      reads.map((r) => r.at),
      reads.map((r) => r.present),
      reads.map((r) =>
        r.reactions === null ? null : JSON.stringify(r.reactions),
      ),
      reads.map((r) => r.thread),
    ],
  );
  return rowCount ?? 0;
}

/**
 * The posts a delivery to this webhook reads back: posted a day to a
 * week ago, never asked for before, oldest first, at most three, each
 * marked asked as it is taken (0225), so it is read at most once even
 * when two deliveries are queued before an answer. `[{ledger_id, key}]`,
 * the key the relay (or Clan's ledger) finds the message by.
 */
export async function readbackCandidates(
  db,
  {
    destination,
    webhook_fp,
    nowMs = Date.now(),
    limit = READBACK_PER_DELIVERY,
  },
) {
  if (!destination || !FP.test(String(webhook_fp ?? ""))) return [];
  // Taken, not just chosen (0225): a second delivery queued before this
  // one's answer arrives never asks for the same post again.
  const { rows } = await db.query(
    `update discord_post p set read_asked_at = $6
      where p.post_id in (
        select post_id from discord_post
         where webhook_fp = $1 and destination = $2
           and action = 'post' and outcome = 'posted' and checked_at is null
           and read_asked_at is null
           and outcome_at <= $3 and outcome_at > $4
         order by outcome_at
         limit $5
         for update skip locked)
      returning p.post_id, p.post_key, p.outcome_at`,
    [
      webhook_fp,
      destination,
      new Date(nowMs - READBACK_AFTER_MS),
      new Date(nowMs - READBACK_UNTIL_MS),
      Math.min(limit, READBACK_PER_DELIVERY),
      new Date(nowMs),
    ],
  );
  return rows
    .sort((a, b) => a.outcome_at - b.outcome_at)
    .map((r) => ({ ledger_id: r.post_id, key: r.post_key }));
}

/** A relay receipt object's receipts, or null when it is not one. */
export function receiptsOf(msg) {
  if (msg?.v !== 1 || !Array.isArray(msg.receipts)) return null;
  if (msg.receipts.length > RECEIPTS_MAX) return null;
  return msg.receipts.map(receiptRow).filter(Boolean);
}

/**
 * Record a run of a clan's model as its channel's editor: what it was
 * asked and answered in numbers, every refusal with its reason and the
 * refused text, and where its raw record is.
 */
export async function recordRun(db, run) {
  if (!run || typeof run.run_id !== "string" || !run.clan_tag) return 0;
  const refusals = (Array.isArray(run.refusals) ? run.refusals : [])
    .slice(0, 40)
    .map((x) => ({
      keys: (Array.isArray(x.keys) ? x.keys : []).slice(0, 20),
      why: clip(String(x.why ?? ""), 120),
      ...(typeof x.text === "string" ? { text: clip(x.text, TEXT_MAX) } : {}),
    }));
  await db.query(
    `insert into discord_run
            (run_id, clan_tag, at, model, outcome, rounds, lookups, stories,
             posts, merged, model_skips, fallbacks, refusals, cost_usd,
             cost_estimated, raw_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb,
             $14, $15, $16)
     on conflict (run_id) do nothing`,
    [
      run.run_id.slice(0, 120),
      run.clan_tag,
      when(run.at) ?? new Date(),
      clip(run.model, 120),
      clip(String(run.outcome ?? "ok"), 60),
      intOr(run.rounds, 0),
      intOr(run.lookups, 0),
      intOr(run.stories, 0),
      intOr(run.posts, 0),
      intOr(run.merged, 0),
      intOr(run.model_skips, 0),
      intOr(run.fallbacks, 0),
      JSON.stringify(refusals),
      Number.isFinite(run.cost_usd) ? run.cost_usd : null,
      run.cost_estimated === true,
      clip(run.raw_key, 300),
    ],
  );
  return 1;
}

/** The archive key of a run's raw record. */
export const runRawKey = (runId, at) =>
  `${RUN_RAW_PREFIX}${new Date(at).toISOString().slice(0, 10)}/${String(runId).replace(/[^A-Za-z0-9._-]/g, "_")}.json`;

/** The ledger over one connection, each write `aside` a delivery. */
export function discordQuality(db, log = console) {
  return {
    record: (rows) => aside(db, "record", () => recordPosts(db, rows), log),
    settle: (receipts) =>
      aside(db, "settle", () => applyReceipts(db, receipts), log),
    run: (run) => aside(db, "run", () => recordRun(db, run), log),
    /** Never in the way: a failed read is no read-back this time. */
    candidates: async (where) =>
      (await aside(
        db,
        "candidates",
        () => readbackCandidates(db, where),
        log,
      )) ?? [],
  };
}

/** Delete what is past the ledger's keep (the jobs Lambda's sweep). */
export async function purgeQuality(db, nowMs = Date.now()) {
  const before = new Date(nowMs - QUALITY_KEEP_DAYS * 86_400_000);
  const posts = await db.query(
    "delete from discord_post where handed_at < $1",
    [before],
  );
  const runs = await db.query("delete from discord_run where at < $1", [
    before,
  ]);
  return { posts: posts.rowCount ?? 0, runs: runs.rowCount ?? 0 };
}
