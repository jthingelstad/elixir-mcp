/**
 * Reading the Discord quality ledger (0222) back, for the people who
 * judge the posts without seeing the channels (Jamie, 2026-10-11): the
 * Admin console's Discord page and the `{discord_review}` op read the
 * same numbers from here, so the page and an agent's review never
 * disagree.
 *
 * - `qualitySummary`: a window's numbers for each feature (posts, edits
 *   and skips; Discord's answers; how each was written; the read-back;
 *   leaders' and owners' ratings; Elixir's own latency), the clan
 *   model's runs, and the destinations with the most to look at.
 * - `qualityDetail`: one destination's recent rows whole (a clan by
 *   tag, or a timeline's account by id), each with its ratings and their
 *   notes, and a clan's model runs with every refusal.
 *
 * Read-only. Never MCP, `/api/v1` or a public page: operators only, as
 * the privacy page says.
 */

import { normalizeTag } from "@elixir-mcp/contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SUMMARY_DAYS_MAX = 90;
export const DETAIL_LIMIT_MAX = 200;

const clampDays = (days) =>
  Math.min(SUMMARY_DAYS_MAX, Math.max(1, Math.trunc(Number(days) || 7)));
const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Each person's latest rating of each post: a second rating follows
 *  the first and replaces it, so a count reads only the latest. */
const LATEST = `latest as (
       select distinct on (r.ref, f.account_id) r.ref, f.account_id,
              f.created_at, f.context->>'rating' as rating,
              coalesce(f.context->>'noted' = 'true', false) as noted
         from feedback_ref r join feedback f using (feedback_id)
        where r.kind = 'discord_post' and f.context ? 'rating'
        order by r.ref, f.account_id, f.created_at desc, f.feedback_id desc)`;

/** A window's numbers, by feature, with the destinations most worth a
 *  look (refused, lost, deleted or rated down first). */
