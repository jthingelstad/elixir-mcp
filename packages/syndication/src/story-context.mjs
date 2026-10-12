/** What the record adds to a story of the clan's activity channel
 *  (2026-10-11, the editor Jamie approved): for one member's battle, the
 *  deck they won it with and that deck's record in its mode this season,
 *  whether it is their second promotion in a day, and the clanmates
 *  already in the arena it moved them into. A sitting's mode mix, best
 *  win and run are already its facts.
 *
 *  Recorded facts only, read as a member of the clan could read them:
 *  battles, decks and profiles, never anything private to Clan. Every
 *  read is bounded: a few queries for each of the run's first
 *  `CONTEXT_STORIES_MAX` battle stories, each on one player's indexed
 *  rows. A fact the record lacks is left out, never guessed. */
import { modeGroupOf } from "@elixir-mcp/contracts";
import { deckIdentities } from "@elixir-mcp/tools/shared";
import { participantModeClause } from "@elixir-mcp/record/mode-filter";
import { seasonFromDate } from "@elixir-mcp/record/war-clock";
import { storyBattleId } from "@elixir-mcp/clan-engine";

/** Battle stories given record context in one run, at most. */
const CONTEXT_STORIES_MAX = 10;
/** Modes a deck's season record is said for. */
const DECK_MODES = new Set(["ladder", "ranked"]);
/** Clanmates in an arena read, at most (three are named). */
const MATES_MAX = 10;
const DAY_MS = 24 * 3600_000;

const playerOf = (it) => it?.facts?.player_tag ?? null;
/** The kinds that move a member up: told the clanmates there. */
const MOVES = new Set(["arena_changed", "ranked_promotion"]);

/**
 * @param {import("pg").ClientBase} db
 * @param {string} clanTag
 * @param {{ key: string, items: object[] }[]} stories
 * @param {{ nowMs?: number, identities?: typeof deckIdentities }} [opts]
 *   `identities` names the decks (the tools' deckIdentities; a test's
 *   stand-in)
 * @returns {Promise<Map<string, { deck?: object, promotions?: number,
 *   mates?: string[] }>>} by story key
 */
export async function storyContext(
  db,
  clanTag,
  stories,
  { nowMs = Date.now(), identities = deckIdentities } = {},
) {
  const out = new Map();
  const battles = stories
    .map((s) => {
      const players = new Set(s.items.map(playerOf));
      const battle = s.items.map(storyBattleId).find(Boolean) ?? null;
      // A move the roster saw before the battle log delivered its battle
      // is still told who is there and the day's promotions (2026-10-12:
      // such a post went out bare); only the deck needs the battle.
      const moved = s.items.some((it) => MOVES.has(it.kind));
      return players.size === 1 && (battle || moved)
        ? { story: s, player: playerOf(s.items[0]), battle }
        : null;
    })
    .filter(Boolean)
    .slice(0, CONTEXT_STORIES_MAX);
  if (!battles.length) return out;
  const withBattle = battles.filter((b) => b.battle);

  // The deck each battle was won with, and its mode.
  const { rows: played } = await db.query(
    `select bp.battle_id, bp.player_tag, bp.deck_hash, bp.type, b.event_tag
       from battle_participant bp
       join battle b on b.battle_id = bp.battle_id
      where (bp.battle_id, bp.player_tag) in
            (select * from unnest($1::text[], $2::text[]))`,
    [withBattle.map((b) => b.battle), withBattle.map((b) => b.player)],
  );
  const deckOf = new Map(
    played.map((r) => [`${r.player_tag}|${r.battle_id}`, r]),
  );
  const ids = await identities(
    db,
    played.map((r) => r.deck_hash).filter(Boolean),
  );
  const seasonStart = seasonFromDate(nowMs).seasonStartMs;

  for (const { story, player, battle } of battles) {
    const ctx = {};
    const row = deckOf.get(`${player}|${battle}`);
    const mode = row ? modeGroupOf(row.type, row.event_tag) : null;
    const archetype = row?.deck_hash ? ids.get(row.deck_hash)?.archetype : null;
    if (
      row?.deck_hash &&
      DECK_MODES.has(mode) &&
      archetype?.label &&
      archetype.family !== "unclassified"
    ) {
      // The exact deck's record in this mode this season, through now.
      const params = [
        player,
        row.deck_hash,
        new Date(seasonStart),
        new Date(nowMs),
      ];
      const modeSql = participantModeClause(mode, params, "bp");
      const {
        rows: [rec],
      } = await db.query(
        `select count(*) filter (where bp.outcome = 'win')::int as won,
                count(*) filter (where bp.outcome = 'loss')::int as lost,
                count(*) filter (where bp.outcome = 'draw')::int as drawn
           from battle_participant bp
          where bp.player_tag = $1 and bp.deck_hash = $2
            and bp.battle_time >= $3 and bp.battle_time <= $4
            and ${modeSql}`,
        params,
      );
      ctx.deck = { label: archetype.label, mode, ...rec };
    }
    const promoted = story.items.filter(
      (it) =>
        it.kind === "ranked_promotion" ||
        (it.kind === "arena_changed" && !(it.facts?.to < it.facts?.from)),
    );
    if (promoted.length) {
      // Promotions in the day before this one, the same arena or league
      // once: the day ends at the promotion told, never at the run (a
      // story told late is not counted against today's moves).
      const atMs = Math.max(
        ...promoted
          .map((it) => Date.parse(it.at ?? ""))
          .filter(Number.isFinite),
      );
      const endMs = Number.isFinite(atMs) ? atMs : nowMs;
      const {
        rows: [p],
      } = await db.query(
        `select count(distinct (event_type, coalesce(arena_to, league_to)))::int as n
           from player_event
          where player_tag = $1
            and ((event_type = 'arena_changed' and arena_to > arena_from)
                 or event_type = 'ranked_promotion')
            and window_end > $2 and window_end <= $3`,
        [player, new Date(endMs - DAY_MS), new Date(endMs)],
      );
      ctx.promotions = Math.max(p?.n ?? 0, promoted.length);
    }
    const arena = story.items.find(
      (it) => it.kind === "arena_changed" && it.facts?.to != null,
    );
    if (arena) {
      // Clanmates whose latest profile is in that arena: how many, and
      // the first names (a few are named, more are counted).
      const { rows: mates } = await db.query(
        `select p.name, count(*) over ()::int as total
           from clan_membership cm
           join player p on p.player_tag = cm.player_tag
           cross join lateral (
             select d.arena_id from player_snapshot_daily d
              where d.player_tag = cm.player_tag
                and d.profile_observed_at is not null
              order by d.snapshot_date desc, d.profile_observed_at desc
              limit 1) s
          where cm.clan_tag = $1 and cm.left_observed_at is null
            and cm.player_tag <> $2 and s.arena_id = $3 and p.name is not null
          order by p.name
          limit ${MATES_MAX}`,
        [clanTag, player, arena.facts.to],
      );
      ctx.mates = mates.map((m) => m.name);
      ctx.mates_total = mates[0]?.total ?? 0;
    }
    out.set(story.key, ctx);
  }
  return out;
}
