/** What Elixir's record says about a clan and some of its members, for
 *  the clan's own model (`clanContext`, `memberLines` in the engine's
 *  `context.mjs`): the leaders' drafts and the activity posts in the
 *  clan's Discord (Jamie, 2026-10-11: "pull in the variety of data
 *  elixir has").
 *
 *  Recorded facts only, read as a member of the clan reads them: the
 *  clan's name, member count and last finished war weeks (place and war
 *  trophies); a member's latest profile (trophies, best, arena, career
 *  wins, collection level), time in the clan and earlier stints, their
 *  war weeks as decks used and points (never fame: a member earns
 *  points, the boat earns fame), the clan's awards they hold as the
 *  clan announced them (`award_granted`, this season and last), and
 *  their recent milestones in the timeline. Nothing private to Clan
 *  (notes, holds, rationale, a grant not yet announced) is read here. A
 *  fact the record lacks is absent, never filled in. */
import {
  buildTimeline,
  factItems,
  isPublishable,
} from "@elixir-mcp/tools/activity/entries";
import { activityCategory } from "@elixir-mcp/clan-engine";
import { seasonFromDate } from "@elixir-mcp/record/war-clock";

const DAY_MS = 24 * 3600_000;
/** Finished war weeks told: the clan's and each member's. */
const STORY_WEEKS = 4;
/** How far back a member's moments are read, and how many are kept. */
const MOMENT_DAYS = 14;
const MOMENTS_MAX = 5;
/** Announced awards told per member, newest season first. */
const AWARDS_MAX = 6;

const iso = (d) => (d instanceof Date ? d.toISOString() : (d ?? null));
const int = (x) => (x == null ? null : Number(x));

/**
 * @param {import("pg").ClientBase} db
 * @param {string} clanTag
 * @param {{ playerTags?: string[], nowMs?: number,
 *   moments?: boolean | { max?: number, members?: number, except?: string[] } }} [opts]
 *   `moments`: read each member's recent milestones from the timeline.
 *   `true` for a leader's draft (one member, five moments); the Discord
 *   run bounds it (`max` moments each, for the first `members` members,
 *   one timeline read per member inside the sync's time budget) and
 *   leaves out the items it is posting (`except`, by id).
 * @returns {Promise<{ clan: object|null, members: Record<string, object> }>}
 */
