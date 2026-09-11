/**
 * Shared helpers for the tool registry (split from the single-file
 * registry, review item 8, 2026-09-05): entitlement resolution, meta
 * assembly, segment filters, the closed error class, the shared
 * clan-recording acts both doors use, and - since 1.0.0 - the CONVENTIONS
 * every tool follows (docs/ENGINEERING.md, "Tool conventions"):
 *
 *   - windows: `from`/`to` everywhere, `days`/`weeks` as sugar, one
 *     `applied.window` echo saying what bounds applied and where they came
 *     from (resolveWindow / appliedBlock);
 *   - one `applied` echo block per response (limit, sort, mode, segment...);
 *   - prose: `notes: string[]` of one-sentence caveats plus a `docs`
 *     pointer to the page carrying the formulas (notes / docsRef);
 *   - `verbosity: full | compact` as the only size control (VERBOSITY);
 *   - short argument descriptions; the canonical explanation of
 *     player_tag / on_behalf_of / windows lives ONCE in the initialize
 *     instructions (protocol.mjs), not fifteen times in tools/list.
 *
 * Handlers live in the per-group modules beside this file; tools.mjs
 * assembles them.
 */

import { responseMeta, roleQuotas, MODE_GROUPS } from "@elixir-mcp/contracts";
import { reconcileRecording } from "@elixir-mcp/claims";
import { resolveSubject, resolveEntitledClan } from "../entitlements.mjs";
import { resolveInstant } from "../time.mjs";

/** The live lane spends real CR budget: tight per-account daily cap,
 *  defaulted by role (contracts roles.ts), beaten by the per-account
 *  live_daily_quota override. */
/** WHOSE live lane a call spends: the same budget as the daily call
 *  quota (auth budgetFor) - an agent spends its OWNER's allowance, so N
 *  agents on one account share one daily live budget, and an integration
 *  pays from its own key. The fallback keeps hand-built accounts (and
 *  every pre-0053 shape) on their own bucket exactly as before. */
export function liveBudgetFor(account) {
  const budget = account.budget ?? {
    accountId: account.accountId,
    role: account.role,
    liveOverride: account.liveDailyQuota ?? null,
  };
  const unlimited =
    account.isOwner === true ||
    budget.role === "owner" ||
    budget.role === "admin";
  const cap = unlimited
    ? Infinity
    : (budget.liveOverride ?? roleQuotas(budget.role).live_fetches_per_day);
  return {
    accountId: budget.accountId,
    role: budget.role ?? "member",
    cap,
    bucket: `liveday#${budget.accountId}`,
  };
}

async function spendLiveQuota(ctx) {
  const budget = liveBudgetFor(ctx.account);
  if (budget.cap === Infinity) return;
  const day = new Date().toISOString().slice(0, 10);
  const { rows } = await ctx.db.query(
    `insert into rate_limit (bucket, window_start, count) values ($1, $2::date, 1)
     on conflict (bucket, window_start) do update set count = rate_limit.count + 1
     returning count`,
    [budget.bucket, day],
  );
  if (rows[0].count > budget.cap) {
    throw new ToolFailure(
      "quota_exceeded",
      `Live-fetch quota reached (${budget.cap}/day for the ${budget.role} tier${
        ctx.account.kind === "agent"
          ? ", shared with your owner's other agents"
          : ""
      }).`,
      "Recorded-data tools are unlimited within the normal quota. Higher tiers get more: elixir_docs({ page: 'roles' }), or ask via elixir_feedback.",
    );
  }
}

