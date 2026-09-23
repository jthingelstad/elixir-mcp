import { normalizeTag, responseMeta } from "@elixir-mcp/contracts";
import {
  TAG_RULE_HINT,
  ToolFailure,
  appliedBlock,
  entitledClan,
  notes,
} from "../shared.mjs";
import { CLAN_SCORE_DEPRECATION, WAR_DOCS, warTrophyAlias } from "./common.mjs";

export const war_rivals = {
  description:
    "The Scouting Report: observed war history for rival clans. Every recorded river race captures all five bracket clans, so rivals accumulate fingerprints across every race they shared with a recorded clan. Defaults to your clan's current bracket. Pure aggregation of stored observations: races seen, fame record, zero-fame races, seasons spanned.",
  inputSchema: {
    type: "object",
    properties: {
      clan_tag: {
        type: "string",
        description:
          "Your clan (the anchor whose bracket is meant). Omit for your recorded clan.",
      },
      rival_tags: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 10,
        description: "Specific rival clans; omit for the current bracket.",
      },
    },
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const clanTag = await entitledClan(ctx.db, ctx.account, args.clan_tag);
    let rivals = [];
    if (args.rival_tags?.length) {
      for (const raw of args.rival_tags) {
        try {
          rivals.push(normalizeTag(String(raw)));
        } catch {
          throw new ToolFailure(
            "invalid_tag",
            `Invalid clan tag: ${raw}`,
            TAG_RULE_HINT,
          );
        }
      }
    } else {
      const { rows } = await ctx.db.query(
        `select participant_clan_tag from war_week_clan
           where clan_tag = $1 and participant_clan_tag <> $1
             and (season_id, section_index) = (
               select season_id, section_index from war_week
               where clan_tag = $1
               order by season_id desc, section_index desc limit 1)`,
        [clanTag],
      );
      rivals = rows.map((r) => r.participant_clan_tag);
      if (rivals.length === 0)
        throw new ToolFailure(
          "not_recorded",
          "No bracket recorded for this clan yet.",
        );
    }
    // Observer-scoped duplication is by design in the war tables; rival
    // stats dedupe on (season, section, rival) BEFORE aggregating so a
    // race two recorded clans both saw counts once (META-INTEL §10).
    const { rows } = await ctx.db.query(
      `with latest as (
           select season_id, section_index from war_week
           where clan_tag = $1
           order by season_id desc, section_index desc limit 1),
         races as (
           select w.participant_clan_tag, w.season_id, w.section_index,
                  max(w.fame) as fame,
                  max(w.participant_name) as name,
                  bool_or(w.clan_tag = $1) as shared_with_you,
                  bool_or(wk.is_colosseum) as is_colosseum,
                  (w.season_id, w.section_index) = (select season_id, section_index from latest)
                    and bool_and(wk.finished_observed_at is null)
                    as in_progress
           from war_week_clan w
           join war_week wk on wk.clan_tag = w.clan_tag and wk.season_id = w.season_id
             and wk.section_index = w.section_index
           where w.participant_clan_tag = any($2)
           group by w.participant_clan_tag, w.season_id, w.section_index)
         select participant_clan_tag as clan_tag,
                max(name) as name,
                count(*)::int as races_observed,
                count(*) filter (where not in_progress)::int as finished_races,
                count(*) filter (where is_colosseum)::int as colosseum_races,
                count(*) filter (where shared_with_you)::int as races_shared_with_you,
                min(season_id)::int as first_season,
                max(season_id)::int as last_season,
                round(avg(fame) filter (where not in_progress))::int as mean_fame,
                round(percentile_cont(0.5) within group (order by fame)
                  filter (where not in_progress))::int as median_fame,
                max(fame) filter (where not in_progress)::int as max_fame,
                count(*) filter (where fame = 0 and not in_progress)::int as zero_fame_races,
                max(fame) filter (where in_progress)::int as current_race_fame,
                (select w.clan_score from war_week_clan w
                  where w.participant_clan_tag = races.participant_clan_tag
                    and w.clan_score is not null
                  order by w.season_id desc, w.section_index desc limit 1) as clan_score
         from races group by participant_clan_tag
         order by mean_fame desc nulls last`,
      [clanTag, rivals],
    );
    return {
      clan_tag: clanTag,
      applied: appliedBlock({
        clan_tag: clanTag,
        rival_tags: rivals,
        source: args.rival_tags?.length ? "argument" : "current_bracket",
      }),
      rivals: rows.map((r) => ({ ...r, ...warTrophyAlias(r) })),
      notes: notes(
        "races_observed counts our sightings in races shared with recorded clans, not the rival's full history; a race seen by two recorded clans counts once.",
        "Fame statistics (mean_fame, median_fame, max_fame, zero_fame_races) cover the finished races only, and finished_races is their count: races_observed includes the week in progress, so it is not their denominator. current_race_fame is the week in progress; a rival with no finished race has null fame statistics, not zero. mean_fame and median_fame are ROUNDED to whole fame, so recomputing them from the standings can differ by half a point (0 and 4059 give 2030, not 2029.5).",
        rows.some((r) => r.colosseum_races > 0)
          ? "colosseum_races counts the Colosseum weeks among races_observed: a Colosseum week is a period-point contest with no finish line, so its fame pools badly with a regular week's; read the fame statistics beside that count."
          : null,
        "clan_war_trophies is the clan's WAR trophies as last observed in any recorded race (null before 2026-09-17, when the race poll began keeping it).",
        CLAN_SCORE_DEPRECATION,
        "A rival's roster and war state are not recorded; war_current({ clan_tag, live: true }) asks for a fresh read (queued if none is in hand).",
      ),
      docs: WAR_DOCS,
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};
