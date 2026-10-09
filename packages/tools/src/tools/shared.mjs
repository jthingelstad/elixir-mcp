/**
 * Shared helpers for the tool registry (split from the single-file
 * registry, 2026-09-05): entitlement resolution, meta
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

import {
  responseMeta,
  roleQuotas,
  MODE_GROUPS,
  formName,
  classifyDeck,
  resolveArchetypeName,
  normalizeName,
  FAMILIES,
  cardDisplayName,
  DUEL_TYPES,
  duelGamesSql,
} from "@elixir-mcp/contracts";
import { cachedVocabulary } from "@elixir-mcp/ingest/card-roles";
import { reconcileRecording } from "@elixir-mcp/claims";
import { resolveSubject, resolveEntitledClan } from "../entitlements.mjs";
import { resolveInstant } from "../time.mjs";
import { recentCompleteness, completenessNote } from "../coverage.mjs";
import {
  seasonAt,
  seasonByKey,
  seasonCrossings,
} from "@elixir-mcp/record/season";

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
  // A family app's call (a first-party client on the JSON API) spends no
  // one's quota (Jamie, 2026-09-23); the fleet's global rate budget still
  // governs every fetch.
  const unlimited =
    account.isOwner === true ||
    account.firstParty === true ||
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
      "Recorded-data tools are unlimited within the normal quota. Higher tiers get more: elixir_docs({ page: 'roles' }), or ask via elixir_send_feedback.",
    );
  }
}

export class ToolFailure extends Error {
  /** `data`: machine-readable fields rendered beside code, message and
   *  hint on the error body (retry_after_s on live_pending, 3.14.0), so
   *  a consumer never regexes seconds out of the English. */
  constructor(code, message, hint, data = undefined) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.data = data;
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

/** Beside on_behalf_of (3.18.0): the asker's name as the surface shows
 *  it, so an unmapped id's no_subject refusal can carry candidates[]
 *  (clan members whose whole name matches) instead of leaving the
 *  agent to pull the roster and compare names itself. */
export const DISPLAY_NAME_SCHEMA = {
  type: "string",
  maxLength: 60,
  description:
    "Agent connections, beside on_behalf_of: the asker's display name on your surface. When on_behalf_of is not mapped yet, no_subject carries candidates[]: the clan members whose whole name matches it (case and spacing ignored), so one elixir_identify call follows; nothing is guessed from a partial match.",
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
/** The observed-window pair (elixir_timeline, 7.1.5): a window that
 *  selects by when the record OBSERVED an item is (from, to] at the
 *  millisecond the tool serves, so a cut instant passed as `to` reaches
 *  the item at the cut (Gym #245, #273). */
export const WINDOW_OBSERVED_FROM_DESC =
  "Window start, EXCLUSIVE: items the record observed after this instant (ISO, or YYYY-MM-DD in your timezone). Omit to read since the read pointer.";
export const WINDOW_OBSERVED_TO_DESC =
  "Window end, INCLUSIVE: items observed up to and including this instant, compared at the millisecond the tool serves; a date-only to covers that whole day. Omit for now.";
/** Snapshot-series tools take whole days only, never instants. */
export const WINDOW_DATE_ONLY_DESC =
  "YYYY-MM-DD (a game day, the 10:00Z grid), inclusive. Built from daily snapshots, so only whole days are meaningful; an instant is floored to its game day and the response says so.";

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
  // The sugar the server instructions promise on every windowed tool.
  // Until 2026-09-15 five tools declared it and the rest refused it with
  // bad_request - the notable-movers routine, fresh from a successful
  // clans_standings({days: 1}), sent days: 1 to battles_performance for
  // three members and lost three calls learning the difference.
  days: {
    type: "integer",
    minimum: 1,
    description: "Last N days, ending now: sugar for from. Or use from/to.",
  },
  weeks: {
    type: "integer",
    minimum: 1,
    description: "Last N weeks, ending now: sugar for from. Or use from/to.",
  },
  timezone: TIMEZONE_SCHEMA,
};

/** For a tool that reads from/to by hand rather than through
 *  resolveWindow: the same sugar, as a from it can read. from/to given
 *  win; days/weeks only fill an absent from. */
export function withWindowSugar(args = {}) {
  if (args.from !== undefined || args.to !== undefined) return args;
  if (args.days === undefined && args.weeks === undefined) return args;
  const days =
    args.days !== undefined ? Number(args.days) : Number(args.weeks) * 7;
  return {
    ...args,
    from: new Date(Date.now() - days * 86_400_000).toISOString(),
  };
}

/** The six mode groups, described once (docs: battles#mode-groups). */
export const MODE_SCHEMA = {
  type: "string",
  enum: MODE_GROUPS,
  description:
    "Mode group: ladder (Trophy Road to 14,000), ranked (Path of Legends), war, casual (clanmate battles even when tagged), challenge, event (any other battle with an event tag, including the seasonal Trophy Road past 14,000), tournament. Omit for every mode.",
};

/** The one size control. `compactDesc` says what compact
 *  drops for THIS tool; the shape of the argument never varies. */
