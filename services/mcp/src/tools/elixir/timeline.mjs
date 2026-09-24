import { normalizeTag, responseMeta } from "@elixir-mcp/contracts";
import {
  ITEM_KINDS,
  buildTimeline,
  subjectsFor,
} from "../../activity/entries.mjs";
import { resolveInstant } from "../../time.mjs";
import {
  TAG_RULE_HINT,
  ToolFailure,
  VERBOSITY,
  WINDOW_ARGS,
  WINDOW_OBSERVED_FROM_DESC,
  WINDOW_OBSERVED_TO_DESC,
  appliedBlock,
  notes,
  seasonFieldsForInstants,
  withWindowSugar,
  zoneFor,
} from "../shared.mjs";
import { FEED_DOCS } from "./common.mjs";

/** When the profile-derived moment ledger begins (Gym #121). */
const PROFILE_MOMENTS_FROM_MS = Date.parse("2026-09-14T04:27:51Z");

/** Characters a timeline page may spend on entries and items, under the
 *  48,000-character result cap with room for notes, applied and meta. */
const PAGE_CHAR_BUDGET = 40_000;

export const elixir_timeline = {
  description:
    "Your timeline: what happened to the players and clans you track since your read pointer, as ITEMS newest first plus one summary ENTRY per subject (a person's: the players and clans they track; an agent's: its clan). Items are named moments with an instant: battle sessions, badges, arena and ranked moves, new bests, cards unlocked, joins, departures, role changes, war milestones, quiet rungs, returns. Facts, never advice; nothing announces the time (game_clock does). Omit from to read from your pointer (none: 24 hours; cap 30 days); mark_read moves it to the window end, false is a dry run.",
  inputSchema: {
    type: "object",
    properties: {
      ...WINDOW_ARGS,
      // The timeline selects by when the record OBSERVED an item, over
      // (from, to] at the millisecond it serves (7.1.5, Gym #273).
      from: { type: "string", description: WINDOW_OBSERVED_FROM_DESC },
      to: { type: "string", description: WINDOW_OBSERVED_TO_DESC },
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
      player_tag: {
        type: "string",
        maxLength: 16,
        description:
          "Keep only items about this player (7.1.5): their own moments and sessions and, on a clan's timeline, their member moments and sessions. Applied before the item cap; entries are untouched, and a member read never moves the read pointer.",
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

    // One member's items (Gym #253: "anything new with me?" read the
    // whole clan feed, where the cap left 18 of that member's items).
    let memberTag = null;
    if (args.player_tag !== undefined) {
      try {
        memberTag = normalizeTag(String(args.player_tag));
      } catch {
        throw new ToolFailure(
          "invalid_tag",
          `Invalid tag: ${args.player_tag}`,
          TAG_RULE_HINT,
        );
      }
    }
    const aboutMember = (it) =>
      !memberTag ||
      it.subject_tag === memberTag ||
      it.facts?.player_tag === memberTag;
    const subjects = await subjectsFor(ctx.db, ctx.account.accountId);
    const built = await buildTimeline(ctx.db, subjects, {
      fromMs,
      toMs,
      timezone: tz,
      accountId: ctx.account.accountId,
      memberTag,
      filter: (it) =>
        (!sections || sections.includes(it.section)) &&
        (!kinds || kinds.includes(it.kind)) &&
        aboutMember(it),
    });
    // A member session the window cuts recurs in the next read (Gym
    // #302); a read that holds each sitting whole says nothing.
    const sittingCut =
      Boolean(memberTag) &&
      built.timeline.some(
        (it) =>
          it.kind === "battle_session" &&
          (it.facts?.open ||
            Date.parse(it.facts?.started_at ?? it.at) < fromMs),
      );
    const keep = (entry) => {
      if (!compact && !sections) return entry;
      const allowed = new Set([...ALWAYS, ...(compact ? [] : sections)]);
      return Object.fromEntries(
        Object.entries(entry).filter(([k]) => allowed.has(k)),
      );
    };
    const entries = built.entries.map(keep);
    const shown = (it) =>
      (!sections || sections.includes(it.section)) &&
      (!kinds || kinds.includes(it.kind)) &&
      aboutMember(it);
    // The timeline is a newsfeed (Jamie, 2026-09-23; contract 7.0.0):
    // newest first, and a window past the cap keeps its NEWEST items and
    // counts the rest rather than paging them, so a reader catching up
    // lands on the present. A window SELECTS by when the record observed
    // an item (observed_at, in (from, to]), so the cut is on that instant
    // too (Gym #120, #162): the response holds what was observed after
    // the newest item left out, and every older item is counted in
    // timeline_more. A reader that wants them asks for them by window:
    // the same from, with to at that instant.
    const droppedShown = (built.timeline_dropped ?? []).filter(shown);
    const observedMs = (it) => Date.parse(it.observed_at ?? it.at);
    const all = built.timeline.filter(shown);
    // A response also fits the result cap (6.34.2): items are taken from
    // the most recently observed back until the characters reach the
    // budget, and the cut falls on the first item that would not fit.
    // A count alone could not promise it: a standout carries the whole
    // session shape, and 7 days of them ran past 48,000.
    const entriesChars = JSON.stringify(entries).length;
    let used = entriesChars;
    let sizeCutMs = null;
    const byObserved = [...all].sort((a, b) => observedMs(b) - observedMs(a));
    for (const [i, it] of byObserved.entries()) {
      used += JSON.stringify(it).length + 1;
      if (used > PAGE_CHAR_BUDGET) {
        // Every response keeps at least its newest item, or one whose
        // entries alone fill the budget would serve nothing.
        const at =
          i === 0 ? byObserved.find((x) => observedMs(x) < observedMs(it)) : it;
        sizeCutMs = at ? observedMs(at) : null;
        break;
      }
    }
    const newestLeftOut = Math.max(
      ...droppedShown.map(observedMs),
      sizeCutMs ?? -Infinity,
    );
    const cutMs = Number.isFinite(newestLeftOut) ? newestLeftOut : null;
    const timeline =
      cutMs === null ? all : all.filter((it) => observedMs(it) > cutMs);
    const remaining =
      cutMs === null ? 0 : all.length - timeline.length + droppedShown.length;
    // The read always reaches the window's end: what the cap left out is
    // counted, not queued.
    const endMs = toMs;
    // How late the record learned this page's items, for the widen advice.
    const lagHours = Math.ceil(
      Math.max(0, ...timeline.map((it) => observedMs(it) - Date.parse(it.at))) /
        3_600_000,
    );

    // A member read never moves the pointer: it served one member's items
    // and would carry the reader past everything it filtered out (Gym
    // #271: 73 items skipped, three of them clan moments).
    const marking = args.mark_read !== false && !memberTag;
    // The pointer only moves forward; read_to reports the one STORED (Gym
    // #251: a past `to` echoed a move that never happened).
    let storedMs = null;
    if (marking && reader) {
      const { rows: stored } = await ctx.db.query(
        `insert into timeline_reader (account_id, reader, read_to)
           values ($1, $2, to_timestamp($3 / 1000.0))
           on conflict (account_id, reader) do update set
             read_to = greatest(timeline_reader.read_to, excluded.read_to),
             updated_at = now()
         returning read_to`,
        [ctx.account.accountId, reader, endMs],
      );
      storedMs = stored[0]?.read_to?.getTime() ?? null;
    } else if (marking) {
      const { rows: stored } = await ctx.db.query(
        `update account
              set activity_seen_at = greatest(coalesce(activity_seen_at, 'epoch'::timestamptz),
                                              to_timestamp($2 / 1000.0))
            where account_id = $1
          returning activity_seen_at`,
        [ctx.account.accountId, endMs],
      );
      storedMs = stored[0]?.activity_seen_at?.getTime() ?? null;
    }
    const pointerKept = marking && storedMs !== null && storedMs > endMs;
    const iso = (ms) => (ms === null ? null : new Date(ms).toISOString());
    // The war ledger's own start (Gym #215): war moments and the clan
    // entry's war.resolved begin with the first war event on record, so
    // an earlier window read "no week resolved" over five closed weeks.
    const clanTags = subjects
      .filter((sub) => sub.kind === "clan")
      .map((sub) => sub.tag);
    // A player_tag the reader follows neither as a player nor as a member
    // of its clans reads 0 items by construction; say so (Gym #258).
    let memberNote = null;
    if (memberTag && !subjects.some((sub) => sub.tag === memberTag)) {
      const { rows: inClan } = clanTags.length
        ? await ctx.db.query(
            `select 1 from clan_membership
              where player_tag = $1 and clan_tag = any($2::text[])
                and joined_observed_at <= to_timestamp($3 / 1000.0)
                and (left_observed_at is null or left_observed_at > to_timestamp($4 / 1000.0))
              limit 1`,
            [memberTag, clanTags, toMs, fromMs],
          )
        : { rows: [] };
      if (!inClan.length)
        memberNote = `player_tag ${memberTag} is not a member of this reader's clans in this window, nor one of its players, so no item is about it; elixir_track_player records a player, and players_timeline reads anyone's daily series.`;
    }
    const {
      rows: [warLedger],
    } = clanTags.length
      ? await ctx.db.query(
          `select min(window_end) as first from clan_event
            where clan_tag = any($1::text[])
              and event_type in ('bracket_observed', 'race_finished', 'week_resolved')`,
          [clanTags],
        )
      : { rows: [null] };
    const warLedgerFromMs = warLedger?.first ? warLedger.first.getTime() : null;
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
        ...(memberTag ? { player_tag: memberTag } : {}),
        ...(sections ? { sections } : {}),
        ...(kinds ? { kinds } : {}),
        verbosity: compact ? "compact" : "full",
      }),
      window: built.window,
      read_to: marking ? iso(storedMs ?? endMs) : iso(pointerMs),
      timeline,
      timeline_more: remaining,
      entries,
      quiet: built.quiet,
      subjects: subjects.length,
      next_cursor: iso(endMs),
      has_more: cutMs !== null,
      notes: notes(
        seasonFields.seasonNotes,
        entries.length === 0 && built.quiet.length === 0
          ? "No subjects: track a player or clan (notify defaults on) and it appears here."
          : "timeline is newest first, a newsfeed: named moments with an instant, each with text a person can read; entries summarize the same window per subject. Nothing here is advice, and nothing announces the time: schedule from game_clock.",
        built.quiet.length > 0
          ? "quiet lists tracked players with nothing in the window; read days_since_poll beside days_quiet before calling the silence theirs."
          : null,
        capped
          ? "The window was capped at 30 days before to; pass from and to for older history, or use the data tools."
          : null,
        // The moment ledger's own history (Gym #121): profile-derived
        // moments begin 2026-09-14T04:27Z, and collection_level_step
        // follows its step rule from 2026-09-18.
        warLedgerFromMs !== null && fromMs < warLedgerFromMs
          ? `War moments (bracket_observed, race_finished, week_resolved) and a clan entry's war.resolved are recorded from ${iso(warLedgerFromMs)}: a window before that has none of them, which is the ledger's start, not weeks without a result. war_history has every recorded week.`
          : null,
        fromMs < PROFILE_MOMENTS_FROM_MS
          ? "Profile-derived moments (badges, collection level, new bests, cards unlocked, arena and ranked moves) are recorded from 2026-09-14T04:27Z: a window before that has none of them, which is the ledger's start, not a quiet week. collection_level_step items before 2026-09-18 predate the step rule and carry no facts.step."
          : null,
        timeline.some((it) => Date.parse(it.at) < fromMs)
          ? `A window selects moments by when the record OBSERVED them and dates each at when it HAPPENED (at): ${timeline.filter((it) => Date.parse(it.at) < fromMs).length} item(s) here happened before from, and a moment that happened in this window but was observed after to is in the next one. For "what happened on a day", widen to by the record's lag (the longest here is ${lagHours} h, observed_at minus at) and filter on at.`
          : null,
        entries.some(
          (e) =>
            e.activity?.played_here_learned_later > 0 ||
            e.activity?.learned_here_played_before > 0,
        )
          ? `A clan entry's activity counts the battles the record LEARNED in this window, which is not the same as the battles PLAYED in it: activity.learned_here_played_before counts ones played in the day before from and recorded here (counted), activity.played_here_learned_later ones played here and recorded after to (not counted) (${entries
              .filter(
                (e) =>
                  e.activity?.played_here_learned_later > 0 ||
                  e.activity?.learned_here_played_before > 0,
              )
              .map(
                (e) =>
                  `${e.name ?? e.subject_tag}: ${e.activity.learned_here_played_before} and ${e.activity.played_here_learned_later}`,
              )
              .join(
                "; ",
              )}), and late_captures counts battles learned here more than a day after play. For what was played in a window, read clans_standings, which counts by play time.`
          : null,
        memberNote,
        memberTag && !memberNote
          ? `A member read: the items are ${memberTag}'s sessions and moments on the timelines this reader follows. battles_query and battles_performance read that player's battles in full.${sittingCut ? " A member read keeps no pointer, and a sitting here is cut by the window (still open at its end, or begun before its start): the next read that learns more of it serves it again under the same started_at with a running total. Keep the newest item per started_at (Gym #302)." : ""}`
          : null,
        pointerKept
          ? `The read pointer stays at ${iso(storedMs)}: it only moves forward, and this window ends before it (read_to reports it). Pass mark_read false to read a past window without asking to move it.`
          : null,
        cutMs !== null
          ? `A busy window: timeline holds the newest items, those the record observed after ${iso(cutMs)}, and timeline_more (${remaining}) older ones are counted, not served; has_more is true. The entries still summarize the whole window. next_cursor is the window's end${marking ? " and the read pointer moved to it" : ""}, so the next read continues from the present; to read the older items, pass the same from with to ${iso(cutMs)}${marking ? " and mark_read false" : ""}.`
          : "Pass next_cursor as from to continue from here without moving the pointer.",
      ),
      docs: FEED_DOCS,
      meta: responseMeta({
        as_of: new Date().toISOString(),
        timezone_applied: tz,
      }),
    };
  },
};