export class ToolFailure extends Error {
  constructor(code, message, hint) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

// --- argument schemas ------------------------------------------------------

/** One line each. The long form - what omitting means on a personal vs an
 *  agent connection, how on_behalf_of is mapped, how date-only bounds
 *  resolve - is said ONCE in the initialize instructions. Fifteen copies
 *  of a 240-character paragraph were a fifth of tools/list. */
export const TAG_SCHEMA = {
  type: "string",
  description:
    "Player tag like #20JJJ2CCRU. Omit to mean the caller (your primary player, or whoever on_behalf_of maps to).",
};

export const ON_BEHALF_OF_SCHEMA = {
  type: "string",
  maxLength: 200,
  description:
    "Agent connections: the end user's id on your surface (e.g. discord:1234), mapped once with elixir_identify. Ignored on a personal connection.",
};

export const TAG_RULE_HINT =
  "Tags are # plus 3-12 characters from 0289PYLQGRJCUV (letter O folds to zero).";

/** Window bounds, described identically wherever they appear (the lint
 *  test pins the two facts a caller cannot guess: the end is exclusive,
 *  and a date-only end covers the WHOLE named local day). */
export const WINDOW_FROM_DESC =
  "Start of the window, inclusive: an ISO instant, or YYYY-MM-DD resolving to local midnight in your timezone.";
export const WINDOW_TO_DESC =
  "End of the window, exclusive: an ISO instant as given; YYYY-MM-DD covers that WHOLE local day. Omit for up to now.";
/** Snapshot-series tools take whole days only, never instants. */
export const WINDOW_DATE_ONLY_DESC =
  "YYYY-MM-DD, inclusive. Built from daily snapshots, so only whole days are meaningful; an instant is not accepted.";

export const TIMEZONE_SCHEMA = {
  type: "string",
  maxLength: 64,
  description:
    "IANA zone (e.g. Europe/Paris) for this call's date-only bounds and local labels. Default: the account's timezone. Agents serving people in several zones pass the asker's.",
};

/** `from`/`to` plus the optional per-call timezone, spread into a
 *  windowed tool's properties. */
export const WINDOW_ARGS = {
  from: { type: "string", description: WINDOW_FROM_DESC },
  to: { type: "string", description: WINDOW_TO_DESC },
  timezone: TIMEZONE_SCHEMA,
};

/** The six mode groups, described once (docs: battles#mode-groups). */
export const MODE_SCHEMA = {
  type: "string",
  enum: MODE_GROUPS,
  description:
    "Mode group: ladder (Trophy Road), ranked (Path of Legends), war, casual, challenge, tournament. Omit for every mode.",
};

/** The one size control (review 2.2.4). `compactDesc` says what compact
 *  drops for THIS tool; the shape of the argument never varies. */
export function VERBOSITY(compactDesc) {
  return {
    type: "string",
    enum: ["full", "compact"],
    default: "full",
    description: `compact: ${compactDesc}`,
  };
}

/** Segment scoping for the corpus-wide tools, NESTED so the name itself
 *  says it is a scope and not the caller (review 2.2.3): the same flat
 *  player_tag meant "you" on eleven tools and "the corpus" on five. */
export const SEGMENT_SCHEMA = {
  type: "object",
  description:
    "Scope: exactly one of player_tag, clan_tag (current members) or collection (a player collection's slug, e.g. 'pros'). OMIT the whole object for the entire recorded corpus.",
  properties: {
    player_tag: { type: "string", description: "One recorded player." },
    clan_tag: {
      type: "string",
      description: "A recorded clan's current members.",
    },
    collection: { type: "string", description: "A player collection's slug." },
    on_behalf_of: ON_BEHALF_OF_SCHEMA,
  },
  additionalProperties: false,
};

// --- shared helpers --------------------------------------------------------

/** IANA zone for this call: the argument when given and valid, else the
 *  account's. An invalid zone refuses rather than silently falling to UTC. */
export function zoneFor(ctx, args = {}) {
  if (args.timezone === undefined) return ctx.account?.timezone ?? null;
  const tz = String(args.timezone).trim();
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new ToolFailure(
      "bad_request",
      `Unknown timezone '${tz}'.`,
      "Use an IANA zone such as America/Chicago or Europe/Paris.",
    );
  }
  return tz;
}