export function VERBOSITY(compactDesc) {
  return {
    type: "string",
    enum: ["full", "compact"],
    default: "full",
    description: `compact: ${compactDesc}`,
  };
}

/** A read's explicit subject: one player or one clan's current members. */
export const SEGMENT_SCHEMA = {
  description:
    "The recorded player or clan to read: 'mine' (your clan) or an object naming exactly one of player_tag or clan_tag (current members). Required; corpus access has retired.",
  anyOf: [
    { type: "string", enum: ["mine"] },
    {
      type: "object",
      properties: {
        player_tag: { type: "string", description: "One recorded player." },
        clan_tag: {
          type: "string",
          description: "A recorded clan's current members.",
        },
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
      },
      oneOf: [{ required: ["player_tag"] }, { required: ["clan_tag"] }],
      additionalProperties: false,
    },
  ],
};

/**
 * The segment as one resolved thing, before any tool builds its own
 * predicate: `{ kind, echo, ... }` where kind is player or clan,
 * and the object carries the resolved tag. "mine" resolves through
 * entitledClan(undefined), so
 * an account with no clan is no_subject, never a guess.
 */
export async function resolveSegment(ctx, args) {
  const raw = args.segment;
  // The population is named, never defaulted (product call 5; required
  // since 4.0.0, a note-and-corpus default from 3.16.0 to 3.18.0).
  if (raw === undefined || raw === null)
    throw new ToolFailure(
      "bad_request",
      "segment is required: name the player or clan to read.",
      `Pass segment: "mine" (your clan), or an object naming one of player_tag or clan_tag.`,
    );
  if (typeof raw === "string") {
    if (raw === "corpus")
      throw new ToolFailure(
        "bad_request",
        "Corpus statistics have retired.",
        "Name a recorded player or clan.",
      );
    if (raw === "mine") {
      const clanTag = await entitledClan(ctx.db, ctx.account, undefined);
      return {
        kind: "clan",
        clanTag,
        echo: { kind: "clan", clan_tag: clanTag, source: "mine" },
      };
    }
    throw new ToolFailure(
      "bad_request",
      `segment must be 'mine' or an object naming one of player_tag, clan_tag (got '${raw}').`,
    );
  }
  const seg = raw;
  if (Object.hasOwn(seg, "collection"))
    throw new ToolFailure(
      "bad_request",
      "Named recording Collections have retired.",
      "Use player_tag or clan_tag for recorded history.",
    );
  const picked = ["player_tag", "clan_tag"].filter((k) => seg[k] !== undefined);
  if (picked.length > 1) {
    throw new ToolFailure(
      "bad_request",
      "segment takes at most one of player_tag, clan_tag.",
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
    return {
      kind: "player",
      tag,
      echo: { kind: "player", player_tag: tag },
    };
  }
  if (seg.clan_tag !== undefined) {
    const clanTag = await entitledClan(ctx.db, ctx.account, seg.clan_tag);
    return {
      kind: "clan",
      clanTag,
      echo: { kind: "clan", clan_tag: clanTag },
    };
  }
  throw new ToolFailure(
    "bad_request",
    "segment must name exactly one player_tag or clan_tag.",
  );
}

/** Players whose games Elixir records now: direct active recordings and
 *  current members of an actively recorded comprehensive clan. Scoped
 *  history uses this to exclude incidental opponent-only observations. */
export const RECORDED_PLAYERS_SQL = `select subject_tag as player_tag from recording
       where subject_type = 'player' and status = 'active'
     union
     select cm.player_tag
       from recording r
       join clan_membership cm on cm.clan_tag = r.subject_tag
         and cm.left_observed_at is null
      where r.subject_type = 'clan' and r.status = 'active'
        and r.scope = 'comprehensive'`;

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
function resolveWindow(ctx, args = {}, { defaultDays = null } = {}) {
  const tz = zoneFor(ctx, args);
  const now = new Date();
  let from = null;
  let to = null;
  let source = "unbounded";
  if (args.from !== undefined || args.to !== undefined) {
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

/** The `season` argument (3.10.0 on the meta tools and battles_trends;
 *  3.17.0 on the player battle tools and clans_standings). */
export const SEASON_ARG_SCHEMA = {
  type: ["string", "integer"],
  description:
    "Bound the window to one season: 'current' (to date), 'previous', the month the API names it by (2026-08), or the river race season number (135). from/to/days/weeks given win over it.",
};

const DAY_MS = 86_400_000;
const seasonLabel = (s) => `S${s.war} (${s.month})`;

/** What a season roll does to the numbers in this tool: the crossing
 *  note says it in the tool's own terms (3.17.0). */
const CROSSING_TAIL = {
  balance:
    "balance changes land on the season roll, so card values before and after are not one population. Pass season:'current' or split with from/to.",
  series:
    "the seasonal Trophy Road (a new players_timeline.progress_key each season) and the Path of Legends standing reset on the roll, so their points on either side of it are not one series; Trophy Road trophies (and players_timeline.season_trophies, their legacy mirror) carry straight across.",
  ladder:
    "the ladder's seasonal trophies reset on the roll, so trophy-bound numbers before and after are not one series.",
  plain:
    "the season rolls on the first Monday at 10:00Z and applied.window.crosses says where, so read either side as its own season.",
};

/**
 * The season fields for an instant span [fromMs, endMs) (3.17.0, one
 * helper behind every windowed tool): the season the span starts in
 * (`start` when the caller already holds the row; null for an unbounded
 * span, which starts before any season), every roll inside it
 * (`crosses`, empty when clean), the season's age at the span's end,
 * and the crossing note, which fires only when `crosses` is non-empty.
 * An unbounded span (`fromMs` null) crosses every roll on record.
 */
async function seasonFieldsForSpan(
  db,
  fromMs,
  endMs,
  { start, flavor = "balance" } = {},
) {
  const startRow =
    start !== undefined
      ? start
      : fromMs === null
        ? null
        : await seasonAt(db, fromMs);
  // An unbounded span crosses every roll the RECORD spans: it starts at
  // the first recorded battle, not at the season calendar's first row
  // (the calendar reaches back to 2016 for the finals boards, and the
  // 4.0.0 acceptance read found an unbounded battles_query carrying 118
  // crossings and a two-kilobyte note). min(battle_time) is one index
  // probe on battle_time_idx.
  const spanFromMs =
    fromMs ??
    (
      await db.query(`select min(battle_time) as first from battle`)
    ).rows[0]?.first?.getTime() ??
    endMs;
  const crosses = await seasonCrossings(db, spanFromMs, endMs);
  const season = startRow
    ? {
        month: startRow.season_month,
        war: startRow.war_season_id,
        starts_at: startRow.starts_at.toISOString(),
        ends_at: startRow.ends_at.toISOString(),
      }
    : null;
  const seasonAgeDays = startRow
    ? Math.floor(
        (Math.min(endMs, startRow.ends_at.getTime()) -
          startRow.starts_at.getTime()) /
          DAY_MS,
      )
    : null;
  const spanned = crosses.length
    ? [crosses[0].from_season, ...crosses.map((c) => c.to_season)]
        .filter(Boolean)
        .map(seasonLabel)
    : [];
  // The note names the seasons when there are a few; a long span says
  // how many and its ends (crosses[] carries them all).
  const spans =
    spanned.length > 4
      ? `${spanned.length} seasons, ${spanned[0]} to ${spanned.at(-1)}`
      : spanned.length > 1
        ? `${spanned.slice(0, -1).join(", ")} and ${spanned.at(-1)}`
        : spanned[0];
  return {
    start: startRow,
    seasonAgeDays,
    crosses,
    echo: {
      season,
      crosses,
      ...(seasonAgeDays === null ? {} : { season_age_days: seasonAgeDays }),
    },
    seasonNotes: notes(
      crosses.length
        ? `Window spans ${spans}; ${CROSSING_TAIL[flavor] ?? CROSSING_TAIL.balance}`
        : null,
    ),
  };
}

/**
 * The window for a season-aware read. Two defaults: the meta tools
 * (`seasonDefault: true`) default to the current
 * season to date from the `season` row - never a rolling number of days,
 * which is how a 28-day meta window came to mix two seasons 14/86
 * without saying so; the player battle tools (3.17.0, `seasonDefault:
 * false`) keep their unbounded or `defaultDays` default and take
 * `season` as one more way to bound. Explicit bounds always win.
 * Whatever set it, `applied.window` says which season the window starts
 * in, every season boundary it crosses (`crosses`, empty when clean)
 * and how old that season is at the window's end (`season_age_days`);
 * the notes say the same in a sentence. Nothing is refused: an agent
 * asking across a roll may mean it, and `crosses` is what lets a
 * consumer refuse for itself.
 */
export async function resolveSeasonWindow(
  ctx,
  args = {},
  { defaultDays = null, seasonDefault = true, flavor = "balance" } = {},
) {
  const explicit = ["from", "to", "days", "weeks"].some(
    (k) => args[k] !== undefined,
  );
  const nowMs = Date.now();
  let win;
  let row = null;
  let futureNote = null;
  if (
    !explicit &&
    (args.season !== undefined || (seasonDefault && defaultDays === null))
  ) {
    row = await seasonByKey(ctx.db, args.season ?? "current", nowMs);
    if (!row)
      throw new ToolFailure(
        "not_found",
        `No season '${args.season ?? "current"}' in the record.`,
        "season takes 'current', 'previous', the month the API names it by (2026-08) or the river race season number (135); or pass from/to.",
      );
    const tz = zoneFor(ctx, args);
    const from = row.starts_at;
    // A season that has not begun is an empty window at its start, said,
    // not an inverted one (Gym #209: "2026-10" read to < from, and a
    // battles read called it "-12 days old").
    const future = row.starts_at.getTime() > nowMs;
    const to = future
      ? row.starts_at
      : row.ends_at.getTime() > nowMs
        ? null
        : row.ends_at;
    if (future)
      futureNote = `Season ${row.season_month} has not begun: it starts ${row.starts_at.toISOString()}, so nothing is recorded in it yet and this window is empty.`;
    win = {
      from,
      to,
      timezone: tz,
      source: "season",
      echo: {
        from: from.toISOString(),
        to: to ? to.toISOString() : null,
        source: "season",
        ...(tz ? { timezone: tz } : {}),
      },
    };
  } else {
    win = resolveWindow(ctx, args, { defaultDays });
  }
  const fromMs = win.from ? win.from.getTime() : null;
  const endMs = win.to ? win.to.getTime() : nowMs;
  const fields = await seasonFieldsForSpan(ctx.db, fromMs, endMs, {
    ...(row ? { start: row } : {}),
    flavor,
  });
  const seasonAgeDays = fields.seasonAgeDays;
  const seasonNotes = notes(
    futureNote,
    fields.seasonNotes,
    win.source === "season" && win.to === null && seasonAgeDays < 7
      ? `The current season is ${seasonAgeDays} day${seasonAgeDays === 1 ? "" : "s"} old, so this window is thin; season:'previous' is the settled comparison.`
      : null,
  );
  return {
    ...win,
    season: fields.start,
    crosses: fields.crosses,
    seasonNotes,
    echo: { ...win.echo, ...fields.echo },
  };
}

/**
 * The season fields for an instant pair a tool resolved itself
 * (rankings_timeline and elixir_timeline build their windows from
 * `days` or a pointer): the
 * same echo and note resolveSeasonWindow carries (3.17.0).
 */
export async function seasonFieldsForInstants(
  db,
  from,
  to,
  { flavor = "series", clampToNow = true } = {},
) {
  const fromMs = from ? new Date(from).getTime() : null;
  // A reader of the calendar (game_events) keeps the window it echoes:
  // cut at now, a window into next season named no roll (Gym #220).
  const endMs = to
    ? clampToNow
      ? Math.min(new Date(to).getTime(), Date.now())
      : new Date(to).getTime()
    : Date.now();
  const { echo, seasonNotes } = await seasonFieldsForSpan(db, fromMs, endMs, {
    flavor,
  });
  return { echo, seasonNotes };
}

/**
 * The season fields for a DATE-bounded window (the daily series: game
 * days from `fromDay` to `toDay` inclusive, today when `toDay` is null):
 * the season the window starts in, every roll inside it, the season's
 * age at the window's end, and the crossing note - the same echo the
 * instant-bounded tools carry from resolveSeasonWindow.
 */
export async function seasonFieldsForDays(db, fromDay, toDay) {
  const nowMs = Date.now();
  const fromMs = Date.parse(`${fromDay}T10:00:00Z`);
  // A window wholly after now ends where it starts, so a season that has
  // not begun reads age 0, not -12 (Gym #228).
  const endMs = Math.max(
    fromMs,
    toDay ? Math.min(Date.parse(`${toDay}T10:00:00Z`) + DAY_MS, nowMs) : nowMs,
  );
  const { echo, seasonNotes } = await seasonFieldsForSpan(db, fromMs, endMs, {
    flavor: "series",
  });
  return { echo, seasonNotes };
}

/** The one echo block. Undefined values are dropped so a tool spreads
 *  whatever it applied and the response carries only what is true. */
/** live: true, asynchronously (1.7.0). Returns { state: "fresh",
 *  fetched_at, payload } when a read inside the API's own cache window is
 *  in hand, or { state: "pending", retry_after_s } after queueing one
 *  priority fetch (charged to the live quota only when minted);
 *  `record: false` is live_fetch's fetch-only read (0209). A race read
 *  that found the race in matchmaking returns { state: "matchmaking",
 *  fetched_at, retry_after_s, payload }: no race yet, which is an
 *  answer, never a rejection. Throws live_unavailable when the lane is
 *  not configured or the fresh payload was rejected at admission. Tools
 *  answer from the record either way;
 *  a subject with no record at all raises live_pending via
 *  notRecordedOrPending(). */
export async function liveRead(
  ctx,
  { endpoint, entityKey, needPayload, record = true },
) {
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
    // live_fetch alone reads without recording (0209); every other live
    // flag answers from the record, so its read is recorded.
    record: record !== false,
    beforeMint: () => spendLiveQuota(ctx),
  });
  if (r.ok)
    return { state: "fresh", fetched_at: r.fetched_at, payload: r.payload };
  if (r.reason === "live_unavailable")
    throw new ToolFailure(
      "live_unavailable",
      "Global leaderboard capture has been retired.",
      "Existing recorded history remains available without live: true until its retirement.",
    );
  if (r.reason === "matchmaking")
    return {
      state: "matchmaking",
      fetched_at: r.fetched_at,
      retry_after_s: r.retry_after_s,
      payload: r.payload ?? null,
    };
  if (r.reason === "rejected")
    throw new ToolFailure(
      "live_unavailable",
      "The live fetch returned a payload our admission rejected.",
      "Call again without live: true for the recorded view.",
    );
  // queued: false - the one budget had no token for a live read, so none
  // was minted and nothing was charged.
  return {
    state: "pending",
    retry_after_s: r.retry_after_s,
    queued: r.queued !== false,
  };
}

/** The `live_status` block a live: true answer carries. */
export function liveStatus(live) {
  if (!live) return undefined;
  if (live.state === "matchmaking")
    return {
      state: "matchmaking",
      fetched_at: live.fetched_at,
      retry_after_s: live.retry_after_s,
    };
  return live.state === "fresh"
    ? { state: "fresh", fetched_at: live.fetched_at }
    : { state: "pending", retry_after_s: live.retry_after_s };
}

/** The one-sentence caveat for a pending live read (a note, not a key). */
export function livePendingNote(live) {
  if (live?.state !== "pending") return null;
  return live.queued === false
    ? `The shared Clash Royale budget has no room for a fresh read until the next scheduler tick; call again in ${live.retry_after_s} s - this answer is the record as it stands.`
    : `A fresh read of the game is queued; call again in ${live.retry_after_s} s for it - this answer is the record as it stands.`;
}

/** A not_recorded refusal becomes live_pending when a live read is queued:
 *  the subject may exist and be moments away. */
export function notRecordedOrPending(live, message, hint) {
  if (live?.state === "pending")
    return new ToolFailure(
      "live_pending",
      live.queued === false
        ? `${message} The shared Clash Royale budget has no room for a live read until the next scheduler tick.`
        : `${message} A live read is queued.`,
      `Call again in ${live.retry_after_s} s.`,
      { retry_after_s: live.retry_after_s },
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
export async function subject(
  db,
  account,
  inputTag,
  need,
  onBehalfOf = null,
  displayName = null,
) {
  let resolved;
  try {
    resolved = await resolveSubject(db, account, inputTag, need, {
      onBehalfOf,
      displayName,
    });
  } catch (err) {
    if (err?.code === "invalid_tag")
      throw new ToolFailure(err.code, err.message, TAG_RULE_HINT);
    if (err?.code)
      throw new ToolFailure(err.code, err.message, err.hint, err.data);
    throw err;
  }
  await stampRead(db, resolved.tag);
  return resolved;
}

/**
 * A resolved subject is a subject somebody asked about: stamp it so the
 * scheduler keeps that player's battlelog within an hour for the next day
 * (the 2026-09-09 fetch-loop audit). Best-effort by construction --
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

/** The two pending hints, computed once per response by the invoker:
 * they used to ride only the tools that built a full
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
         -- Subjects of yours the recorder admitted something for since your
         -- read pointer (3.0.0): a count of subjects, so a reader knows
         -- whether a timeline read would carry anything. No pointer yet
         -- means anything ever admitted counts.
         (select count(*)::int from (
            select c.player_tag as tag from claim c
             where c.account_id = $1 and c.notify
            union
            select ac.clan_tag from account_clan ac
             where ac.account_id = $1 and ac.notify) s
          where exists (
            select 1 from poll_state ps
             where ps.subject_tag = s.tag
               and ps.last_admitted_at > coalesce(
                 -- The oldest NAMED pointer when any reader has marked
                 -- (3.18.0), else the account's own; a consumer that
                 -- names itself sees pending fall to 0 after its read. A
                 -- reader that has not marked for 30 days is dead and
                 -- must not hold the hint high for everyone else.
                 (select min(read_to) from timeline_reader
                   where account_id = $1 and updated_at > now() - interval '30 days'),
                 (select activity_seen_at from account where account_id = $1),
                 'epoch'::timestamptz))) as timeline_pending`,
      [account.accountId],
    );
    return {
      feedback_responses_pending: row.fb_pending,
      timeline_pending: row.timeline_pending,
    };
  } catch (err) {
    console.error("pending_hints_failed", err?.message);
    return {};
  }
}

/** meta.completeness_note for player subjects: it fires for a subject
 *  whose window ends inside the last seven days (an unbounded window ends
 *  now) when the newest profile interval reads under 0.9 or is unknown
 *  with a tail over 48 hours (review 2026-09-19, defect 13: promised on
 *  every seam, set by nothing). Several subjects (battles_compare, #108)
 *  get one sentence per incomplete side, each naming its tag, in the
 *  order given; null when no side is incomplete, never boilerplate. */
export async function completenessNotes(db, tags, windowTo) {
  const recentWindow =
    windowTo === undefined ||
    windowTo === null ||
    Date.now() - new Date(windowTo).getTime() < 7 * 86_400_000;
  if (!recentWindow) return null;
  const sentences = [];
  for (const tag of new Set(tags)) {
    if (!/^#[0289PYLQGRJCUV]{3,12}$/.test(tag)) continue;
    const note = completenessNote(tag, await recentCompleteness(db, tag));
    if (note) sentences.push(note);
  }
  return sentences.length ? sentences.join(" ") : null;
}

export async function buildMeta(
  db,
  account,
  tag,
  endpoints = ["player_battlelog"],
  { timezone, windowTo } = {},
) {
  const isPlayer = endpoints.some(
    (e) => e === "player" || e === "player_battlelog",
  );
  const completeness = isPlayer
    ? await completenessNotes(db, [tag], windowTo)
    : null;
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
    ...(completeness ? { completeness_note: completeness } : {}),
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

/** Resolve an explicit player or the recorded current members of a clan. */
export async function segmentFilter(ctx, args, params) {
  const seg = await resolveSegment(ctx, args);
  if (seg.kind === "player") {
    params.push(seg.tag);
    return {
      where: `bp.player_tag = $${params.length}`,
      timeColumn: "bp.battle_time",
      label: seg.tag,
      echo: seg.echo,
    };
  }
  if (seg.kind === "clan") {
    params.push(seg.clanTag);
    // The members Elixir RECORDS (Jamie, 2026-09-23: a player known only
    // from a battle stub is a ghost entry, never in a metric). An
    // activity-scope clan's other members appear only in recorded
    // players' logs, and pooled 21% of NoA's battles (Gym #286). The note
    // says how many members counted.
    const {
      rows: [cov],
    } = await ctx.db.query(
      `select count(*)::int as members,
              count(*) filter (where cm.player_tag in (${RECORDED_PLAYERS_SQL}))::int as recorded
         from clan_membership cm
        where cm.clan_tag = $1 and cm.left_observed_at is null`,
      [seg.clanTag],
    );
    return {
      where: `bp.player_tag in (select cm.player_tag from clan_membership cm
               where cm.clan_tag = $${params.length} and cm.left_observed_at is null)
              and bp.player_tag in (${RECORDED_PLAYERS_SQL})`,
      coverage:
        cov && cov.recorded < cov.members
          ? { members: cov.members, recorded: cov.recorded }
          : null,
      timeColumn: "bp.battle_time",
      label: seg.clanTag,
      echo: seg.echo,
    };
  }
  throw new ToolFailure(
    "bad_request",
    "A recorded player or clan is required.",
  );
}

/** Current-clan membership caveat shared by scoped history reads. */
export function clanSegmentNote(seg) {
  const echo = seg?.echo ?? seg;
  // A clan segment is today's roster over the whole window (Gym #300: a
  // member who left dropped out of the weeks he played for the clan, and
  // a joiner's battles from before joining counted).
  if (echo?.kind === "clan")
    return [
      seg?.coverage
        ? `The clan segment counts the members Elixir records: ${seg.coverage.recorded} of this clan's ${seg.coverage.members} current members. The others are not recorded now, so none of their battles count, not even ones captured while they were (elixir_coverage says who was polled when; elixir_track_clan with scope comprehensive records every member).`
        : null,
      "The clan segment applies the clan's membership as of this call: over a past window it counts today's members' battles, including ones played before they joined, and leaves out members who have left since (clans_members_timeline lists the joins and departures).",
    ]
      .filter(Boolean)
      .join(" ");
  return null;
}

export { DUEL_TYPES };

/** The selected participants' sources as GAMES (9.11.0, feedback #363):
 *  every row as it was, `round` 0 (a duel's whole row among them, with no
 *  deck, so never decided), and each recorded round of a duel beside it
 *  with its own deck_hash and outcome (contracts' duelGamesSql). Each is
 *  a parenthesized subquery; name it `bp`. A battle count reads round 0;
 *  a decided count reads every row with a deck. A round carries no side
 *  level. */
const PARTICIPANT_GAME_COLUMNS = [
  "battle_id",
  "player_tag",
  "side",
  "battle_time",
  "type",
  "type_class",
  "deck_hash",
  "outcome",
  "deck_avg_level",
  "opp_deck_avg_level",
  "starting_trophies",
];
const PARTICIPANT_LEVELS = ["deck_avg_level", "opp_deck_avg_level"];
export const participantGamesSql = (from) =>
  duelGamesSql(from, PARTICIPANT_GAME_COLUMNS, { blank: PARTICIPANT_LEVELS });
export const PARTICIPANT_GAMES = participantGamesSql("battle_participant");
/** The archetype vocabulary (0147): one cache for the readers and the
 *  ingest path (card-roles.mjs). */
const vocabulary = cachedVocabulary;

/** A deck's archetype object (design §4.2): the grammar over the cards
 *  with their catalog costs, the vocabulary's version beside the
 *  grammar's. `cards` carry id, name, form and elixir_cost. */
function archetypeOf(cards, vocab) {
  const a = classifyDeck(cards, vocab.roles);
  return {
    family: a.family,
    win_conditions: a.win_conditions,
    secondary_win_conditions: a.secondary_win_conditions,
    named_by: a.named_by,
    label: a.label,
    average_elixir: a.average_elixir,
    basis: a.basis,
    grammar_version: a.grammar_version,
    roles_version: vocab.version?.roles_version ?? null,
  };
}

/** The archetype argument on the deck readers (design §5.1): a family,
 *  a composed label, or a community alias. */
export const ARCHETYPE_ARG = {
  type: "string",
  maxLength: 80,
  description:
    "Only decks of this archetype: a family (beatdown, control, cycle, bait, bridge spam, siege), a composed label ('Royal Hogs bridge spam', 'Hog Rider cycle'), or a community name ('LavaLoon', 'Log Bait', '2.6 Hog'). Applied over the rows the call would return; applied.archetype echoes what it resolved to. An unknown name is refused with the vocabulary in the hint.",
};

/** A card name as a person types it to a catalog card: exact after
 *  normalisation, with the dots of P.E.K.K.A dropped either way. */
function cardMatcher(cards) {
  const byKey = new Map();
  for (const c of cards) {
    byKey.set(normalizeName(c.name), c);
    byKey.set(normalizeName(c.name.replace(/\./g, "")), c);
  }
  return (text) =>
    byKey.get(normalizeName(text)) ??
    byKey.get(normalizeName(String(text).replace(/\./g, ""))) ??
    null;
}

export async function resolveArchetypeArg(db, text) {
  const vocab = await vocabulary(db);
  const resolved = resolveArchetypeName(
    String(text),
    vocab.aliases.map((a) => ({
      alias: a.alias,
      cards: a.cards,
      family: a.family,
    })),
    cardMatcher(vocab.cards),
    vocab.roles,
  );
  if (!resolved)
    throw new ToolFailure(
      "bad_request",
      `Could not read archetype '${text}'.`,
      `A family (${FAMILIES.filter((f) => f !== "unclassified")
        .map((f) => f.replace("_", " "))
        .join(
          ", ",
        )}), a label '<card> <family>' (Royal Hogs bridge spam), or a community name the docs page archetypes lists (LavaLoon, Log Bait, 2.6 Hog).`,
    );
  return { requested: String(text), ...resolved };
}

/** Does a deck's archetype match a resolution: the family when one was
 *  named, and every resolved card among its win conditions. */
export function matchesArchetype(archetype, resolved) {
  if (!archetype) return false;
  if (resolved.family && archetype.family !== resolved.family) return false;
  // A form the name said must be the form played (Gym #105); no form
  // means any.
  return resolved.win_conditions.every((w) =>
    archetype.win_conditions.some(
      (x) => x.id === w.id && (!w.form || x.form === w.form),
    ),
  );
}

/** The label fragment a formed win condition prints ("Evo Royal Hogs"):
 *  the stamp keeps win condition ids without forms, and its label is
 *  the grammar's own spelling of the form. */
export function formedLabelParts(resolved) {
  return resolved.win_conditions
    .filter((w) => w.form)
    .map((w) => cardDisplayName({ name: w.name, form: w.form }));
}

/** The stamped archetype of many decks at once (0148): family, label,
 *  win condition ids per hash. A deck the nightly has not reached yet is
 *  classified here from its cards, so a reader never sees a hole. */
export async function deckStamps(db, hashes) {
  const wanted = [...new Set(hashes.filter(Boolean))];
  const out = new Map();
  if (wanted.length === 0) return out;
  const { rows } = await db.query(
    `select deck_hash, archetype_family, archetype_label, archetype_win_conditions
     from deck where deck_hash = any($1)`,
    [wanted],
  );
  const missing = [];
  for (const r of rows) {
    if (r.archetype_label === null) missing.push(r.deck_hash);
    else
      out.set(r.deck_hash, {
        family: r.archetype_family,
        label: r.archetype_label,
        win_condition_ids: r.archetype_win_conditions ?? [],
      });
  }
  if (missing.length) {
    const identities = await deckIdentities(db, missing);
    for (const [hash, identity] of identities)
      out.set(hash, {
        family: identity.archetype.family,
        label: identity.archetype.label,
        win_condition_ids: identity.archetype.win_conditions.map((w) => w.id),
      });
  }
  return out;
}

/** Does a stamp match a resolution (the stamped twin of matchesArchetype). */
export function stampMatches(stamp, resolved) {
  if (!stamp) return false;
  if (resolved.family && stamp.family !== resolved.family) return false;
  return (
    resolved.win_conditions.every((w) =>
      stamp.win_condition_ids.includes(w.id),
    ) &&
    formedLabelParts(resolved).every((part) =>
      String(stamp.label ?? "").includes(part),
    )
  );
}

/** The note that rides any response carrying deck objects (once). */
export const ARCHETYPE_NOTE =
  "archetype is Elixir's descriptive name for a deck's shape - its win condition and family, composed from the cards and their costs - not a claim about what players call it or how it performs; several deck identities (forms) share one label, and a deck with no attested win condition is named by its cost alone.";

/** A card set's identity from its cards alone ([{id, form}] per key), for
 *  a deck no deck row holds (a war deck played only in duels): the cards
 *  named, with the archetype deckIdentities would give them. */

export async function deckIdentities(db, hashes) {
  const wanted = [...new Set(hashes.filter(Boolean))];
  if (wanted.length === 0) return new Map();
  const { rows } = await db.query(
    `select d.deck_hash, dc.card_id, dc.form, c.name, c.elixir_cost,
            d.tower_troop_id, t.name as tower_name
     from deck d
     left join deck_card dc on dc.deck_hash = d.deck_hash
     left join card c on c.card_id = dc.card_id
     left join card t on t.card_id = d.tower_troop_id
     where d.deck_hash = any($1)
     order by d.deck_hash, dc.card_id, dc.form`,
    [wanted],
  );
  const vocab = await vocabulary(db);
  const out = new Map();
  const costs = new Map();
  for (const r of rows) {
    if (!out.has(r.deck_hash)) {
      out.set(r.deck_hash, {
        cards: [],
        ...(r.tower_troop_id === null
          ? {}
          : { tower_troop: { id: r.tower_troop_id, name: r.tower_name } }),
      });
      costs.set(r.deck_hash, []);
    }
    if (r.card_id !== null) {
      out.get(r.deck_hash).cards.push({
        id: r.card_id,
        name: r.name,
        form: formName(r.form),
      });
      costs.get(r.deck_hash).push({
        id: r.card_id,
        name: r.name,
        form: r.form,
        elixir_cost: r.elixir_cost,
      });
    }
  }
  // The archetype on the value (design §4.1): every deck object the
  // contract serves passes through here.
  for (const [hash, identity] of out)
    identity.archetype = archetypeOf(costs.get(hash) ?? [], vocab);
  return out;
}

/**
 * The decks played in a set of battles, rendered from the card rows
 * (0091) in the shape battles_query has always served for `deck`:
 * {cards:[{id, name, level, evolutionLevel?, starLevel?}], supportCards?}
 * for a single deck, {rounds:[{cards}]} for a duel. Names come from the
 * catalog. Returns a Map "battle_id|player_tag" -> deck; a participant
 * with no card rows is absent (null deck).
 */
export async function renderDecks(db, battleIds) {
  const ids = [...new Set(battleIds)];
  if (ids.length === 0) return new Map();
  const { rows } = await db.query(
    `select pc.battle_id, pc.player_tag, pc.round, pc.slot, pc.card_id, pc.form,
            pc.level, pc.star_level, c.name, c.elixir_cost
     from battle_participant_card pc
     join card c on c.card_id = pc.card_id
     where pc.battle_id = any($1)
     order by pc.battle_id, pc.player_tag, pc.round, pc.slot`,
    [ids],
  );
  const vocab = await vocabulary(db);
  const out = new Map();
  const costs = new Map(); // deck object -> its cards with cost
  // The API's own card shape (evolutionLevel is its raw form code), with
  // the one form vocabulary beside it (DECISIONS: labels go beside
  // identifiers; form base|evolution|hero, 9.1.0).
  const card = (r) => ({
    id: r.card_id,
    name: r.name,
    level: r.level,
    form: formName(r.form),
    ...(r.form > 0 ? { evolutionLevel: r.form } : {}),
    ...(r.star_level !== null ? { starLevel: r.star_level } : {}),
  });
  for (const r of rows) {
    const key = `${r.battle_id}|${r.player_tag}`;
    let deck = out.get(key);
    if (!deck) {
      deck = r.round > 0 ? { rounds: [] } : { cards: [] };
      out.set(key, deck);
    }
    const priced = {
      id: r.card_id,
      name: r.name,
      form: r.form,
      elixir_cost: r.elixir_cost,
    };
    if (r.round > 0) {
      while (deck.rounds.length < r.round) deck.rounds.push({ cards: [] });
      const round = deck.rounds[r.round - 1];
      round.cards.push(card(r));
      (costs.get(round) ?? costs.set(round, []).get(round)).push(priced);
    } else if (r.slot === 0) {
      (deck.supportCards ??= []).push(card(r));
    } else {
      deck.cards.push(card(r));
      (costs.get(deck) ?? costs.set(deck, []).get(deck)).push(priced);
    }
  }
  // The archetype on every rendered deck and duel round (design §4.1).
  for (const [holder, cards] of costs)
    holder.archetype = archetypeOf(cards, vocab);
  return out;
}

// --- tools -----------------------------------------------------------------

/** A clan is recorded at the widest scope requested by a direct follower.
 * The shared evaluator also preserves explicit operator recordings. */
export async function ensureClanRecording(db, tag, requestedBy) {
  const { started } = await reconcileRecording(db, "clan", tag, requestedBy);
  return started;
}

/** The mean level a player has actually fielded: the average of their
 *  decks' mean card level over decided pvp battles in the window (and
 *  mode, when one is asked). The benchmark that makes a held level
 *  meaningful; null with no such battles. */
export async function fieldedLevel(db, tag, { from, to, types }) {
  const { rows } = await db.query(
    `select round(avg(deck_avg_level)::numeric, 2) as mean, count(deck_avg_level)::int as battles
     from battle_participant
     where player_tag = $1 and battle_time >= $2
       and ($3::timestamptz is null or battle_time < $3)
       and ($4::text[] is null or type = any($4))
       and type_class = 'pvp' and outcome in ('win', 'loss') and deck_avg_level is not null`,
    [tag, from, to ?? null, types ?? null],
  );
  const r = rows[0];
  // The level fielded NOW (Gym #133): a levelling account's 30-day mean
  // sits about two levels below its last battles, and a target set from
  // it misses most upgrades. The last ten decided battles in the window.
  const { rows: recent } = await db.query(
    `select round(avg(l)::numeric, 2) as mean
       from (select deck_avg_level as l from battle_participant
              where player_tag = $1 and battle_time >= $2
                and ($3::timestamptz is null or battle_time < $3)
                and ($4::text[] is null or type = any($4))
                and type_class = 'pvp' and outcome in ('win', 'loss')
                and deck_avg_level is not null
              order by battle_time desc limit 10) x`,
    [tag, from, to ?? null, types ?? null],
  );
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  return {
    mean_level: num(r?.mean),
    recent_mean_level: num(recent[0]?.mean),
    battles: r?.battles ?? 0,
  };
}
