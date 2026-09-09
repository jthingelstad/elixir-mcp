/**
 * Shared helpers for the tool registry (split from the single-file
 * registry, review item 8, 2026-09-05): entitlement resolution, meta
 * assembly, segment filters, the closed error class, and the shared
 * clan-recording acts both doors use. Handlers live in the per-group
 * modules beside this file; tools.mjs assembles them.
 */

import { responseMeta, roleQuotas } from "@elixir-mcp/contracts";
import { reconcileRecording } from "@elixir-mcp/claims";
import { resolveSubject, resolveEntitledClan } from "../entitlements.mjs";

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

export async function spendLiveQuota(ctx) {
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
      "Recorded-data tools are unlimited within the normal quota. Higher tiers get more - see /docs (Roles) or ask via elixir_feedback.",
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

export const TAG_SCHEMA = {
  type: "string",
  description:
    "Clash Royale player tag like #20JJJ2CCRU. OMIT IT to mean the caller: your primary player on a personal connection, or whoever on_behalf_of is mapped to on an agent one. You do not need to look yourself up first.",
};

/**
 * Who is asking, when the connection serves more than one human.
 *
 * An agent talks to a whole Discord (or Signal, or Telegram, or anything with
 * ids); MCP carries no per-request end-user identity, so the agent supplies
 * one. The value is opaque here on purpose — the point is that any surface
 * works — and it selects a default subject, nothing more.
 */
export const ON_BEHALF_OF_SCHEMA = {
  type: "string",
  maxLength: 200,
  description:
    "The end user this request is for, in your own id space (e.g. discord:1234). Selects whose player is meant when player_tag is omitted; map it once with elixir_identify. Ignored on a personal connection, which already has exactly one human.",
};

// --- shared helpers --------------------------------------------------------

/** Entitlement resolution with plain-object errors converted to the
 *  closed taxonomy. `need`: 'full' | 'summary' | 'battles' (§4.2). */
export const TAG_RULE_HINT =
  "Tags are # plus 3-12 characters from 0289PYLQGRJCUV (letter O folds to zero).";

/**
 * `onBehalfOf` is the end-user id the connecting agent supplies. Threaded here
 * rather than read off a global because one Lambda serves every caller, and a
 * remembered "last user" would be the worst bug this file could have.
 */
export async function subject(db, account, inputTag, need, onBehalfOf = null) {
  try {
    return await resolveSubject(db, account, inputTag, need, { onBehalfOf });
  } catch (err) {
    if (err?.code === "invalid_tag")
      throw new ToolFailure(err.code, err.message, TAG_RULE_HINT);
    if (err?.code) throw new ToolFailure(err.code, err.message, err.hint);
    throw err;
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

export async function buildMeta(
  db,
  account,
  tag,
  endpoints = ["player_battlelog"],
) {
  const isPlayer = endpoints.some(
    (e) => e === "player" || e === "player_battlelog",
  );
  const {
    rows: [row],
  } = await db.query(
    `select
       (select min(created_at) from recording
        where subject_type = $4 and subject_tag = $1 and status = 'active') as active_since,
       least(
         case when 'player_battlelog' = any($3) then
           (select min(battle_time) from battle_participant where player_tag = $1) end,
         case when 'player' = any($3) then
           (select min(snapshot_date)::timestamp at time zone 'UTC' from player_snapshot_daily where player_tag = $1) end
       ) as recorded_since,
       (select jsonb_object_agg(e.endpoint, jsonb_build_object(
          'observed_at', ps.last_admitted_at,
          'freshness_seconds', greatest(0,extract(epoch from now() - ps.last_admitted_at)::int)))
        from unnest($3::text[]) e(endpoint)
        left join poll_state ps on ps.subject_tag = $1 and ps.endpoint = e.endpoint) as sources,
       (select count(*)::int from feedback
        where account_id = $2 and responded_at is not null
          and response_seen_at is null) as fb_pending,
       (select count(*)::int from event_feed ef
        where ef.account_id = $2
          and ef.event_id > (select events_seen_through from account
                             where account_id = $2)) as events_pending`,
    [tag, account.accountId, endpoints, isPlayer ? "player" : "clan"],
  );
  const sources = row.sources ?? {};
  for (const source of Object.values(sources)) {
    // PostgreSQL greatest() ignores NULL; unknown is not zero-age evidence.
    if (source.observed_at === null) source.freshness_seconds = null;
    else source.observed_at = new Date(source.observed_at).toISOString();
  }
  const ages = Object.values(sources).map((s) => s.freshness_seconds);
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
    ...(row.fb_pending > 0
      ? { feedback_responses_pending: row.fb_pending }
      : {}),
    ...(row.events_pending > 0 ? { events_pending: row.events_pending } : {}),
    ...(account.timezone ? { timezone_applied: account.timezone } : {}),
  });
}

/** Inverted date windows are never intent (edge-poker finding): refuse
 *  loudly instead of returning an empty that reads as "you didn't play". */
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

export function requireOrderedWindow(from, to) {
  if (from && to && from.getTime() > to.getTime()) {
    throw new ToolFailure(
      "bad_request",
      "from is after to — the window is inverted.",
      "Swap the bounds; from must be the earlier instant.",
    );
  }
}

/** Segment resolution shared by the meta and trends tools: exactly one
 *  of player_tag / clan_tag / collection, or none = the whole recorded
 *  corpus (universal reads). Returns a WHERE fragment + params slice
 *  that scopes battle_participant rows to the segment's players. */
export async function segmentFilter(ctx, args, params) {
  const picked = ["player_tag", "clan_tag", "collection"].filter(
    (k) => args[k] !== undefined,
  );
  if (picked.length > 1) {
    throw new ToolFailure(
      "bad_request",
      "Pick at most one of player_tag, clan_tag, collection.",
    );
  }
  if (args.player_tag !== undefined) {
    const tag = (
      await subject(
        ctx.db,
        ctx.account,
        args.player_tag,
        "summary",
        args.on_behalf_of,
      )
    ).tag;
    params.push(tag);
    return { where: `bp.player_tag = $${params.length}`, label: tag };
  }
  if (args.clan_tag !== undefined) {
    const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
    params.push(clanTag);
    return {
      where: `bp.player_tag in (select cm.player_tag from clan_membership cm
               where cm.clan_tag = $${params.length} and cm.left_observed_at is null)`,
      label: clanTag,
    };
  }
  if (args.collection !== undefined) {
    const slug = String(args.collection).toLowerCase().trim();
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
    };
  }
  return { where: null, label: "corpus" };
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

export const SEGMENT_ARGS = {
  player_tag: {
    type: "string",
    description: "Scope to one recorded player.",
  },
  clan_tag: {
    type: "string",
    description: "Scope to a recorded clan's current members.",
  },
  collection: {
    type: "string",
    description: "Scope to a player collection's members (e.g. 'pros').",
  },
};

export const SEGMENT_NOTE = `Descriptive pooled player-battle observations, not unique matches or independent trials: both participants can contribute. Only decided head-to-head battles count: duels (up to three decks, no single deck identity), boat battles (an attack on a static defense), draws and unresolved outcomes are excluded from counts, usage and rates, and 'excluded' says how many of each the window held. shrunk_win_rate = (wins + ${META_METHODOLOGY.prior_strength} * prior_win_rate) / (wins + losses + ${META_METHODOLOGY.prior_strength}), where prior_win_rate is the CORPUS mean over the same window and mode - never the segment's own mean, so a one-deck player is regularized toward the population rather than toward themselves. Below ${META_METHODOLOGY.segment_min_decided} decided observations the segment carries insufficient_sample: true and shrunk_win_rate is withheld. Calculations use unrounded means; displayed rates are independently rounded to three decimals. Shrinkage moderates extremes but does not guarantee rankings or adjust for player skill. players counts distinct players, not an effective sample size. No confidence intervals or causal lift are estimated. An empty segment has no observed win rate.`;

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
