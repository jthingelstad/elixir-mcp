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

import {
  responseMeta,
  roleQuotas,
  MODE_GROUPS,
  formName,
  normalizeTag,
  cardForms,
  CARD_FORM_BITS,
} from "@elixir-mcp/contracts";
import { reconcileRecording } from "@elixir-mcp/claims";
import { resolveSubject, resolveEntitledClan } from "../entitlements.mjs";
import { resolveInstant } from "../time.mjs";
import { recentCompleteness, completenessNote } from "../coverage.mjs";
import {
  seasonAt,
  seasonByKey,
  seasonCrossings,
} from "../../../ingest/src/season.mjs";

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
/** The population a segment tool scores (product call 5, 2026-09-18: a
 *  population is named, never assumed). The strings are sugar: "mine"
 *  is the caller's clan, "corpus" the whole recorded corpus said out
 *  loud; the object names one player, clan or collection. Omitted still
 *  answers the corpus and the response says so in a note. */
export const SEGMENT_SCHEMA = {
  description:
    "The population to score, REQUIRED (4.0.0): 'mine' (the caller's clan: the agent's clan, or the primary player's), 'corpus' (the whole recorded corpus, explicitly), or an object naming exactly one of player_tag, clan_tag (current members) or collection (a player collection's slug). The corpus is one population among others, never a default: a call without segment is refused.",
  anyOf: [
    { type: "string", enum: ["mine", "corpus"] },
    {
      type: "object",
      properties: {
        player_tag: { type: "string", description: "One recorded player." },
        clan_tag: {
          type: "string",
          description: "A recorded clan's current members.",
        },
        collection: {
          type: "string",
          description: "A player collection's slug.",
        },
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
      },
      additionalProperties: false,
    },
  ],
};

/**
 * The segment as one resolved thing, before any tool builds its own
 * predicate: `{ kind, echo, ... }` where kind is corpus, player,
 * clan or collection and the object carries the resolved tag, clan tag
 * or collection id. "mine" resolves through entitledClan(undefined), so
 * an account with no clan is no_subject, never a guess.
 */
export async function resolveSegment(ctx, args) {
  const raw = args.segment;
  // The population is named, never defaulted (product call 5; required
  // since 4.0.0, a note-and-corpus default from 3.16.0 to 3.18.0).
  if (raw === undefined || raw === null)
    throw new ToolFailure(
      "bad_request",
      "segment is required: name the population to score.",
      `Pass segment: "mine" (your clan), segment: "corpus" (the whole recorded corpus, on purpose) or an object naming one of player_tag, clan_tag or collection.`,
    );
  if (typeof raw === "string") {
    if (raw === "corpus") return { kind: "corpus", echo: { kind: "corpus" } };
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
      `segment must be 'mine', 'corpus' or an object naming one of player_tag, clan_tag, collection (got '${raw}').`,
    );
  }
  const seg = raw;
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
    return {
      kind: "collection",
      collectionId: rows[0].collection_id,
      slug,
      echo: { kind: "collection", collection: slug },
    };
  }
  // An empty object is the corpus, said with an object.
  return { kind: "corpus", echo: { kind: "corpus" } };
}

/** The recorded population a corpus number is drawn from (product call
 *  5): the active clan recordings and the players whose battle logs are
 *  recorded (directly, or as current members of a comprehensive clan),
 *  the same count elixir_data_insights serves. */
async function recordedPopulation(db) {
  const {
    rows: [r],
  } = await db.query(
    `with direct as (
       select subject_tag as player_tag from recording
       where subject_type = 'player' and status = 'active'),
     via as (
       select cm.player_tag
       from recording r
       join clan_membership cm on cm.clan_tag = r.subject_tag
         and cm.left_observed_at is null
       where r.subject_type = 'clan' and r.status = 'active'
         and r.scope = 'comprehensive')
     select (select count(*) from recording
              where subject_type = 'clan' and status = 'active')::int as recorded_clans,
            (select count(distinct player_tag) from
              (select player_tag from direct union select player_tag from via) u)::int as recorded_players`,
  );
  return {
    recorded_clans: r.recorded_clans,
    recorded_players: r.recorded_players,
  };
}

/** The population block a corpus read carries (3.16.0): whose
 *  neighbourhood the number describes. `playersInWindow` is the distinct
 *  players the read actually counted, null when the path cannot say. */