/**
 * The window a tool actually uses, from whatever idiom the caller chose.
 *
 *   from/to      - instants or date-only strings, resolved in zoneFor()
 *   days / weeks - sugar: from = now - N days (or 7N days), to = now
 *   neither      - the tool's default (defaultDays), or unbounded
 *
 * Returns Dates for the query and the `applied.window` echo, whose
 * `source` says whether the bounds were given, defaulted or unbounded -
 * the thing an agent quoting "your last 30 days" needs to know before
 * it says it (review 2.2.1: battles_decks returned all-time with no
 * bounds echoed).
 */
export function resolveWindow(
  ctx,
  args = {},
  { defaultDays = null, dateOnly = false } = {},
) {
  const tz = zoneFor(ctx, args);
  const now = new Date();
  let from = null;
  let to = null;
  let source = "unbounded";
  if (args.from !== undefined || args.to !== undefined) {
    if (dateOnly) {
      for (const k of ["from", "to"])
        if (
          args[k] !== undefined &&
          !/^\d{4}-\d{2}-\d{2}$/.test(String(args[k]))
        )
          throw new ToolFailure(
            "bad_request",
            `${k} must be YYYY-MM-DD for this tool.`,
            WINDOW_DATE_ONLY_DESC,
          );
    }
    from = args.from !== undefined ? resolveInstant(tz, args.from) : null;
    to =
      args.to !== undefined
        ? resolveInstant(tz, args.to, { endOfDay: true })
        : null;
    if (args.from !== undefined && !from)
      throw new ToolFailure(
        "bad_request",
        `Could not read from='${args.from}' as a date.`,
        WINDOW_FROM_DESC,
      );
    if (args.to !== undefined && !to)
      throw new ToolFailure(
        "bad_request",
        `Could not read to='${args.to}' as a date.`,
        WINDOW_TO_DESC,
      );
    source = "argument";
  } else if (args.days !== undefined || args.weeks !== undefined) {
    const days =
      args.days !== undefined ? Number(args.days) : Number(args.weeks) * 7;
    from = new Date(now.getTime() - days * 86_400_000);
    to = null;
    source = "argument";
  } else if (defaultDays) {
    from = new Date(now.getTime() - defaultDays * 86_400_000);
    to = null;
    source = "default";
  }
  requireOrderedWindow(from, to);
  return {
    from,
    to,
    timezone: tz,
    source,
    echo: {
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
      source,
      ...(tz ? { timezone: tz } : {}),
    },
  };
}

/** The one echo block. Undefined values are dropped so a tool spreads
 *  whatever it applied and the response carries only what is true. */
/** live: true, asynchronously (1.7.0). Returns { state: "fresh",
 *  fetched_at, payload } when a read inside the API's own cache window is
 *  in hand, or { state: "pending", retry_after_s } after queueing one
 *  priority fetch (charged to the live quota only when minted). Throws
 *  live_unavailable when the lane is not configured or the fresh payload
 *  was rejected at admission. Tools answer from the record either way;
 *  a subject with no record at all raises live_pending via
 *  notRecordedOrPending(). */
export async function liveRead(ctx, { endpoint, entityKey, needPayload }) {
  if (!ctx.live)
    throw new ToolFailure(
      "live_unavailable",
      "The live lane is not configured here.",
      "Call again without live: true.",
    );
  const r = await ctx.live(ctx.db, {
    endpoint,
    entityKey,
    needPayload: needPayload === true,
    beforeMint: () => spendLiveQuota(ctx),
  });
  if (r.ok)
    return { state: "fresh", fetched_at: r.fetched_at, payload: r.payload };
  if (r.reason === "rejected")
    throw new ToolFailure(
      "live_unavailable",
      "The live fetch returned a payload our admission rejected.",
      "Call again without live: true for the recorded view.",
    );
  return { state: "pending", retry_after_s: r.retry_after_s };
}

