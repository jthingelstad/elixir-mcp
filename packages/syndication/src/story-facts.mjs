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
 *  fact the record lacks is absent, never filled in.
 *
 *  A leader's draft about one member also asks for that member's
 *  dossier (`dossier`, `memberDossier`; Jamie, 2026-10-20: "use the full
 *  data resources of Elixir to create a meaningfully more in-depth and
 *  personalized message"): every war week in this clan, donations week
 *  by week and in their career, the profile's highlights, their decks
 *  by mode over 28 days, their milestones over 28 days and their role
 *  changes here. The engine's `dossierLines` and `storyAngles` decide
 *  what of it each kind of draft is told. */
import {
  buildTimeline,
  factItems,
  isPublishable,
} from "@elixir-mcp/tools/activity/entries";
import { deckIdentities, participantGamesSql } from "@elixir-mcp/tools/shared";
import { activityCategory } from "@elixir-mcp/clan-engine";
import { modeGroupSql, typesForModeGroup } from "@elixir-mcp/contracts";
import { badgeLabel, masteryCard } from "@elixir-mcp/record/badge-names";
import {
  seasonResultLeague,
  ULTIMATE_CHAMPION,
} from "@elixir-mcp/record/ranked-leagues";
import { notBoatDefense } from "@elixir-mcp/record/boat-defense-sql";
import { memberActivityWeeks } from "@elixir-mcp/record/member-activity";
import { readRecordedProfile } from "@elixir-mcp/record/recorded-profile";
import { seasonFromDate } from "@elixir-mcp/record/war-clock";

const DAY_MS = 24 * 3600_000;
/** Finished war weeks told: the clan's and each member's. */
const STORY_WEEKS = 4;
/** How far back a member's moments are read, and how many are kept. */
const MOMENT_DAYS = 14;
const MOMENTS_MAX = 5;
/** Announced awards told per member, newest season first. */
const AWARDS_MAX = 6;
/** A dossier's bounds: the clan's finished war weeks read (at most 52,
 *  and only those that closed in the last 365 days), the whole weeks of
 *  donations, the days of decks and milestones, the milestones kept,
 *  the decks kept per mode, the fewest games a deck needs to be told,
 *  the legendary badges and Mastery cards named, and the role changes. */
const DOSSIER_WAR_WEEKS = 52;
const DOSSIER_WAR_DAYS = 365;
const DOSSIER_DONATION_WEEKS = 12;
const DOSSIER_DAYS = 28;
const DOSSIER_MOMENTS = 8;
const DOSSIER_DECKS_PER_MODE = 2;
const DOSSIER_DECK_GAMES = 3;
const DOSSIER_BADGES = 6;
const DOSSIER_MASTERIES = 8;
const DOSSIER_ROLES = 6;
/** The modes a dossier tells decks for, each its own: never pooled. */
const DOSSIER_MODES = ["ladder", "ranked", "war"];

const iso = (d) => (d instanceof Date ? d.toISOString() : (d ?? null));
const int = (x) => (x == null ? null : Number(x));
const WEEK_MS = 7 * DAY_MS;
/** Monday 00:00Z of the week holding `ms`: the game day's week, as the
 *  donation counter's weeks are read (`date_trunc('week', snapshot_date)`). */
const mondayOf = (ms) => {
  const d = new Date(ms);
  const midnight = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
  );
  return midnight - ((d.getUTCDay() + 6) % 7) * DAY_MS;
};

/**
 * @param {import("pg").ClientBase} db
 * @param {string} clanTag
 * @param {{ playerTags?: string[], nowMs?: number,
 *   moments?: boolean | { max?: number, members?: number, except?: string[] },
 *   dossier?: string | null, identities?: typeof deckIdentities }} [opts]
 *   `moments`: read each member's recent milestones from the timeline.
 *   `true` for a leader's draft (one member, five moments); the Discord
 *   run bounds it (`max` moments each, for the first `members` members,
 *   one timeline read per member inside the sync's time budget) and
 *   leaves out the items it is posting (`except`, by id).
 *   `dossier`: one of `playerTags` whose dossier is read too (a
 *   leader's draft only). Their history is then told once, in the
 *   dossier: their entry's `war` and `moments` stay empty.
 *   `identities`: the deck namer (`deckIdentities`; a test's own).
 * @returns {Promise<{ clan: object|null, members: Record<string, object>,
 *   dossier?: object|null }>}
 */