export async function populationBlock(db, { playersInWindow = null } = {}) {
  const pop = await recordedPopulation(db);
  return { ...pop, players_in_window: playersInWindow };
}

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
    "the seasonal trophies and the Path of Legends standing reset on the roll, so points on either side of it are not one series.",
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
 * (`seasonDefault: true`, review 2026-09-16, 1.1) default to the current
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
    const to = row.ends_at.getTime() > nowMs ? null : row.ends_at;
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
  { flavor = "series" } = {},
) {
  const fromMs = from ? new Date(from).getTime() : null;
  const endMs = to ? Math.min(new Date(to).getTime(), Date.now()) : Date.now();
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
  const endMs = toDay
    ? Math.min(Date.parse(`${toDay}T10:00:00Z`) + DAY_MS, nowMs)
    : nowMs;
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
  // meta.completeness_note fires for a player subject whose window ends
  // inside the last seven days (an unbounded window ends now) when the
  // newest profile interval reads under 0.9 or is unknown with a tail
  // over 48 hours (review 2026-09-19, defect 13: promised on every seam,
  // set by nothing).
  const recentWindow =
    windowTo === undefined ||
    windowTo === null ||
    Date.now() - new Date(windowTo).getTime() < 7 * 86_400_000;
  const completeness =
    isPlayer && recentWindow && /^#[0289PYLQGRJCUV]{3,12}$/.test(tag)
      ? completenessNote(tag, await recentCompleteness(db, tag))
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

/** Segment resolution shared by the meta, trends, synergy and badge
 *  tools: `args.segment` holds exactly one of player_tag / clan_tag /
 *  collection, or is absent = the whole recorded corpus (universal
 *  reads). Returns a WHERE fragment + params slice that scopes
 *  battle_participant rows to the segment's players, the time column
 *  whose leading index matches that scope, plus the echo. */
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
    return {
      where: `bp.player_tag in (select cm.player_tag from clan_membership cm
               where cm.clan_tag = $${params.length} and cm.left_observed_at is null)`,
      timeColumn: "bp.battle_time",
      label: seg.clanTag,
      echo: seg.echo,
    };
  }
  if (seg.kind === "collection") {
    params.push(seg.collectionId);
    return {
      where: `bp.player_tag in (select m.subject_tag from collection_member m
               where m.collection_id = $${params.length})`,
      timeColumn: "bp.battle_time",
      label: seg.slug,
      echo: seg.echo,
    };
  }
  return {
    where: null,
    // The participant carries battle_time (0001) and, since 0095,
    // type_class: a corpus window scan needs no join to battle unless a
    // mode filter asks for battle.type.
    timeColumn: "bp.battle_time",
    label: "corpus",
    echo: seg.echo,
  };
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
  // insufficient_sample and shrunk rates are withheld rather than
  // serving a number the sample cannot support.
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
export async function excludedBreakdown(
  db,
  where,
  params,
  { withPrior = false } = {},
) {
  // type and type_class are on the participant (0095, 0099); battle joins
  // in only when the caller's scope still names it (a mode filter).
  const battleJoin = where.some((w) => /\bb\./.test(w))
    ? "join battle b on b.battle_id = bp.battle_id"
    : "";
  const {
    rows: [r],
  } = await db.query(
    `select ${
      withPrior
        ? `count(*) filter (where bp.outcome in ('win','loss') and bp.type_class = 'pvp' and bp.deck_hash is not null)::int as prior_decided,
            count(*) filter (where bp.outcome = 'win' and bp.type_class = 'pvp' and bp.deck_hash is not null)::int as prior_wins,`
        : ""
    }
            count(*)::int as considered,
            count(*) filter (where coalesce(bp.type = any($${params.length + 1}), false))::int as duels,
            count(*) filter (where bp.type_class = 'boat'
                               and not coalesce(bp.type = any($${params.length + 1}), false))::int as boat,
            count(*) filter (where bp.outcome = 'draw' and bp.type_class = 'pvp'
                               and not coalesce(bp.type = any($${params.length + 1}), false))::int as draws,
            count(*) filter (where (bp.outcome is null or bp.outcome = 'unresolved')
                               and bp.type_class = 'pvp'
                               and not coalesce(bp.type = any($${params.length + 1}), false))::int as unresolved,
            count(*) filter (where bp.outcome in ('win','loss') and bp.type_class = 'pvp'
                               and not coalesce(bp.type = any($${params.length + 1}), false)
                               and bp.deck_hash is null)::int as no_deck
     from battle_participant bp ${battleJoin}
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
    ...(withPrior
      ? {
          prior: {
            decided: r.prior_decided,
            mean:
              r.prior_decided >= META_METHODOLOGY.segment_min_decided
                ? r.prior_wins / r.prior_decided
                : null,
          },
        }
      : {}),
  };
}

/** The corpus prior for shrinkage: decided head-to-head rate over the
 *  same window and mode, ignoring the segment. Null when the corpus
 *  window is below the floor (the caller substitutes 0.5). */
export async function corpusPrior(db, { from, to = null, types = null }) {
  // Its own parameter list: Postgres refuses a bound parameter it cannot
  // type, so the segment's params must not ride along unused.
  // One scalar over the window from the participant's own columns
  // (0095, 0099): battle_participant_window covers it, so this is an
  // index-only scan - no join to battle, mode filter or not.
  const params = [from];
  const where = ["bp.battle_time >= $1"];
  if (to) {
    params.push(to);
    where.push(`bp.battle_time < $${params.length}`);
  }
  if (types) {
    params.push(types);
    where.push(`bp.type = any($${params.length})`);
  }
  const {
    rows: [r],
  } = await db.query(
    `select count(*)::int as decided,
            count(*) filter (where bp.outcome = 'win')::int as wins
     from battle_participant bp
     where bp.outcome in ('win','loss') and bp.type_class = 'pvp'
       and bp.deck_hash is not null and ${where.join(" and ")}`,
    params,
  );
  return r.decided >= META_METHODOLOGY.segment_min_decided
    ? { decided: r.decided, mean: r.wins / r.decided }
    : { decided: r.decided, mean: null };
}

/**
 * Deck identities as rows (0091): the cards of each deck_hash, by form,
 * with the tower troop, from deck_card and deck rather than any
 * participant's JSON. Rendered the way deckCards always did - {id, name,
 * evolution?} - so the contract shape is unchanged; order is by card id
 * (an identity is a set; the old exemplar order was one player's slots).
 * Returns a Map deck_hash -> { cards, tower_troop? }.
 */
/**
 * The deck hashes whose played cards include ALL of `cardIds`, any form
 * (5.0.0, battles_meta_decks.containing): one indexed read of deck_card,
 * the tower troop excluded (it is on the deck row, not in deck_card).
 */
export async function decksContaining(db, cardIds) {
  const ids = [...new Set(cardIds.map(Number))];
  const { rows } = await db.query(
    `select deck_hash from deck_card
     where card_id = any($1)
     group by deck_hash having count(distinct card_id) = $2`,
    [ids, ids.length],
  );
  return new Set(rows.map((r) => r.deck_hash));
}

export async function deckIdentities(db, hashes) {
  const wanted = [...new Set(hashes.filter(Boolean))];
  if (wanted.length === 0) return new Map();
  const { rows } = await db.query(
    `select d.deck_hash, dc.card_id, dc.form, c.name,
            d.tower_troop_id, t.name as tower_name
     from deck d
     left join deck_card dc on dc.deck_hash = d.deck_hash
     left join card c on c.card_id = dc.card_id
     left join card t on t.card_id = d.tower_troop_id
     where d.deck_hash = any($1)
     order by d.deck_hash, dc.card_id, dc.form`,
    [wanted],
  );
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.deck_hash)) {
      out.set(r.deck_hash, {
        cards: [],
        ...(r.tower_troop_id === null
          ? {}
          : { tower_troop: { id: r.tower_troop_id, name: r.tower_name } }),
      });
    }
    if (r.card_id !== null)
      out.get(r.deck_hash).cards.push({
        id: r.card_id,
        name: r.name,
        form: formName(r.form),
      });
  }
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
            pc.level, pc.star_level, c.name
     from battle_participant_card pc
     join card c on c.card_id = pc.card_id
     where pc.battle_id = any($1)
     order by pc.battle_id, pc.player_tag, pc.round, pc.slot`,
    [ids],
  );
  const out = new Map();
  const card = (r) => ({
    id: r.card_id,
    name: r.name,
    level: r.level,
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
    if (r.round > 0) {
      while (deck.rounds.length < r.round) deck.rounds.push({ cards: [] });
      deck.rounds[r.round - 1].cards.push(card(r));
    } else if (r.slot === 0) {
      (deck.supportCards ??= []).push(card(r));
    } else {
      deck.cards.push(card(r));
    }
  }
  return out;
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

/** The fit of the population's decks against one player's collection
 *  (6.4.0, feedback #70: a corpus deck sorted by win rate reads as
 *  advice, and the payload carried nothing about what the caller holds,
 *  so an agent recommended a deck the player could not field - two
 *  rows ran a card he did not own, the top row cost him two mean
 *  levels). Jamie's call: recommendations come from the player's
 *  collection, and the agent must be free to say what a few upgrades
 *  would open - so a row carries what the player holds, what it would
 *  field at, and the upgrade path; a row with a card or form the player
 *  lacks leaves decks[] for unfieldable[]. The levels are the display
 *  scale on both sides (contracts displayLevel, the one conversion). */

/** What a player holds: card_id -> { level, forms }. An empty map means
 *  no collection is recorded. */
async function heldCards(db, tag) {
  const { rows } = await db.query(
    `select card_id, level, evolution_level, observed_at from player_card where player_tag = $1`,
    [tag],
  );
  const held = new Map();
  let asOf = null;
  for (const r of rows) {
    held.set(r.card_id, { level: r.level, forms: r.evolution_level ?? 0 });
    if (asOf === null || r.observed_at > asOf) asOf = r.observed_at;
  }
  return { held, as_of: asOf ? asOf.toISOString() : null };
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
  return {
    mean_level:
      r?.mean === null || r?.mean === undefined ? null : Number(r.mean),
    battles: r?.battles ?? 0,
  };
}

/** Resolve a fit_for argument to a tag with a recorded collection, or
 *  refuse: a fit against nothing would read as "owns nothing". */
export async function resolveFitFor(db, value) {
  let tag;
  try {
    tag = normalizeTag(String(value));
  } catch {
    throw new ToolFailure(
      "invalid_tag",
      `Invalid fit_for tag: ${value}`,
      TAG_RULE_HINT,
    );
  }
  const collection = await heldCards(db, tag);
  if (collection.held.size === 0)
    throw new ToolFailure(
      "not_recorded",
      `No collection recorded for ${tag}, so nothing to fit against.`,
      "The collection is read from the player's profile; players_profile({ live: true }) fetches one now, or omit fit_for for the population's decks alone.",
    );
  return { tag, ...collection };
}

/** One deck's cards against what the player holds: fieldable or not
 *  (missing names the card and why), the mean level the player would
 *  field it at, that against the level they have been fielding, and
 *  the upgrade path to the fielded level (what could be). */
export function deckFit(cards, held, fielded) {
  const missing = [];
  const levels = [];
  const upgrades = [];
  const target = fielded === null ? null : Math.round(fielded);
  for (const c of cards) {
    const h = held.get(c.id);
    const bit = CARD_FORM_BITS[c.form] ?? 0;
    if (!h) {
      missing.push({
        id: c.id,
        name: c.name,
        form: c.form,
        reason: "not_owned",
      });
      continue;
    }
    if (bit !== 0 && (h.forms & bit) === 0)
      missing.push({
        id: c.id,
        name: c.name,
        form: c.form,
        reason: "form_not_unlocked",
      });
    if (h.level !== null) {
      levels.push(h.level);
      if (target !== null && h.level < target)
        upgrades.push({
          id: c.id,
          name: c.name,
          form: c.form,
          held_level: h.level,
          to_level: target,
          levels: target - h.level,
        });
    }
  }
  upgrades.sort((a, z) => z.levels - a.levels || a.id - z.id);
  const mean = (xs) =>
    xs.length
      ? Number((xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(3))
      : null;
  const ownMean = missing.some((m) => m.reason === "not_owned")
    ? null
    : mean(levels);
  return {
    fieldable: missing.length === 0,
    missing,
    own_mean_level: ownMean,
    vs_fielded:
      ownMean === null || fielded === null
        ? null
        : Number((ownMean - fielded).toFixed(3)),
    upgrades,
    mean_level_after_upgrades:
      ownMean === null || target === null
        ? null
        : mean(levels.map((l) => Math.max(l, target))),
  };
}

/** What a player holds of one card, for a card row: null when unowned. */
export function heldCard(held, cardId, form) {
  const h = held.get(cardId);
  if (!h) return null;
  const bit = CARD_FORM_BITS[form] ?? 0;
  return {
    level: h.level,
    forms_unlocked: cardForms(h.forms),
    has_form: bit === 0 || (h.forms & bit) !== 0,
  };
}