/** The `live_status` block a live: true answer carries. */
export function liveStatus(live) {
  if (!live) return undefined;
  return live.state === "fresh"
    ? { state: "fresh", fetched_at: live.fetched_at }
    : { state: "pending", retry_after_s: live.retry_after_s };
}

/** The one-sentence caveat for a pending live read (a note, not a key). */
export function livePendingNote(live) {
  return live?.state === "pending"
    ? `A fresh read of the game is queued; call again in ${live.retry_after_s} s for it - this answer is the record as it stands.`
    : null;
}

/** A not_recorded refusal becomes live_pending when a live read is queued:
 *  the subject may exist and be moments away. */
export function notRecordedOrPending(live, message, hint) {
  if (live?.state === "pending")
    return new ToolFailure(
      "live_pending",
      `${message} A live read is queued.`,
      `Call again in ${live.retry_after_s} s.`,
    );
  return new ToolFailure("not_recorded", message, hint);
}

export function appliedBlock(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields ?? {}))
    if (v !== undefined) out[k] = v;
  return out;
}

/** `notes`: one sentence per caveat, empties dropped. */
export function notes(...lines) {
  return lines.flat().filter((l) => typeof l === "string" && l.trim());
}

/** `docs`: a pointer an agent can hand straight to elixir_docs. */
export function docsRef(page, section) {
  return section ? `${page}#${section}` : page;
}

/** Entitlement resolution with plain-object errors converted to the
 *  closed taxonomy. `need`: 'full' | 'summary' | 'battles' (§4.2). */
/**
 * `onBehalfOf` is the end-user id the connecting agent supplies. Threaded here
 * rather than read off a global because one Lambda serves every caller, and a
 * remembered "last user" would be the worst bug this file could have.
 */
export async function subject(db, account, inputTag, need, onBehalfOf = null) {
  let resolved;
  try {
    resolved = await resolveSubject(db, account, inputTag, need, {
      onBehalfOf,
    });
  } catch (err) {
    if (err?.code === "invalid_tag")
      throw new ToolFailure(err.code, err.message, TAG_RULE_HINT);
    if (err?.code) throw new ToolFailure(err.code, err.message, err.hint);
    throw err;
  }
  await stampRead(db, resolved.tag);
  return resolved;
}

/**
 * A resolved subject is a subject somebody asked about: stamp it so the
 * scheduler keeps that player's battlelog within an hour for the next day
 * (docs/FETCH-LOOP-AUDIT-2026-09-09.md). Best-effort by construction --
 * one PK-indexed update, and a failure is logged, never surfaced -- and a
 * subject with no poll_state row (not recorded) is a no-op.
 */
export async function stampRead(db, tag) {
  try {
    await db.query(
      `update poll_state set last_read_at = now()
       where subject_tag = $1 and endpoint = 'player_battlelog'`,
      [tag],
    );
  } catch (err) {
    console.error("read_stamp_failed", tag, err?.message);
  }
}

export async function entitledClan(db, account, inputTag) {
  try {
    return await resolveEntitledClan(db, account, inputTag);
  } catch (err) {
    if (err?.code) throw new ToolFailure(err.code, err.message, err.hint);
    throw err;
  }
}

/** The two pending hints, computed once per response by the invoker
 *  (review 4.1): they used to ride only the tools that built a full
 *  envelope, so the consumer whose only regular call is the feed never
 *  saw feedback_responses_pending and re-read its ledger every tick. */
export async function pendingHints(db, account) {
  try {
    const {
      rows: [row],
    } = await db.query(
      `select
         (select count(*)::int from feedback
          where account_id = $1 and responded_at is not null
            and response_seen_at is null) as fb_pending,
         (select count(*)::int from event_feed ef
          where ef.account_id = $1
            and ef.event_id > (select events_seen_through from account
                               where account_id = $1)) as events_pending`,
      [account.accountId],
    );
    return {
      ...(row.fb_pending > 0
        ? { feedback_responses_pending: row.fb_pending }
        : {}),
      ...(row.events_pending > 0 ? { events_pending: row.events_pending } : {}),
    };
  } catch (err) {
    console.error("pending_hints_failed", err?.message);
    return {};
  }
}

