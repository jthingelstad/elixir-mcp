/**
 * Shared helpers for the tool registry (split from the single-file
 * registry, review item 8, 2026-09-05): entitlement resolution, meta
 * assembly, segment filters, the closed error class, and the shared
 * clan-recording acts both doors use. Handlers live in the per-group
 * modules beside this file; tools.mjs assembles them.
 */

import { responseMeta, roleQuotas } from "@elixir-mcp/contracts";
import { resolveSubject, resolveEntitledClan } from "../entitlements.mjs";

/** The live lane spends real CR budget: tight per-account daily cap,
 *  defaulted by role (contracts roles.ts), beaten by the per-account
 *  live_daily_quota override. */
export async function spendLiveQuota(ctx) {
  if (ctx.account.isOwner || ctx.account.role === "admin") return;
  const cap =
    ctx.account.liveDailyQuota ??
    roleQuotas(ctx.account.role).live_fetches_per_day;
  if (cap === Infinity) return;
  const day = new Date().toISOString().slice(0, 10);
  const { rows } = await ctx.db.query(
    `insert into rate_limit (bucket, window_start, count) values ($1, $2::date, 1)
     on conflict (bucket, window_start) do update set count = rate_limit.count + 1
     returning count`,
    [`liveday#${ctx.account.accountId}`, day],
  );
  if (rows[0].count > cap) {
    throw new ToolFailure(
      "quota_exceeded",
      `Live-fetch quota reached (${cap}/day for the ${ctx.account.role ?? "member"} tier).`,
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
    "Clash Royale player tag like #20JJJ2CCRU. Defaults to your primary claimed tag.",
};

// --- shared helpers --------------------------------------------------------

/** Entitlement resolution with plain-object errors converted to the
 *  closed taxonomy. `need`: 'full' | 'summary' | 'battles' (§4.2). */
export const TAG_RULE_HINT =
  "Tags are # plus 3-12 characters from 0289PYLQGRJCUV (letter O folds to zero).";

export async function subject(db, account, inputTag, need) {
  try {
    return await resolveSubject(db, account, inputTag, need);
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

export async function buildMeta(db, account, tag) {
  const { rows } = await db.query(
    `select
       (select min(created_at) from recording
        where subject_type = 'player' and subject_tag = $1 and status = 'active') as recorded_since,
       (select extract(epoch from now() - max(last_admitted_at))::int from poll_state
        where subject_tag = $1) as freshness_seconds,
       (select count(*)::int from feedback
        where account_id = $2 and responded_at is not null
          and response_seen_at is null) as fb_pending,
       (select count(*)::int from event_feed ef
        where ef.account_id = $2
          and ef.event_id > (select events_seen_through from account
                             where account_id = $2)) as events_pending`,
    [tag, account.accountId],
  );
  const row = rows[0] ?? {};
  return responseMeta({
    as_of: new Date().toISOString(),
    ...(row.recorded_since
      ? { recording_active_since: row.recorded_since.toISOString() }
      : {}),
    ...(row.freshness_seconds !== null && row.freshness_seconds !== undefined
      ? { freshness_seconds: row.freshness_seconds }
      : {}),
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
    const tag = (await subject(ctx.db, ctx.account, args.player_tag, "summary"))
      .tag;
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
 *  the segment mean so a 3-0 deck never outranks a 60-40 one. */
export function ebShrink(wins, decided, segmentMean, m = 20) {
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

export const SEGMENT_NOTE =
  "Pure observation, never opinion: rates are computed from recorded battles with sample sizes attached. shrunk_win_rate is empirical-Bayes (prior = the segment mean, strength 20) so tiny samples never top the list. players counts distinct pilots - a rate carried by one player is composition, not the deck.";

// --- tools -----------------------------------------------------------------

/** Added = recorded, shared honestly: the clan's recording exists while
 *  ANY account has it added, at the widest requested scope. Returns
 *  true when this call started the recording. */
export async function ensureClanRecording(db, tag, requestedBy) {
  const { rows: eff } = await db.query(
    `select max(scope) as scope from account_clan where clan_tag = $1`,
    [tag],
  );
  const scope = eff[0]?.scope ?? "comprehensive"; // 'comprehensive' > 'activity' lexically
  const { rowCount: started } = await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, clan_scope)
     select 'clan', $1, $2, $3
     where not exists (select 1 from recording
                       where subject_type = 'clan' and subject_tag = $1 and status = 'active')`,
    [tag, requestedBy, scope],
  );
  if (started === 0) {
    await db.query(
      `update recording set clan_scope = $2
       where subject_type = 'clan' and subject_tag = $1 and status = 'active'
         and clan_scope <> $2`,
      [tag, scope],
    );
  }
  return started > 0;
}

/** After a removal: stop the recording when no account has the clan
 *  added any more, else settle scope to the widest remaining request.
 *  Returns true when the recording stopped. */
export async function settleClanRecording(db, tag) {
  const { rows: eff } = await db.query(
    `select max(scope) as scope, count(*)::int as n
     from account_clan where clan_tag = $1`,
    [tag],
  );
  if (eff[0].n === 0) {
    const { rowCount } = await db.query(
      `update recording set status = 'stopped'
       where subject_type = 'clan' and subject_tag = $1 and status = 'active'`,
      [tag],
    );
    return rowCount > 0;
  }
  await db.query(
    `update recording set clan_scope = $2
     where subject_type = 'clan' and subject_tag = $1 and status = 'active'
       and clan_scope <> $2`,
    [tag, eff[0].scope],
  );
  return false;
}