export async function clanStoryFacts(
  db,
  clanTag,
  { playerTags = [], nowMs = Date.now(), moments = false } = {},
) {
  const tags = [...new Set(playerTags.filter(Boolean))];
  const {
    rows: [clan],
  } = await db.query(
    `select c.name,
            (select s.members from clan_snapshot_daily s
              where s.clan_tag = c.clan_tag and s.members is not null
              order by s.day desc, s.observed_at desc limit 1) as snapshot_members,
            (select count(*) from clan_membership m
              where m.clan_tag = c.clan_tag and m.left_observed_at is null) as members
       from clan c where c.clan_tag = $1`,
    [clanTag],
  );
  const { rows: weeks } = await db.query(
    `select w.season_id, w.section_index, w.is_colosseum,
            own.rank, own.trophy_change
       from war_week w
       join war_week_clan own on own.clan_tag = w.clan_tag
        and own.season_id = w.season_id and own.section_index = w.section_index
        and own.participant_clan_tag = w.clan_tag
      where w.clan_tag = $1 and own.rank is not null
      order by w.season_id desc, w.section_index desc
      limit $2`,
    [clanTag, STORY_WEEKS],
  );
  const members = {};
  if (tags.length) {
    const { rows } = await db.query(
      `select p.player_tag, p.name, cm.role, cm.joined_observed_at,
              cm.left_observed_at, coalesce(cm.baseline, false) as baseline,
              (select count(*) from clan_membership x
                where x.clan_tag = $1 and x.player_tag = p.player_tag
                  and x.joined_observed_at < cm.joined_observed_at) as stints_before,
              (select max(x.left_observed_at) from clan_membership x
                where x.clan_tag = $1 and x.player_tag = p.player_tag
                  and x.joined_observed_at < cm.joined_observed_at) as last_left_at,
              s.trophies, s.best_trophies, s.wins as career_wins,
              s.collection_level, a.name as arena
         from player p
         left join lateral (
           select * from clan_membership m
            where m.clan_tag = $1 and m.player_tag = p.player_tag
            order by m.joined_observed_at desc limit 1) cm on true
         left join lateral (
           select * from player_snapshot_daily d
            where d.player_tag = p.player_tag and d.profile_observed_at is not null
            order by d.snapshot_date desc, d.profile_observed_at desc limit 1) s on true
         left join arena a on a.arena_id = s.arena_id
        where p.player_tag = any($2::text[])`,
      [clanTag, tags],
    );
    for (const r of rows) {
      const joined = r.joined_observed_at;
      const end = r.left_observed_at ?? new Date(nowMs);
      members[r.player_tag] = {
        name: r.name ?? null,
        // A role only while they are in the clan.
        role: r.left_observed_at ? null : (r.role ?? null),
        trophies: int(r.trophies),
        best_trophies: int(r.best_trophies),
        arena: r.arena ?? null,
        career_wins: int(r.career_wins),
        collection_level: int(r.collection_level),
        joined_at: iso(joined),
        baseline: Boolean(r.baseline),
        tenure_days: joined
          ? Math.max(0, Math.floor((end.getTime() - joined.getTime()) / DAY_MS))
          : null,
        stints_before: Number(r.stints_before ?? 0),
        last_left_at: iso(r.last_left_at),
        war: [],
        moments: [],
        awards: [],
      };
    }
    if (weeks.length) {
      const { rows: war } = await db.query(
        `select wp.player_tag, wp.season_id, wp.section_index,
                wp.decks_used, wp.points, w.is_colosseum
           from war_participation wp
           join war_week w on w.clan_tag = wp.clan_tag
            and w.season_id = wp.season_id and w.section_index = wp.section_index
          where wp.clan_tag = $1 and wp.player_tag = any($2::text[])
            and (wp.season_id, wp.section_index) in
                (select * from unnest($3::int[], $4::int[]))
          order by wp.season_id desc, wp.section_index desc`,
        [
          clanTag,
          tags,
          weeks.map((w) => w.season_id),
          weeks.map((w) => w.section_index),
        ],
      );
      for (const w of war)
        members[w.player_tag]?.war.push({
          season_id: w.season_id,
          section_index: w.section_index,
          is_colosseum: w.is_colosseum,
          decks_used: int(w.decks_used),
          points: int(w.points),
        });
    }
    // The clan's awards they hold, as the clan announced them: this
    // season's and last (an award is granted when its season closes).
    // Read as the clan's members read its facts (`factItems`, the one
    // reader of attested facts and their visibility rule), recorded
    // since last season began.
    const season = seasonFromDate(nowMs);
    const since = seasonFromDate(season.seasonStartMs - 1);
    const held = (
      await factItems(db, [{ kind: "clan", tag: clanTag }], {
        fromMs: since.seasonStartMs,
        toMs: nowMs,
        clanMember: true,
      })
    )
      .filter(
        (it) =>
          it.kind === "award_granted" &&
          members[it.facts?.player_tag] &&
          it.facts.award &&
          Number(it.facts.season_id) >= season.seasonId - 1,
      )
      .sort(
        (a, b) =>
          Number(b.facts.season_id) - Number(a.facts.season_id) ||
          String(b.at ?? "").localeCompare(String(a.at ?? "")),
      );
    for (const it of held) {
      const list = members[it.facts.player_tag].awards;
      if (list.length < AWARDS_MAX)
        list.push({
          name: it.facts.award,
          season_id: Number(it.facts.season_id),
        });
    }
    const want = moments === true ? {} : moments || null;
    const skip = new Set(want?.except ?? []);
    if (want)
      for (const tag of tags
        .filter((t) => members[t])
        .slice(0, want.members ?? tags.length)) {
        const { timeline } = await buildTimeline(
          db,
          [{ kind: "player", tag }],
          {
            fromMs: nowMs - MOMENT_DAYS * DAY_MS,
            toMs: nowMs,
            filter: (it) =>
              isPublishable(it) && activityCategory(it) === "milestones",
          },
        );
        members[tag].moments = timeline
          .filter((it) => it.text && !skip.has(it.id))
          .sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")))
          .slice(0, Math.min(want.max ?? MOMENTS_MAX, MOMENTS_MAX))
          .map((it) => ({ at: it.at, text: it.text }));
      }
  }
  return {
    clan: clan
      ? {
          name: clan.name ?? null,
          members:
            clan.snapshot_members != null
              ? Number(clan.snapshot_members)
              : Number(clan.members) || null,
          war: weeks.map((w) => ({
            season_id: w.season_id,
            section_index: w.section_index,
            is_colosseum: w.is_colosseum,
            rank: int(w.rank),
            trophy_change: int(w.trophy_change),
          })),
        }
      : null,
    members,
  };
}