export async function buildMeta(
  db,
  account,
  tag,
  endpoints = ["player_battlelog"],
  { timezone } = {},
) {
  const isPlayer = endpoints.some(
    (e) => e === "player" || e === "player_battlelog",
  );
  const {
    rows: [row],
  } = await db.query(
    `select
       (select min(created_at) from recording
        where subject_type = $3 and subject_tag = $1 and status = 'active') as active_since,
       least(
         case when 'player_battlelog' = any($2) then
           (select min(battle_time) from battle_participant where player_tag = $1) end,
         case when 'player' = any($2) then
           (select min(snapshot_date)::timestamp at time zone 'UTC' from player_snapshot_daily where player_tag = $1) end
       ) as recorded_since,
       (select jsonb_object_agg(e.endpoint, jsonb_build_object(
          'observed_at', ps.last_admitted_at,
          'freshness_seconds', greatest(0,extract(epoch from now() - ps.last_admitted_at)::int)))
        from unnest($2::text[]) e(endpoint)
        left join poll_state ps on ps.subject_tag = $1 and ps.endpoint = e.endpoint) as sources`,
    [tag, endpoints, isPlayer ? "player" : "clan"],
  );
  const sources = row.sources ?? {};
  for (const source of Object.values(sources)) {
    // PostgreSQL greatest() ignores NULL; unknown is not zero-age evidence.
    if (source.observed_at === null) source.freshness_seconds = null;
    else source.observed_at = new Date(source.observed_at).toISOString();
  }
  const ages = Object.values(sources).map((s) => s.freshness_seconds);
  const tz = timezone === undefined ? account.timezone : timezone;
  return responseMeta({
    as_of: new Date().toISOString(),
    ...(row.recorded_since
      ? { recorded_since: row.recorded_since.toISOString() }
      : {}),
    ...(row.active_since
      ? { recording_active_since: row.active_since.toISOString() }
      : {}),
    source_polls: sources,
    freshness_seconds:
      ages.length && ages.every((age) => age !== null)
        ? Math.max(...ages)
        : null,
    ...(tz ? { timezone_applied: tz } : {}),
  });
}

/** Unknown enum values must refuse loudly - a silent empty result is a
 *  lie an agent will repeat (adversarial pass, 2026-09-06). */
export function requireEnum(value, allowed, argName) {
  if (value === undefined || value === null) return;
  if (!allowed.includes(value)) {
    throw new ToolFailure(
      "bad_request",
      `Unknown ${argName}: ${value}`,
      `Valid values: ${allowed.join(", ")}.`,
    );
  }
}

/** Inverted date windows are never intent (edge-poker finding): refuse
 *  loudly instead of returning an empty that reads as "you didn't play". */
export function requireOrderedWindow(from, to) {
  if (from && to && from.getTime() > to.getTime()) {
    throw new ToolFailure(
      "bad_request",
      "from is after to — the window is inverted.",
      "Swap the bounds; from must be the earlier instant.",
    );
  }
}

/** Segment resolution shared by the meta, trends, synergy and badge
 *  tools: `args.segment` holds exactly one of player_tag / clan_tag /
 *  collection, or is absent = the whole recorded corpus (universal
 *  reads). Returns a WHERE fragment + params slice that scopes
 *  battle_participant rows to the segment's players, plus the echo. */
