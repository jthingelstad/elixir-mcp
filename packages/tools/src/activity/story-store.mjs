/**
 * A subject's stories, stored (timeline_story, 0314; stage 1 of the
 * stored Timeline, 2026-11-23). The timeline is built per reader on every
 * read outside Home; the direction is to store each subject's stories as
 * the record learns them, so a read is one select and a viewer layer
 * (docs/notes/2026-11-23-timeline-story-store.md).
 *
 * The builder is the only author: writeSubjectStories calls buildTimeline
 * for one subject with no viewer (no account, no nickname, UTC) and
 * stores what it tells, less what a reader adds (FINISHED below). Nothing
 * here decides what a story says.
 *
 * Players only. A clan's timeline depends on its reader: the account's
 * scope (comprehensive or activity) chooses what buildClanEntry reads,
 * and its standouts count only a crossing learned inside the window. So
 * clan rows wait for the stage that settles both.
 *
 * Stage 1 writes from {timeline_story_backfill} and compares on the
 * player page (compareStories); stage 2 calls writeSubjectStories from
 * the timeline-sync Lambda when an admission wakes a subject.
 */
import { createHash } from "node:crypto";
import { buildTimeline, itemVisibility, storedItem } from "./entries.mjs";

const DAY_MS = 86_400_000;

/** How far back stories are kept, and what a write with no span covers:
 *  the player page's 30 days and a margin. */
export const STORY_SPAN_DAYS = 35;

/** Items the store never holds. A Drop game is a signed-in follower's
 *  alone (pageGameReader); a post about a battle is the post's, edited
 *  and removed in its own table and read live. */
export const UNSTORED_KINDS = new Set(["drop_game", "battle_highlight"]);

/** What finishItem writes for a reader (its zone, its window, its door),
 *  and the reader's own nickname: never stored. */
const FINISHED = [
  "text",
  "local",
  "at_unix",
  "late",
  "visibility",
  "publishable",
  "schema",
  "nickname",
];

/** JSON with every object's keys sorted, so equal items hash equal. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v ?? null);
}

/** An item as the store keeps it: its server-only fields as plain keys
 *  (storedItem), no reader's fields, and its hash. Takes a finished item
 *  or one a cap left out; both store the same. */
export function storyForm(it) {
  const stored = JSON.parse(JSON.stringify(storedItem(it)));
  for (const k of FINISHED) delete stored[k];
  stored.sort_at ??= stored.at;
  return {
    item: stored,
    content_hash: createHash("sha256").update(canonical(stored)).digest("hex"),
  };
}

/** The span a write with none covers: STORY_SPAN_DAYS to `now`. */
export const storySpan = (now = Date.now()) => ({
  fromMs: now - STORY_SPAN_DAYS * DAY_MS,
  toMs: now,
});

/** The stories the builder tells about one player over the span, as rows:
 *  the player page's read (occurred, public game record and the player's
 *  verification), with no reader and no cap. */
export async function buildSubjectStories(db, kind, tag, span = storySpan()) {
  if (kind !== "player")
    throw new Error(`timeline_story stores players only, not ${kind}`);
  const built = await buildTimeline(
    db,
    [{ kind: "player", tag, relationship: null, nickname: null }],
    {
      fromMs: span.fromMs,
      toMs: span.toMs,
      timezone: "UTC",
      accountId: null,
      basis: "occurred",
      people: { accounts: [], players: true },
      lateCounts: false,
      cap: Number.MAX_SAFE_INTEGER,
    },
  );
  return built.timeline
    .filter((it) => !UNSTORED_KINDS.has(it.kind))
    .map((it) => {
      const { item, content_hash } = storyForm(it);
      return {
        story_id: it.id,
        kind: it.kind,
        section: it.section,
        revision: it.revision ?? 1,
        at: item.at,
        sort_at: item.sort_at,
        observed_at: item.observed_at ?? item.at,
        visibility: itemVisibility(it),
        content_hash,
        item,
      };
    });
}

/**
 * Builds one subject's stories over `span` ({fromMs, toMs}; the last
 * STORY_SPAN_DAYS when omitted) and stores them: a row is written when
 * it is new or its revision or content hash moved, and a stored row whose
 * sort_at lies inside the span that the build no longer tells is
 * deleted. Rows outside the span are left alone. Safe to run again: a
 * second run over the same record writes nothing.
 *
 * Returns counts: `{ stories, written, deleted }`.
 */