export async function qualitySummary(
  db,
  { days = 7, nowMs = Date.now(), top = 20 } = {},
) {
  const d = clampDays(days);
  const since = new Date(nowMs - d * 86_400_000);
  // One query at a time on one connection (docs/ENGINEERING.md).
  const features = await db.query(
    `select feature,
              count(*)::int as rows,
              count(*) filter (where action = 'post')::int as posts,
              count(*) filter (where action = 'edit')::int as edits,
              count(*) filter (where action = 'skip')::int as skips,
              count(*) filter (where outcome = 'posted')::int as posted,
              count(*) filter (where outcome = 'edited')::int as edited,
              count(*) filter (where outcome = 'refused')::int as refused,
              count(*) filter (where outcome = 'unknown')::int as unknown,
              count(*) filter (where outcome = 'not_delivered')::int as not_delivered,
              count(*) filter (where outcome = 'unchanged')::int as unchanged,
              count(*) filter (where outcome is null)::int as awaiting,
              count(*) filter (where mode = 'line')::int as mode_line,
              count(*) filter (where mode = 'code')::int as mode_code,
              count(*) filter (where mode = 'model')::int as mode_model,
              count(*) filter (where checked_at is not null)::int as read_back,
              count(*) filter (where present is true)::int as still_there,
              count(*) filter (where present is false)::int as deleted,
              count(*) filter (where reactions is not null
                                 and jsonb_array_length(reactions) > 0)::int as with_reactions,
              coalesce(sum((select sum((x->>'count')::int)
                              from jsonb_array_elements(reactions) x)), 0)::int as reactions,
              count(*) filter (where thread is true)::int as threads,
              count(distinct destination)::int as destinations,
              percentile_cont(0.5) within group (
                order by extract(epoch from outcome_at - observed_at))
                filter (where outcome = 'posted' and observed_at is not null) as latency_p50_s,
              percentile_cont(0.9) within group (
                order by extract(epoch from outcome_at - observed_at))
                filter (where outcome = 'posted' and observed_at is not null) as latency_p90_s
         from discord_post
        where handed_at >= $1
        group by feature
        order by feature`,
    [since],
  );
  const runs = await db.query(
    `select count(*)::int as runs,
              count(*) filter (where outcome = 'ok')::int as ok,
              coalesce(sum(posts), 0)::int as posts,
              coalesce(sum(model_skips), 0)::int as model_skips,
              coalesce(sum(fallbacks), 0)::int as fallbacks,
              coalesce(sum(jsonb_array_length(refusals)), 0)::int as refusals,
              sum(cost_usd) as cost_usd,
              count(distinct clan_tag)::int as clans
         from discord_run where at >= $1`,
    [since],
  );
  const runOutcomes = await db.query(
    `select outcome, count(*)::int as n from discord_run
        where at >= $1 and outcome <> 'ok' group by outcome order by outcome`,
    [since],
  );
  const ratings = await db.query(
    `with ${LATEST}
     select p.feature,
              count(*) filter (where l.rating = 'up')::int as up,
              count(*) filter (where l.rating = 'down')::int as down,
              count(*) filter (where l.noted)::int as with_note
         from latest l
         join discord_post p on p.post_id::text = l.ref
        where l.created_at >= $1
        group by p.feature`,
    [since],
  );
  const destinations = await db.query(
    `with ${LATEST}
     select p.feature, p.destination, p.clan_tag, p.account_id,
              count(*)::int as rows,
              count(*) filter (where outcome in ('posted', 'edited'))::int as delivered,
              count(*) filter (where outcome = 'refused')::int as refused,
              count(*) filter (where outcome in ('unknown', 'not_delivered'))::int as lost,
              count(*) filter (where action = 'skip')::int as skips,
              count(*) filter (where present is false)::int as deleted,
              (select count(*)::int from latest l
                where l.rating = 'down'
                  and l.ref in (select q.post_id::text from discord_post q
                                 where q.destination = p.destination
                                   and q.handed_at >= $1)) as rated_down,
              max(handed_at) as last_at
         from discord_post p
        where handed_at >= $1
        group by p.feature, p.destination, p.clan_tag, p.account_id
        order by (count(*) filter (where outcome in ('refused', 'unknown', 'not_delivered'))
                  + count(*) filter (where present is false)) desc,
                 count(*) desc
        limit $2`,
    [since, Math.min(100, Math.max(1, top))],
  );
  const rated = new Map(ratings.rows.map((r) => [r.feature, r]));
  const run = runs.rows[0] ?? {};
  return {
    days: d,
    since: since.toISOString(),
    features: features.rows.map((r) => ({
      feature: r.feature,
      rows: r.rows,
      posts: r.posts,
      edits: r.edits,
      skips: r.skips,
      outcomes: {
        posted: r.posted,
        edited: r.edited,
        refused: r.refused,
        unknown: r.unknown,
        not_delivered: r.not_delivered,
        unchanged: r.unchanged,
        awaiting: r.awaiting,
      },
      modes: { line: r.mode_line, code: r.mode_code, model: r.mode_model },
      read_back: {
        read: r.read_back,
        still_there: r.still_there,
        deleted: r.deleted,
        with_reactions: r.with_reactions,
        reactions: r.reactions,
        threads: r.threads,
      },
      ratings: {
        up: rated.get(r.feature)?.up ?? 0,
        down: rated.get(r.feature)?.down ?? 0,
        with_note: rated.get(r.feature)?.with_note ?? 0,
      },
      destinations: r.destinations,
      latency_s: {
        p50: r.latency_p50_s === null ? null : Math.round(r.latency_p50_s),
        p90: r.latency_p90_s === null ? null : Math.round(r.latency_p90_s),
      },
    })),
    runs: {
      runs: run.runs ?? 0,
      ok: run.ok ?? 0,
      not_ok: Object.fromEntries(runOutcomes.rows.map((r) => [r.outcome, r.n])),
      posts: run.posts ?? 0,
      model_skips: run.model_skips ?? 0,
      fallbacks: run.fallbacks ?? 0,
      refusals: run.refusals ?? 0,
      cost_usd: num(run.cost_usd),
      clans: run.clans ?? 0,
    },
    destinations: destinations.rows.map((r) => ({
      feature: r.feature,
      key: r.clan_tag ?? r.account_id ?? r.destination,
      clan_tag: r.clan_tag ?? null,
      account_id: r.clan_tag ? null : (r.account_id ?? null),
      rows: r.rows,
      delivered: r.delivered,
      refused: r.refused,
      lost: r.lost,
      skips: r.skips,
      deleted: r.deleted,
      rated_down: r.rated_down,
      last_at: r.last_at?.toISOString?.() ?? r.last_at ?? null,
    })),
  };
}