export async function segmentFilter(ctx, args, params) {
  const seg = args.segment ?? {};
  const picked = ["player_tag", "clan_tag", "collection"].filter(
    (k) => seg[k] !== undefined,
  );
  if (picked.length > 1) {
    throw new ToolFailure(
      "bad_request",
      "segment takes at most one of player_tag, clan_tag, collection.",
    );
  }
  if (seg.player_tag !== undefined) {
    const tag = (
      await subject(
        ctx.db,
        ctx.account,
        seg.player_tag,
        "summary",
        seg.on_behalf_of,
      )
    ).tag;
    params.push(tag);
    return {
      where: `bp.player_tag = $${params.length}`,
      label: tag,
      echo: { kind: "player", player_tag: tag },
    };
  }
  if (seg.clan_tag !== undefined) {
    const clanTag = await entitledClan(ctx.db, ctx.account, seg.clan_tag);
    params.push(clanTag);
    return {
      where: `bp.player_tag in (select cm.player_tag from clan_membership cm
               where cm.clan_tag = $${params.length} and cm.left_observed_at is null)`,
      label: clanTag,
      echo: { kind: "clan", clan_tag: clanTag },
    };
  }
  if (seg.collection !== undefined) {
    const slug = String(seg.collection).toLowerCase().trim();
    const { rows } = await ctx.db.query(
      `select c.collection_id from collection c
       where c.slug = $1 and c.kind = 'player'
         and (c.visibility = 'public' or c.owner_account = $2)`,
      [slug, ctx.account.accountId],
    );
    if (!rows[0]) {
      throw new ToolFailure(
        "not_found",
        `No player collection '${slug}'.`,
        "collections_browse lists what exists.",
      );
    }
    params.push(rows[0].collection_id);
    return {
      where: `bp.player_tag in (select m.subject_tag from collection_member m
               where m.collection_id = $${params.length})`,
      label: slug,
      echo: { kind: "collection", collection: slug },
    };
  }
  return { where: null, label: "corpus", echo: { kind: "corpus" } };
}

/** Empirical-Bayes shrinkage (META-INTEL): pull small samples toward
 *  the segment mean; this moderates extremes, not rank ordering. */
export const META_METHODOLOGY = {
  observation_unit: "player_battle",
  outcomes: ["win", "loss"],
  prior_strength: 20,
  // The prior is the CORPUS mean over the same window and mode, never the
  // segment's own (feedback #21): a player-scoped segment that shrinks
  // toward itself regularizes by exactly nothing, and a 4-0 account came
  // back as shrunk_win_rate 1.000. When the corpus window itself is below
  // the floor, a neutral 0.5 stands in.
  prior_source:
    "recorded corpus over the same window and mode (segment-independent); 0.5 when the corpus window is below segment_min_decided",
  // Below this many decided observations a segment is flagged
  // insufficient_sample and shrunk rates are withheld, mirroring
  // battles_levels omitting pilot_score rather than serving a number it
  // cannot support.
  segment_min_decided: 30,
  excluded: ["duels (no single deck)", "boat battles", "draws", "unresolved"],
  confidence_intervals: false,
};

export function ebShrink(
  wins,
  decided,
  segmentMean,
  m = META_METHODOLOGY.prior_strength,
) {
  if (decided === 0) return null;
  return Number(((wins + m * segmentMean) / (decided + m)).toFixed(3));
}

/** The one-sentence caveats every meta tool carries; the formulas are on
 *  the methodology page (docsRef below). */
export const SEGMENT_NOTES = [
  "Pooled player-battle observations, not unique matches: both participants can contribute, so counts are dependent.",
  "Only decided head-to-head battles count; `excluded` says how many duels, boat battles, draws and unresolved outcomes the window held.",
  `shrunk_win_rate shrinks toward the CORPUS mean over the same window and mode, and is withheld below ${META_METHODOLOGY.segment_min_decided} decided observations (insufficient_sample: true).`,
  "Shrinkage moderates extremes but does not adjust for skill or guarantee rank order; no confidence intervals.",
];
export const SEGMENT_DOCS =
  "methodology#deck-and-card-meta-exactly-what-is-counted";

/** Battle types that are one row for up to three games (rounds[]). */
export const DUEL_TYPES = ["riverRaceDuel", "riverRaceDuelColosseum"];