export async function writeSubjectStories(db, kind, tag, span = storySpan()) {
  const rows = await buildSubjectStories(db, kind, tag, span);
  await db.query("begin");
  try {
    const written = rows.length
      ? (
          await db.query(
            `insert into timeline_story
               (subject_kind, subject_tag, story_id, kind, section, revision,
                at, sort_at, observed_at, visibility, content_hash, item)
             select $1, $2, r.story_id, r.kind, r.section, r.revision,
                    r.at, r.sort_at, r.observed_at, r.visibility,
                    r.content_hash, r.item
               from jsonb_to_recordset($3::jsonb) as r(
                 story_id text, kind text, section text, revision integer,
                 at timestamptz, sort_at timestamptz, observed_at timestamptz,
                 visibility text, content_hash text, item jsonb)
             on conflict (subject_kind, subject_tag, story_id) do update
               set kind = excluded.kind,
                   section = excluded.section,
                   revision = excluded.revision,
                   at = excluded.at,
                   sort_at = excluded.sort_at,
                   observed_at = excluded.observed_at,
                   visibility = excluded.visibility,
                   content_hash = excluded.content_hash,
                   built_at = now(),
                   item = excluded.item
             where (timeline_story.revision, timeline_story.content_hash)
                   is distinct from (excluded.revision, excluded.content_hash)`,
            [kind, tag, JSON.stringify(rows)],
          )
        ).rowCount
      : 0;
    const { rowCount: deleted } = await db.query(
      `delete from timeline_story
        where subject_kind = $1 and subject_tag = $2
          and sort_at > $3 and sort_at <= $4
          and story_id <> all($5::text[])`,
      [
        kind,
        tag,
        new Date(span.fromMs).toISOString(),
        new Date(span.toMs).toISOString(),
        rows.map((r) => r.story_id),
      ],
    );
    await db.query("commit");
    return { stories: rows.length, written, deleted };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

const SAMPLE = 5;

/**
 * The stored rows for one subject and window beside a computed timeline,
 * as counts and at most SAMPLE story ids of each kind of difference;
 * never an item's contents. `items` are the computed items (finished or
 * cut by the cap), already filtered as the reader's door filters;
 * `visibilities` the same filter for the rows. A stored row is in the
 * window when its sort_at is, as an occurred read selects. `newest_built_at`
 * is the subject's newest row, so a difference in a story newer than it is
 * one no write has seen yet.
 */
export async function compareStories(
  db,
  kind,
  tag,
  items,
  { fromMs, toMs, visibilities },
) {
  const { rows } = await db.query(
    `select story_id, revision, content_hash,
            max(built_at) over () as newest_built_at
       from timeline_story
      where subject_kind = $1 and subject_tag = $2
        and sort_at > $3 and sort_at <= $4
        and visibility = any($5::text[])`,
    [
      kind,
      tag,
      new Date(fromMs).toISOString(),
      new Date(toMs).toISOString(),
      visibilities,
    ],
  );
  const stored = new Map(rows.map((r) => [r.story_id, r]));
  const out = {
    computed: 0,
    stored: rows.length,
    only_computed: 0,
    only_stored: 0,
    revision: 0,
    content: 0,
    ids: { only_computed: [], only_stored: [], revision: [], content: [] },
    newest_built_at: rows[0]?.newest_built_at
      ? new Date(rows[0].newest_built_at).toISOString()
      : null,
  };
  const note = (bucket, id) => {
    out[bucket] += 1;
    if (out.ids[bucket].length < SAMPLE) out.ids[bucket].push(id);
  };
  const seen = new Set();
  for (const it of items) {
    if (UNSTORED_KINDS.has(it.kind) || seen.has(it.id)) continue;
    seen.add(it.id);
    out.computed += 1;
    const row = stored.get(it.id);
    if (!row) note("only_computed", it.id);
    else if (row.revision !== (it.revision ?? 1)) note("revision", it.id);
    else if (row.content_hash !== storyForm(it).content_hash)
      note("content", it.id);
  }
  for (const id of stored.keys()) if (!seen.has(id)) note("only_stored", id);
  return out;
}