export async function clanStoryFacts(
  db,
  clanTag,
  {
    playerTags = [],
    nowMs = Date.now(),
    moments = false,
    dossier = null,
    identities = deckIdentities,
  } = {},
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
        .filter((t) => members[t] && t !== dossier)
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
  // The dossier's subject: their history is the dossier's to tell.
  const subject = dossier && members[dossier] ? members[dossier] : null;
  if (subject) {
    subject.war = [];
    subject.moments = [];
  }
  return {
    ...(dossier
      ? {
          dossier: subject
            ? await memberDossier(db, clanTag, dossier, {
                nowMs,
                joinedAt: subject.joined_at,
                awards: subject.awards,
                identities,
              })
            : null,
        }
      : {}),
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

/** What a leader's draft is told for every draft (the web adapter's
 *  `storyFor`): the clan, and the member with their dossier when the
 *  draft is about one member. */
export const draftStory = (db, clanTag, playerTags, { nowMs } = {}) =>
  clanStoryFacts(db, clanTag, {
    playerTags,
    nowMs,
    moments: true,
    dossier: playerTags.length === 1 ? playerTags[0] : null,
  });

/**
 * One member's dossier, for the leader's draft about them: each part
 * from the reader Elixir already has, bounded, and read one after
 * another (one client is one connection: ENGINEERING.md). Facts only:
 * no rating, rank, share or rate; a deck's wins and losses are counted
 * for one mode at a time.
 *
 *  - `war`: their war weeks in this clan, newest first, for the clan's
 *    last finished weeks (`DOSSIER_WAR_WEEKS`) that closed in the last
 *    year (`DOSSIER_WAR_DAYS`, on `closed_at`, else
 *    `finished_observed_at`; a week with neither is left out): decks
 *    used and points (never fame), `ago` counting finished weeks back
 *    from the newest (0). Weekly aggregates only.
 *  - `donations`: their donations in this clan for each of the last
 *    whole weeks they were here for all of (`memberActivityWeeks`; a
 *    week they joined in has none), `ago` counting back from last week
 *    (0); and `career`, the profile's lifetime count (all clans).
 *  - `profile`: years played, favourite card, the cards at Mastery's
 *    top level, legendary badges (one-time badges; a dated seasonal
 *    one is left out), Path of Legends at its best (`pol_best`: the
 *    best league a recorded season ended in, by name, or Ultimate
 *    Champion from a rated profile best with `season` null; for
 *    Ultimate Champion, `ultimate_seasons` counts the recorded ones)
 *    and the Clan War Wins badge's count.
 *  - `decks`: by mode (Trophy Road, Path of Legends, this clan's war),
 *    over the last 28 days by `battle_time`: games, wins and losses for
 *    the mode, and its most played decks by archetype label (an
 *    unclassified deck is not named). A boat defense is not theirs; a
 *    duel counts as its rounds.
 *  - `moments`: their milestones over the last 28 days, newest first.
 *  - `roles`: their role changes in this clan, newest first.
 *  - `awards`: the clan's awards they hold, as the clan announced them.
 */
async function memberDossier(
  db,
  clanTag,
  playerTag,
  {
    nowMs = Date.now(),
    joinedAt = null,
    awards = [],
    identities = deckIdentities,
  } = {},
) {
  const fromMs = nowMs - DOSSIER_DAYS * DAY_MS;
  const war = await dossierWar(db, clanTag, playerTag, { nowMs });
  const donations = await dossierDonations(db, clanTag, playerTag, {
    nowMs,
    joinedAt,
  });
  const profile = await dossierProfile(db, playerTag);
  const decks = await dossierDecks(db, clanTag, playerTag, {
    fromMs,
    toMs: nowMs,
    identities,
  });
  const moments = await dossierMoments(db, playerTag, {
    fromMs,
    toMs: nowMs,
  });
  const roles = await dossierRoles(db, clanTag, playerTag);
  return {
    days: DOSSIER_DAYS,
    war,
    donations: { weeks: donations, career: profile?.career_donations ?? null },
    profile: profile?.highlights ?? null,
    decks,
    moments,
    roles,
    awards,
  };
}

async function dossierWar(db, clanTag, playerTag, { nowMs }) {
  // `ago` counts every finished week of the clan, one with no close time
  // included; the cap and the year then both bound what is told, the
  // year on the week's close, so a clan that skipped wars or a gap in
  // the record never reaches past a year (Codex on #607).
  const { rows } = await db.query(
    `with weeks as (
       select w.season_id, w.section_index, w.is_colosseum,
              coalesce(w.closed_at, w.finished_observed_at) as closed,
              (row_number() over (order by w.season_id desc, w.section_index desc) - 1)::int as ago
         from war_week w
         join war_week_clan own on own.clan_tag = w.clan_tag
          and own.season_id = w.season_id and own.section_index = w.section_index
          and own.participant_clan_tag = w.clan_tag
        where w.clan_tag = $1 and own.rank is not null)
     select k.season_id, k.section_index, k.is_colosseum, k.ago,
            wp.decks_used, wp.points
       from weeks k
       join war_participation wp on wp.clan_tag = $1 and wp.player_tag = $2
        and wp.season_id = k.season_id and wp.section_index = k.section_index
      where k.ago < $3 and k.closed >= $4::timestamptz
      order by k.ago`,
    [
      clanTag,
      playerTag,
      DOSSIER_WAR_WEEKS,
      new Date(nowMs - DOSSIER_WAR_DAYS * DAY_MS).toISOString(),
    ],
  );
  return rows.map((r) => ({
    season_id: r.season_id,
    section_index: r.section_index,
    is_colosseum: r.is_colosseum,
    ago: r.ago,
    decks_used: int(r.decks_used),
    points: int(r.points),
  }));
}

async function dossierDonations(db, clanTag, playerTag, { nowMs, joinedAt }) {
  const thisWeek = mondayOf(nowMs);
  const weeks = Array.from({ length: DOSSIER_DONATION_WEEKS }, (_, i) => {
    const from = thisWeek - (i + 1) * WEEK_MS;
    return {
      iso_week: new Date(from).toISOString().slice(0, 10),
      from: new Date(from).toISOString(),
      to: new Date(from + WEEK_MS).toISOString(),
    };
  });
  const oldest = weeks.at(-1).from;
  const rows = await memberActivityWeeks(
    db,
    clanTag,
    playerTag,
    weeks,
    joinedAt && joinedAt > oldest ? joinedAt : oldest,
    new Date(thisWeek).toISOString(),
  );
  const ago = new Map(weeks.map((w, i) => [w.iso_week, i]));
  return rows
    .filter((r) => r.donations != null)
    .map((r) => ({
      week: r.iso_week,
      ago: ago.get(r.iso_week),
      donations: int(r.donations),
    }))
    .sort((a, b) => a.ago - b.ago);
}

async function dossierProfile(db, playerTag) {
  const p = await readRecordedProfile(db, playerTag);
  if (!p) return null;
  const {
    rows: [card],
  } = p.favorite_card_id
    ? await db.query(`select name from card where card_id = $1`, [
        p.favorite_card_id,
      ])
    : { rows: [] };
  const badges = Array.isArray(p.badges) ? p.badges : [];
  const masteries = badges
    .filter(
      (b) =>
        masteryCard(b.name) &&
        Number.isInteger(b.level) &&
        Number.isInteger(b.max_level) &&
        b.level >= b.max_level,
    )
    .map((b) => ({ card: masteryCard(b.name), level: b.level }));
  const legendary = badges
    .filter((b) => b.level == null && !/_\d{6}(?:_v\d+)?$/.test(b.name))
    .map((b) => badgeLabel(b.name))
    .filter(Boolean);
  // Path of Legends at its best (#616): the best league a recorded season
  // ended in, the newest of equals, and for Ultimate Champion how many
  // recorded seasons ended there; with none there, a rated profile best
  // is Ultimate Champion too, from a season the record does not hold
  // (`seasonResultLeague`: 1 with no rating is also not playing). Every
  // recorded season, not the profile read's newest 12: an older finish
  // still counts, and is still in the record.
  const { rows: polSeasons } = await db.query(
    `select season_month, league, trophies from player_pol_season
      where player_tag = $1 order by season_month desc`,
    [playerTag],
  );
  const seasons = polSeasons
    .map((s) => ({
      season: s.season_month,
      ...seasonResultLeague({
        league: int(s.league),
        trophies: int(s.trophies),
      }),
    }))
    .filter((s) => s.name && s.season);
  const top = seasons.reduce(
    (best, s) => (!best || s.league > best.league ? s : best),
    null,
  );
  const ultimate = seasons.filter((s) => s.league === ULTIMATE_CHAMPION);
  const profileBest = seasonResultLeague(
    { league: int(p.pol_best_league), trophies: int(p.pol_best_trophies) },
    { best: true },
  );
  const polBest = ultimate.length
    ? { ...top, ultimate_seasons: ultimate.length }
    : profileBest
      ? { season: null, ...profileBest, ultimate_seasons: 0 }
      : top;
  const cww = badges.find((b) => b.name === "ClanWarWins");
  return {
    career_donations: int(p.total_donations),
    highlights: {
      years_played: int(p.years_played),
      favorite_card: card?.name ?? null,
      masteries_at_top: masteries.length,
      mastery_level: masteries[0]?.level ?? null,
      masteries: masteries.slice(0, DOSSIER_MASTERIES).map((m) => m.card),
      legendary_badges: legendary.slice(0, DOSSIER_BADGES),
      pol_best: polBest,
      clan_war_wins: Number.isInteger(cww?.progress) ? cww.progress : null,
    },
  };
}

async function dossierDecks(
  db,
  clanTag,
  playerTag,
  { fromMs, toMs, identities },
) {
  const types = DOSSIER_MODES.flatMap((m) => typesForModeGroup(m));
  const { rows } = await db.query(
    `with mine as (
       select bp.battle_id, bp.player_tag, bp.side, bp.battle_time, bp.type,
              bp.type_class, bp.deck_hash, bp.outcome, bp.deck_avg_level,
              bp.opp_deck_avg_level, bp.starting_trophies
         from battle_participant bp
        where bp.player_tag = $1
          and bp.battle_time >= $2 and bp.battle_time < $3
          and bp.type = any($4::text[])
          -- War is this clan's war: a week played for another clan is not.
          and (bp.type <> all($5::text[]) or bp.clan_tag = $6)
          and ${notBoatDefense("bp", { lookupByKey: true })})
     select g.deck_hash, ${modeGroupSql("g.type", "b.event_tag")} as mode,
            count(*)::int as games,
            count(*) filter (where g.outcome = 'win')::int as wins,
            count(*) filter (where g.outcome = 'loss')::int as losses
       from ${participantGamesSql("mine")} g
       join battle b on b.battle_id = g.battle_id
      where g.deck_hash is not null
      group by 1, 2`,
    [
      playerTag,
      new Date(fromMs),
      new Date(toMs),
      types,
      typesForModeGroup("war"),
      clanTag,
    ],
  );
  const out = [];
  const named = await identities(
    db,
    rows.map((r) => r.deck_hash),
  );
  for (const mode of DOSSIER_MODES) {
    const mine = rows
      .filter((r) => r.mode === mode)
      .sort(
        (a, b) => b.games - a.games || a.deck_hash.localeCompare(b.deck_hash),
      );
    if (!mine.length) continue;
    const sum = (k) => mine.reduce((n, r) => n + r[k], 0);
    out.push({
      mode,
      games: sum("games"),
      wins: sum("wins"),
      losses: sum("losses"),
      decks: mine
        .filter((r) => r.games >= DOSSIER_DECK_GAMES)
        .map((r) => ({ ...r, archetype: named.get(r.deck_hash)?.archetype }))
        .filter(
          (r) => r.archetype?.label && r.archetype.family !== "unclassified",
        )
        .slice(0, DOSSIER_DECKS_PER_MODE)
        .map((r) => ({
          label: r.archetype.label,
          games: r.games,
          wins: r.wins,
          losses: r.losses,
        })),
    });
  }
  return out;
}

async function dossierMoments(db, playerTag, { fromMs, toMs }) {
  const { timeline } = await buildTimeline(
    db,
    [{ kind: "player", tag: playerTag }],
    {
      fromMs,
      toMs,
      filter: (it) =>
        isPublishable(it) && activityCategory(it) === "milestones",
    },
  );
  return timeline
    .filter((it) => it.text)
    .sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")))
    .slice(0, DOSSIER_MOMENTS)
    .map((it) => ({ at: it.at, text: it.text }));
}

async function dossierRoles(db, clanTag, playerTag) {
  const { rows } = await db.query(
    `select window_end, role_before, role_after
       from clan_event
      where clan_tag = $1 and event_type = 'role_changed' and player_tag = $2
      order by window_end desc, event_id desc
      limit $3`,
    [clanTag, playerTag, DOSSIER_ROLES],
  );
  return rows.map((r) => ({
    at: iso(r.window_end),
    before: r.role_before ?? null,
    after: r.role_after ?? null,
  }));
}