/** What a meta window held that the decided head-to-head population left
 *  out, so a 246-vs-212 gap is self-describing instead of something a
 *  consumer derives by subtraction across three tools (feedback #23).
 *  `where` scopes rows to segment + window + mode only. */
export async function excludedBreakdown(db, where, params) {
  const {
    rows: [r],
  } = await db.query(
    `select count(*)::int as considered,
            count(*) filter (where b.type = any($${params.length + 1}))::int as duels,
            count(*) filter (where b.type_class = 'boat'
                               and not (b.type = any($${params.length + 1})))::int as boat,
            count(*) filter (where bp.outcome = 'draw' and b.type_class = 'pvp'
                               and not (b.type = any($${params.length + 1})))::int as draws,
            count(*) filter (where (bp.outcome is null or bp.outcome = 'unresolved')
                               and b.type_class = 'pvp'
                               and not (b.type = any($${params.length + 1})))::int as unresolved,
            count(*) filter (where bp.outcome in ('win','loss') and b.type_class = 'pvp'
                               and not (b.type = any($${params.length + 1}))
                               and (bp.deck_hash is null or not (bp.deck ? 'cards')
                                    or jsonb_array_length(bp.deck->'cards') = 0))::int as no_deck
     from battle_participant bp join battle b on b.battle_id = bp.battle_id
     where ${where.join(" and ")}`,
    [...params, DUEL_TYPES],
  );
  return {
    considered: r.considered,
    duels: r.duels,
    boat: r.boat,
    draws: r.draws,
    unresolved: r.unresolved,
    no_deck: r.no_deck,
  };
}

/** The corpus prior for shrinkage: decided head-to-head rate over the
 *  same window and mode, ignoring the segment. Null when the corpus
 *  window is below the floor (the caller substitutes 0.5). */
export async function corpusPrior(db, { from, to = null, types = null }) {
  // Its own parameter list: Postgres refuses a bound parameter it cannot
  // type, so the segment's params must not ride along unused.
  const params = [from];
  const where = ["b.battle_time >= $1"];
  if (to) {
    params.push(to);
    where.push(`b.battle_time < $${params.length}`);
  }
  if (types) {
    params.push(types);
    where.push(`b.type = any($${params.length})`);
  }
  const {
    rows: [r],
  } = await db.query(
    `select count(*)::int as decided,
            count(*) filter (where bp.outcome = 'win')::int as wins
     from battle_participant bp join battle b on b.battle_id = bp.battle_id
     where bp.outcome in ('win','loss') and b.type_class = 'pvp'
       and bp.deck_hash is not null and ${where.join(" and ")}`,
    params,
  );
  return r.decided >= META_METHODOLOGY.segment_min_decided
    ? { decided: r.decided, mean: r.wins / r.decided }
    : { decided: r.decided, mean: null };
}

// --- tools -----------------------------------------------------------------

/** Added = recorded, shared honestly: the clan's recording exists while
 *  ANY account has it added OR a collection names it, at the widest
 *  scope anybody asks for. Returns true when this call started it.
 *
 *  Both of these delegate to reconcileRecording rather than counting
 *  account_clan themselves. They used to do their own counting, which
 *  meant they could not see collection membership: removing the last
 *  account that had added a clan stopped a clan a collection was still
 *  curating, and adding one at activity scope could downgrade a clan a
 *  comprehensive collection wanted. One function knows every reason. */
export async function ensureClanRecording(db, tag, requestedBy) {
  const { started } = await reconcileRecording(db, "clan", tag, requestedBy);
  return started;
}

/** After a removal: stop the recording when nothing wants the clan any
 *  more, else settle scope to the widest remaining reason. Returns true
 *  when the recording stopped. */
export async function settleClanRecording(db, tag) {
  const { stopped } = await reconcileRecording(db, "clan", tag, null);
  return stopped;
}
