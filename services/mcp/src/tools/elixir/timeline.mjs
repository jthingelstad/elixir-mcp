import { responseMeta } from "@elixir-mcp/contracts";
import {
  ITEM_KINDS,
  buildTimeline,
  subjectsFor,
} from "../../activity/entries.mjs";
import { resolveInstant } from "../../time.mjs";
import {
  ToolFailure,
  VERBOSITY,
  WINDOW_ARGS,
  appliedBlock,
  notes,
  seasonFieldsForInstants,
  withWindowSugar,
  zoneFor,
} from "../shared.mjs";
import { FEED_DOCS } from "./common.mjs";

export const elixir_timeline = {
  description:
    "Your timeline: what happened to the players and clans you track since your read pointer, as ITEMS in order plus one summary ENTRY per subject (a person's: the players and clans they track; an agent's: its clan). Items are named moments with an instant: battle sessions, badges, arena and ranked moves, new bests, cards unlocked, joins, departures, role changes, war milestones, quiet rungs, returns. Facts, never advice; nothing announces the time (game_clock does). Omit from to read from your pointer (none: 24 hours; cap 30 days); mark_read moves it to the window end, false is a dry run.",
  inputSchema: {
    type: "object",
    properties: {
      ...WINDOW_ARGS,
      mark_read: {
        type: "boolean",
        default: true,
        description:
          "Move the read pointer (the reader's, or the account's) to this window's end; false is a dry run that keeps it.",
      },
      reader: {
        type: "string",
        pattern: "^[a-z0-9][a-z0-9-]{0,31}$",
        description:
          "A name for THIS consumer's read pointer (3.18.0): omit from to read since it, mark_read moves it and read_to reports it; other readers on the same account keep theirs, and the account's unnamed pointer is untouched. meta.timeline_pending counts against the oldest named pointer. Lowercase letters, digits and hyphens, up to 32.",
      },
      sections: {
        type: "array",
        items: { type: "string" },
        maxItems: 16,
        description:
          "Keep only items and entry sections in these sections; the summary, subject, window and player notables always stay. Player sections: battles, trophies, arena, ranked, collection, badges, clan, war, presence. Clan sections: activity, roster, war, presence, standouts, donations. Plus account.",
      },
      kinds: {
        type: "array",
        items: { type: "string" },
        maxItems: 32,
        description:
          "Keep only timeline items of these kinds (entries are untouched): battle_session, session_standout, badge_earned, legendary_badge_earned, arena_changed, ranked_promotion, best_trophies_band, collection_level_step, career_wins_step, card_unlocked, clan_joined, clan_left, member_joined, member_left, member_role_changed, bracket_observed, race_finished, week_resolved, quiet_crossed, returned, or an account_* kind. A consumer that wakes on a few kinds reads only those.",
      },
      verbosity: VERBOSITY(
        "the timeline items and each entry's summary, subject, window and player notables; every entry section, including clan standouts, is dropped.",
      ),
    },
    additionalProperties: false,
  },
  async handler(ctx, rawArgs) {
    const args = withWindowSugar(rawArgs);
    const tz = zoneFor(ctx, args) ?? "UTC";
    const DAY_MS = 86_400_000;
    const CAP_MS = 30 * DAY_MS;
    const reader =
      args.reader === undefined ? null : String(args.reader).trim();
    if (reader !== null && !/^[a-z0-9][a-z0-9-]{0,31}$/.test(reader))
      throw new ToolFailure(
        "bad_request",
        `reader must match ^[a-z0-9][a-z0-9-]{0,31}$ (got '${reader}').`,
        "A short lowercase name for this consumer, e.g. editor or poap-kings-discord.",
      );
    const { rows: acct } = reader
      ? await ctx.db.query(
          `select read_to as activity_seen_at from timeline_reader
              where account_id = $1 and reader = $2`,
          [ctx.account.accountId, reader],
        )
      : await ctx.db.query(
          `select activity_seen_at from account where account_id = $1`,
          [ctx.account.accountId],
        );
    const pointerMs = acct[0]?.activity_seen_at
      ? acct[0].activity_seen_at.getTime()
      : null;
    let toMs = Date.now();
    if (args.to !== undefined) {
      const parsed = resolveInstant(tz, args.to, { endOfDay: true });
      if (!parsed)
        throw new ToolFailure(
          "bad_request",
          `Could not read 'to' (${args.to}).`,
          "Use an ISO instant or YYYY-MM-DD.",
        );
      toMs = Math.min(parsed.getTime(), Date.now());
    }
    let fromMs;
    let source;
    if (args.from !== undefined) {
      const parsed = resolveInstant(tz, args.from);
      if (!parsed)
        throw new ToolFailure(
          "bad_request",
          `Could not read 'from' (${args.from}).`,
          "Use an ISO instant or YYYY-MM-DD.",
        );
      fromMs = parsed.getTime();
      source = "argument";
    } else if (pointerMs !== null) {
      fromMs = pointerMs;
      source = "pointer";
    } else {
      fromMs = toMs - DAY_MS;
      source = "default";
    }
    let capped = false;
    if (toMs - fromMs > CAP_MS) {
      fromMs = toMs - CAP_MS;
      capped = true;
    }
    if (fromMs >= toMs)
      throw new ToolFailure(
        "bad_request",
        "from must be before to.",
        "Pass a from earlier than to, or omit both for the window since your read pointer.",
      );

    const PLAYER_SECTIONS = [
      "battles",
      "trophies",
      "arena",
      "ranked",
      "collection",
      "badges",
      "clan",
      "war",
      "presence",
    ];
    const CLAN_SECTIONS = [
      "activity",
      "roster",
      "war",
      "presence",
      "standouts",
      "donations",
    ];
    const ALWAYS = [
      "kind",
      "subject_tag",
      "name",
      "nickname",
      "relationship",
      "scope",
      "window",
      "summary",
      "notables",
    ];
    const sections =
      Array.isArray(args.sections) && args.sections.length > 0
        ? args.sections.map(String)
        : null;
    const unknown = sections?.find(
      (k) =>
        k !== "account" &&
        !PLAYER_SECTIONS.includes(k) &&
        !CLAN_SECTIONS.includes(k),
    );
    if (unknown)
      throw new ToolFailure(
        "bad_request",
        `Unknown section '${unknown}'.`,
        `Player sections: ${PLAYER_SECTIONS.join(", ")}. Clan sections: ${CLAN_SECTIONS.join(", ")}. Plus account.`,
      );
    const kinds =
      Array.isArray(args.kinds) && args.kinds.length > 0
        ? args.kinds.map(String)
        : null;
    const unknownKind = kinds?.find(
      (k) => !ITEM_KINDS.includes(k) && !k.startsWith("account_"),
    );
    if (unknownKind)
      throw new ToolFailure(
        "bad_request",
        `Unknown kind '${unknownKind}'.`,
        `Kinds: ${ITEM_KINDS.join(", ")}, or an account_* kind.`,
      );
    const compact = args.verbosity === "compact";

    const subjects = await subjectsFor(ctx.db, ctx.account.accountId);
    const built = await buildTimeline(ctx.db, subjects, {
      fromMs,
      toMs,
      timezone: tz,
      accountId: ctx.account.accountId,
    });
    const keep = (entry) => {
      if (!compact && !sections) return entry;
      const allowed = new Set([...ALWAYS, ...(compact ? [] : sections)]);
      return Object.fromEntries(
        Object.entries(entry).filter(([k]) => allowed.has(k)),
      );
    };
    const entries = built.entries.map(keep);
    const timeline = built.timeline.filter(
      (it) =>
        (!sections || sections.includes(it.section)) &&
        (!kinds || kinds.includes(it.kind)),
    );

    const marking = args.mark_read !== false;
    if (marking && reader) {
      await ctx.db.query(
        `insert into timeline_reader (account_id, reader, read_to)
           values ($1, $2, to_timestamp($3 / 1000.0))
           on conflict (account_id, reader) do update set
             read_to = greatest(timeline_reader.read_to, excluded.read_to),
             updated_at = now()`,
        [ctx.account.accountId, reader, toMs],
      );
    } else if (marking) {
      await ctx.db.query(
        `update account
              set activity_seen_at = greatest(coalesce(activity_seen_at, 'epoch'::timestamptz),
                                              to_timestamp($2 / 1000.0))
            where account_id = $1`,
        [ctx.account.accountId, toMs],
      );
    }
    const iso = (ms) => (ms === null ? null : new Date(ms).toISOString());
    const seasonFields = await seasonFieldsForInstants(ctx.db, fromMs, toMs, {
      flavor: "plain",
    });
    return {
      applied: appliedBlock({
        window: {
          from: iso(fromMs),
          to: iso(toMs),
          source,
          ...seasonFields.echo,
        },
        mark_read: marking,
        ...(reader ? { reader } : {}),
        ...(sections ? { sections } : {}),
        ...(kinds ? { kinds } : {}),
        verbosity: compact ? "compact" : "full",
      }),
      window: built.window,
      read_to: marking ? iso(toMs) : iso(pointerMs),
      timeline,
      timeline_more: built.timeline_more,
      entries,
      quiet: built.quiet,
      subjects: subjects.length,
      next_cursor: iso(toMs),
      has_more: false,
      notes: notes(
        seasonFields.seasonNotes,
        entries.length === 0 && built.quiet.length === 0
          ? "No subjects: track a player or clan (notify defaults on) and it appears here."
          : "timeline is oldest first: named moments with an instant, each with text a person can read; entries summarize the same window per subject. Nothing here is advice, and nothing announces the time: schedule from game_clock.",
        built.quiet.length > 0
          ? "quiet lists tracked players with nothing in the window; read days_since_poll beside days_quiet before calling the silence theirs."
          : null,
        capped
          ? "The window was capped at 30 days before to; pass from and to for older history, or use the data tools."
          : null,
        built.timeline_more > 0
          ? `timeline_more: ${built.timeline_more} items beyond the cap were left out; narrow the window or the sections.`
          : null,
        "Pass next_cursor as from to continue from here without moving the pointer.",
      ),
      docs: FEED_DOCS,
      meta: responseMeta({
        as_of: new Date().toISOString(),
        timezone_applied: tz,
      }),
    };
  },
};