/** Which rows a key names: a clan by tag (its Actions and its activity
 *  channel), or a timeline's account by id. Null when it is neither. */
export function detailScope(key) {
  const raw = String(key ?? "").trim();
  if (UUID.test(raw)) return { account_id: raw.toLowerCase() };
  try {
    return { clan_tag: normalizeTag(raw.startsWith("#") ? raw : `#${raw}`) };
  } catch {
    return null;
  }
}

/** One destination's recent rows whole, newest first, each with every
 *  rating of it (who rated is an account id; the note is the item's
 *  message), and for a clan its model's runs with their refusals. */
export async function qualityDetail(
  db,
  { key, limit = 50, feature = null } = {},
) {
  const scope = detailScope(key);
  if (!scope) return null;
  const n = Math.min(DETAIL_LIMIT_MAX, Math.max(1, Math.trunc(limit) || 50));
  const where = scope.clan_tag ? "p.clan_tag = $1" : "p.account_id = $1";
  const arg = scope.clan_tag ?? scope.account_id;
  const { rows } = await db.query(
    `select p.post_id, p.feature, p.destination, p.webhook_fp, p.post_key,
            p.revision, p.action, p.mode, p.items, p.content, p.skip_reason,
            p.event_at, p.observed_at, p.handed_at, p.outcome, p.outcome_at,
            p.http_status, p.reason, p.run_id, p.checked_at, p.present,
            p.reactions, p.thread,
            coalesce((select jsonb_agg(jsonb_build_object(
                        'feedback_id', f.feedback_id, 'account_id', f.account_id,
                        'rating', f.context->>'rating', 'message', f.message,
                        'at', f.created_at, 'status', f.status)
                      order by f.created_at)
                        from feedback_ref r join feedback f using (feedback_id)
                       where r.kind = 'discord_post' and r.ref = p.post_id::text),
                     '[]'::jsonb) as ratings
       from discord_post p
      where ${where} and ($2::text is null or p.feature = $2)
      order by p.handed_at desc, p.created_at desc
      limit $3`,
    [arg, feature, n],
  );
  const runs = scope.clan_tag
    ? (
        await db.query(
          `select run_id, at, model, outcome, rounds, lookups, stories, posts,
                  merged, model_skips, fallbacks, refusals, cost_usd,
                  cost_estimated, raw_key
             from discord_run where clan_tag = $1
            order by at desc limit 20`,
          [scope.clan_tag],
        )
      ).rows.map((r) => ({ ...r, cost_usd: num(r.cost_usd) }))
    : [];
  return { ...scope, posts: rows, runs };
}

/** The ratings over a window, the ones with something to say first (a
 *  👎 or a note) and unanswered before answered: each with the post it
 *  rates (its feature, destination, text and what Discord answered), so
 *  a review reads what the leader or owner saw. */
export async function ratingsQueue(
  db,
  { days = 7, nowMs = Date.now(), limit = 50 } = {},
) {
  const d = clampDays(days);
  const since = new Date(nowMs - d * 86_400_000);
  const n = Math.min(DETAIL_LIMIT_MAX, Math.max(1, Math.trunc(limit) || 50));
  const { rows } = await db.query(
    `select f.feedback_id, f.created_at, f.status, f.responded_at,
            f.context->>'rating' as rating,
            coalesce(f.context->>'noted' = 'true', false) as noted,
            f.message, f.account_id,
            exists (select 1 from feedback_ref r2 join feedback f2 using (feedback_id)
                     where r2.kind = 'discord_post' and r2.ref = r.ref
                       and f2.account_id = f.account_id and f2.context ? 'rating'
                       and (f2.created_at, f2.feedback_id) > (f.created_at, f.feedback_id))
              as superseded,
            p.post_id, p.feature, p.clan_tag, p.account_id as post_account_id,
            p.action, p.mode, p.content, p.outcome, p.reason, p.run_id,
            p.present, p.reactions, p.thread
       from feedback_ref r
       join feedback f using (feedback_id)
       join discord_post p on p.post_id::text = r.ref
      where r.kind = 'discord_post' and f.created_at >= $1
      order by coalesce(f.context->>'rating' = 'down'
                        or f.context->>'noted' = 'true', false) desc,
               (f.responded_at is null) desc,
               f.created_at desc
      limit $2`,
    [since, n],
  );
  return { days: d, since: since.toISOString(), ratings: rows };
}
