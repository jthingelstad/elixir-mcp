/** battles_query · battles_performance · battles_cards · battles_decks ·
 *  battles_meta_decks · battles_meta_cards · battles_trends ·
 *  battles_compare. Conventions (1.0.0, shared.mjs):
 *  from/to + timezone on every windowed tool, one `applied` echo,
 *  `notes[]` + `docs`, `verbosity` as the size control, nested `segment`
 *  on the corpus-wide tools. */

import {
  normalizeTag,
  responseMeta,
  MODE_GROUPS,
  typesForModeGroup,
  formName,
} from "@elixir-mcp/contracts";
import { formatLocal } from "../time.mjs";
import {
  requireEnum,
  decksContaining,
  ToolFailure,
  TAG_SCHEMA,
  ON_BEHALF_OF_SCHEMA,
  DISPLAY_NAME_SCHEMA,
  MODE_SCHEMA,
  WINDOW_ARGS,
  WINDOW_FROM_DESC,
  WINDOW_TO_DESC,
  VERBOSITY,
  SEGMENT_SCHEMA,
  SEGMENT_NOTES,
  SEGMENT_DOCS,
  subject,
  buildMeta,
  resolveSeasonWindow,
  SEASON_ARG_SCHEMA,
  requireOrderedWindow,
  appliedBlock,
  notes,
  docsRef,
  liveRead,
  liveStatus,
  livePendingNote,
  segmentFilter,
  ebShrink,
  META_METHODOLOGY,
  DUEL_TYPES,
  excludedBreakdown,
  corpusPrior,
  deckIdentities,
  renderDecks,
  populationBlock,
  resolveFitFor,
  fieldedLevel,
  deckFit,
  heldCard,
  ARCHETYPE_NOTE,
  ARCHETYPE_ARG,
  resolveArchetypeArg,
  matchesArchetype,
  deckStamps,
  stampMatches,
} from "./shared.mjs";

/** group_by on battles_meta_decks (6.6.0, design §6): the population's
 *  decks folded by archetype label or by family, with the members who
 *  play each on a clan, player or collection segment. */
const GROUP_BY_SCHEMA = {
  type: "string",
  enum: ["archetype", "family"],
  description:
    'Fold the population\'s decks by archetype label ("Royal Hogs bridge spam") or by family (six rows). Rows carry decks, battles, record and players; on a clan, player or collection segment each carries members[] (who plays it, with their most-played deck of that shape). Sorted by players then battles - who plays what, never a tier list: shrunk_win_rate is deliberately absent. decks[] is empty with group_by.',
};

/** fit_for on the meta tools (6.4.0, feedback #70). */
const FIT_FOR_SCHEMA = {
  type: "string",
  description:
    "A player tag whose recorded collection every row is checked against. On battles_meta_decks a row the player cannot field (a card not owned, a form not unlocked) leaves decks[] for unfieldable[] with the reason, and every row carries fit: the mean level the player would field it at, that against the level they have been fielding in the window (fit_for.fielded_mean_level), and the upgrade path to it. On battles_meta_cards each row carries held (level and forms) or null. Omit for the population alone; a recommendation to a person should not omit it.",
};
import {
  seasonRollup,
  seasonPrior,
  rollupDecks,
  rollupCards,
  rawScanMemory,
  TROPHY_BAND_NAMES,
  trophyBandClause,
  rollupDeckModes,
  rollupCardModes,
  rollupModeGroups,
} from "../meta-season.mjs";

/** The trophy band argument the three meta tools take (0135): the
 *  participant's own starting trophies at battle time. */

/** One card, or a handful: the ids a card-shaped question names (5.0.0).
 *  Filters the rows AFTER aggregation, like min_battles and limit; the
 *  denominators (decided_battles, usage_share) stay the population's. */
const CARD_IDS_ARG = {
  type: "array",
  items: { type: "integer" },
  minItems: 1,
  maxItems: 8,
};
const META_TROPHY_BAND_SCHEMA = {
  type: "string",
  enum: TROPHY_BAND_NAMES,
  description:
    "Only battles the deck's own player entered with starting trophies in this band: the meta at a level. A corpus season read answers from the banded rollup once the nightly rebuild has filled it, else from the raw rows with a note.",
};

/** The band fallback sentence when the rollup is not yet built. */
/** The meta tools and the caller's collection (6.4.0, feedback #70). */
const NO_FIT_NOTE =
  "These are the population's decks and levels; nothing here checks what any one player holds. Before naming a row as a recommendation to a person, pass fit_for with their tag: rows they cannot field leave decks[], and every row then says what they would field it at and what upgrades would open.";

function fitNotes(fitBlock, decks, unfieldable) {
  const fielded =
    fitBlock.fielded_mean_level === null
      ? `${fitBlock.player_tag} has no decided pvp battles with a recorded deck in this window, so fit.vs_fielded and fit.upgrades are null: there is no fielded level to measure against`
      : `${fitBlock.player_tag} has fielded a mean card level of ${fitBlock.fielded_mean_level} over ${fitBlock.fielded_battles} decided battles in this window; fit.vs_fielded is each row's own_mean_level against that, and fit.upgrades is the path to it`;
  return [
    `Checked against ${fitBlock.player_tag}'s collection as of ${fitBlock.collection_as_of}: ${decks.length} of the top ${decks.length + unfieldable.length} rows are fieldable as held (decks[]); ${unfieldable.length} are not (unfieldable[], each naming the card or form missing). The population's ranking is unchanged - the split is after sort and limit, so raise limit for more fieldable rows.`,
    `${fielded}. mean_level_gap on a row is the population's players' edge over their opponents, not ${fitBlock.player_tag}'s; own_mean_level is what the deck would be at their levels, and held_level rides each card.`,
    `fit.plays_family and fit.plays_archetype say whether ${fitBlock.player_tag} already fields this row's family or exact shape (fit_for.plays lists theirs): a row in a family they play costs the least to adopt, a row sharing the family with a different win condition is the usual next step, and a row in a new family is a new deck to learn as well as levels to buy.`,
  ];
}

/** Fold deck rows by their stamped archetype (label or family). With
 *  members, one scan of the scope's battle rows by player and deck says
 *  who plays each shape and their most-played deck of it; `players` is
 *  then exact. Without (the corpus), `players` sums the decks' distinct
 *  players and the note says a player on two decks of one shape counts
 *  twice. */
async function groupByArchetype(
  db,
  { groupBy, rows, where, params, withMembers, limit },
) {
  const stamps = await deckStamps(
    db,
    rows.map((r) => r.deck_hash),
  );
  const keyOf = (stamp) => (groupBy === "family" ? stamp.family : stamp.label);
  const groups = new Map();
  const total = rows.reduce((n, r) => n + r.battles, 0);
  for (const r of rows) {
    const stamp = stamps.get(r.deck_hash);
    if (!stamp) continue;
    const key = keyOf(stamp);
    const g = groups.get(key) ?? {
      ...(groupBy === "family"
        ? { family: stamp.family }
        : {
            label: stamp.label,
            family: stamp.family,
            win_condition_ids: stamp.win_condition_ids,
          }),
      decks: 0,
      battles: 0,
      wins: 0,
      losses: 0,
      players: 0,
      _hashes: new Set(),
    };
    g.decks += 1;
    g.battles += r.battles;
    g.wins += r.wins;
    g.losses += r.losses;
    g.players += r.players ?? 0;
    g._hashes.add(r.deck_hash);
    groups.set(key, g);
  }
  let members = null;
  if (withMembers) {
    // Who plays what, over the same scope the deck rows came from.
    const { rows: plays } = await db.query(
      `select bp.player_tag, p.name, bp.deck_hash,
              count(*)::int as battles,
              count(*) filter (where bp.outcome = 'win')::int as wins
       from battle_participant bp
       left join player p on p.player_tag = bp.player_tag
       where ${where.join(" and ")}
       group by bp.player_tag, p.name, bp.deck_hash`,
      params,
    );
    members = new Map(); // key -> Map(player_tag -> {name, battles, wins, best})
    for (const pl of plays) {
      const stamp = stamps.get(pl.deck_hash);
      if (!stamp) continue;
      const key = keyOf(stamp);
      const byPlayer = members.get(key) ?? new Map();
      const m = byPlayer.get(pl.player_tag) ?? {
        player_tag: pl.player_tag,
        name: pl.name ?? null,
        battles: 0,
        wins: 0,
        deck_hash: pl.deck_hash,
        _deckBattles: 0,
      };
      m.battles += pl.battles;
      m.wins += pl.wins;
      if (pl.battles > m._deckBattles) {
        m._deckBattles = pl.battles;
        m.deck_hash = pl.deck_hash;
      }
      byPlayer.set(pl.player_tag, m);
      members.set(key, byPlayer);
    }
  }
  const out = [...groups.values()].map((g) => {
    const row = { ...g };
    delete row._hashes;
    const byPlayer = members?.get(groupBy === "family" ? g.family : g.label);
    const list = byPlayer
      ? [...byPlayer.values()]
          .sort(
            (a, z) =>
              z.battles - a.battles || a.player_tag.localeCompare(z.player_tag),
          )
          .map(({ _deckBattles, ...m }) => m)
      : null;
    return {
      ...row,
      ...(list ? { players: list.length, members: list } : {}),
      win_rate:
        row.wins + row.losses > 0
          ? Number((row.wins / (row.wins + row.losses)).toFixed(3))
          : null,
      share: total > 0 ? Number((row.battles / total).toFixed(3)) : null,
    };
  });
  out.sort((a, z) => z.players - a.players || z.battles - a.battles);
  return {
    rows: out.slice(0, limit),
    folded: `Folded ${rows.length} decks over min_battles into ${out.length} ${groupBy === "family" ? "families" : "archetypes"} by their stamped label, sorted by who plays them (players, then battles); share is of the ${total} decided battles those decks hold. ${
      withMembers
        ? "members lists each player of the shape with their most-played deck of it; players is exact."
        : "players sums the decks' distinct players, so a player on two decks of one shape counts twice."
    } No win rate is shrunk or ranked here: the same label wins and loses with the player.`,
  };
}

function cardFitNote(fitBlock, cards) {
  const unowned = cards.filter((c) => c.held === null).length;
  const noForm = cards.filter((c) => c.held && !c.held.has_form).length;
  return `held on each row is what ${fitBlock.player_tag} holds of the card as of ${fitBlock.collection_as_of} (${unowned} of ${cards.length} rows not owned, ${noForm} owned without the form played); ${
    fitBlock.fielded_mean_level === null
      ? "no fielded level is known for this window"
      : `their fielded mean level in this window is ${fitBlock.fielded_mean_level}, the benchmark a held level reads against`
  }. mean_level_gap is the population's, not theirs.`;
}

const BAND_FALLBACK_NOTE =
  "trophy_band answered from the raw rows (the season's banded rollup is not built yet; the nightly rebuild fills it), so distinct-player counts are exact and the read is slower.";
import { resolveInstant } from "../time.mjs";

/** tower_hp as served, from the three columns (0123): king when
 *  carried, princess as the fixed pair - a one-tower array was padded
 *  with 0 for the destroyed tower (feedback #22: the API omits a
 *  destroyed tower on head-to-head rows and writes 0 on duel rows, so
 *  array length was not a tower count). Position carries no meaning. */
function towerHpOf(r) {
  if (r.king_tower_hp === null && r.princess_tower_hp_1 === null) return null;
  return {
    ...(r.king_tower_hp !== null ? { king: r.king_tower_hp } : {}),
    ...(r.princess_tower_hp_1 !== null
      ? { princess: [r.princess_tower_hp_1, r.princess_tower_hp_2 ?? 0] }
      : {}),
  };
}

const FORM_ROWS_NOTE =
  "Forms are separate rows: form is the card FORM played (base, evolution or hero), never a level, so a card played in two forms carries two records.";

const roundsPlayed = (deck) =>
  Array.isArray(deck?.rounds) ? { rounds_played: deck.rounds.length } : {};

// The leaked-elixir counter travels as one object with its caveat ON the
// value (6.0.0, feedback #66): a note beside the row was read and
// overridden by a consuming agent the morning it shipped, because the
// number sat beside crowns and trophy_change as if it were an outcome
// fact. `rounds` is what the counters sum over; a duel's sides each sum
// two or three games on different decks, so its differential is null
// (feedback #65: the 3.13.0 spec said so and the code did not).
const ELIXIR_CAVEAT =
  "Not a skill measure. Do not describe a player's leak as good or poor play: holding elixir to make the opponent commit first is a deliberate line that raises leak by design, and the record has no placement timestamps to separate that from waste. At high trophies both sides routinely hold and both leak.";
const isDuel = (type) => /^riverRaceDuel/.test(String(type ?? ""));
const elixirOf = (own, opponent, type, deck) => {
  if (own === null) return null;
  const duel = isDuel(type);
  return {
    leaked: own,
    opponent_leaked: opponent,
    differential:
      !duel && opponent !== null ? Number((own - opponent).toFixed(2)) : null,
    // A duel row whose rounds were never recorded (an archive import)
    // still sums them: null says "more than one, count unknown".
    rounds: duel
      ? Array.isArray(deck?.rounds)
        ? deck.rounds.length
        : null
      : 1,
    caveat: ELIXIR_CAVEAT,
  };
};

// Deck identities render from deck_card via shared deckIdentities (0091):
// {id, name, form} plus tower_troop - the shape deckCards/towerTroop
// produced from an exemplar's JSON (playtest round, 2026-09-09: forms are
// part of identity and must be visible).

const BATTLE_DOCS = docsRef("battles", "what-a-battle-record-holds");
// Where the mode split, the level gap, the trophy floor and the partial
// bucket are explained (3.13.0): the deck and card aggregates point here.
const CONTROLS_DOCS = docsRef("battles", "the-control-next-to-the-number");
const DENOMINATOR_DOCS = docsRef("battles", "decided-battles-and-denominators");

import {
  modeGroupOf,
  modeSplit,
  countByMode,
  modeGaps,
  dominantMode,
  comparabilityNote,
  pooledModesNote,
  shortHash,
  trophyFloor,
  trophyFloorNote,
  markPartialWeeks,
  partialWeeksNote,
  singlePlayerNote,
  TROPHY_MODE_TYPES,
  trophyBattlesNote,
} from "../controls.mjs";

/** Shared: the mode filter as a WHERE clause on battle.type. */
function modeClause(args, add) {
  requireEnum(args.mode, MODE_GROUPS, "mode");
  if (args.mode) add("b.type = any(?)", typesForModeGroup(args.mode));
}

export const battlesTools = {
  battles_query: {
    description:
      "The workhorse: recorded battles with filters and cursor pagination, both perspectives of every battle. Three addressing modes: player_tag (the usual sweep, defaults to the caller); battle_id alone (ONE battle, both sides); deck_hash alone (corpus-wide battles for that exact deck with a deck_stats aggregate and deliberately no pooled win rate). live: true asks for a battle-log poll no older than a minute (the 'what did they just play' path): served if in hand, otherwise queued while the record answers with live_status pending.",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
        display_name: DISPLAY_NAME_SCHEMA,
        ...WINDOW_ARGS,
        season: SEASON_ARG_SCHEMA,
        mode: MODE_SCHEMA,
        game_mode_id: {
          type: "integer",
          description: "Exact game mode id from the API.",
        },
        opponent_tag: {
          type: "string",
          description: "Only battles against this tag.",
        },
        outcome: { type: "string", enum: ["win", "loss", "draw"] },
        with_card: {
          type: "integer",
          description: "Card id present in YOUR deck.",
        },
        with_cards: {
          type: "array",
          items: { type: "integer" },
          minItems: 1,
          maxItems: 8,
          description:
            "Card ids ALL present in YOUR deck (any form). Combine with with_card freely; a deck is matched by its played cards, tower troop excluded.",
        },
        against_card: {
          type: "integer",
          description: "Card id present in an OPPONENT deck.",
        },
        deck_hash: {
          type: "string",
          description:
            "Exact deck identity (see battles_decks). Without player_tag: corpus-wide.",
        },
        battle_id: {
          type: "string",
          description: "Fetch exactly this battle (both perspectives).",
        },
        game_mode: {
          type: "string",
          description:
            "Case-insensitive substring of the game's mode name ('chaos', 'crazy'); discover names with battles_performance group_by: 'game_mode'.",
        },
        live: {
          type: "boolean",
          description:
            "Ask for a battle-log poll no older than a minute: served from the record if in hand, otherwise queued while the record answers now with live_status pending and retry_after_s.",
        },
        cursor: {
          type: "string",
          description: "Opaque token from a previous response's next_cursor.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 25,
          description: "Battles per page; above 25 needs verbosity: 'compact'.",
        },
        include_total: {
          type: "boolean",
          description:
            "Also return total_count across ALL pages (one cheap count query).",
        },
        verbosity: VERBOSITY(
          "drops per-card decks, support cards and tower_hp (deck_hash stays); use it for wide sweeps.",
        ),
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      // Addressing modes (design handoff 2026-09-05): battle_id and
      // corpus-wide deck_hash need no subject tag - recorded battles
      // are universal reads.
      const byBattle = args.battle_id !== undefined;
      const corpusDeck = !byBattle && args.deck_hash && !args.player_tag;
      let tag = null;
      if (!byBattle && !corpusDeck) {
        const s = await subject(
          ctx.db,
          ctx.account,
          args.player_tag,
          "battles",
          args.on_behalf_of,
          args.display_name,
        );
        tag = s.tag;
      }
      let live = null;
      if (args.live === true) {
        if (!tag)
          throw new ToolFailure(
            "bad_request",
            "live: true needs a player (player_tag or the default subject), not battle_id or a corpus-wide deck_hash.",
          );
        // 1.7.0: asynchronous - a fresh poll is already in the record,
        // otherwise one is queued and the record answers now.
        live = await liveRead(ctx, {
          endpoint: "player_battlelog",
          entityKey: tag,
        });
      }
      const win = await resolveSeasonWindow(ctx, args, {
        seasonDefault: false,
      });
      const tz = win.timezone;
      const limit = Math.min(Math.max(Number(args.limit ?? 25), 1), 50);
      const compact = args.verbosity === "compact";
      // Full battles carry BOTH sides' decks and tower_hp; above the
      // default page size that reliably overruns the result cap. Refuse
      // loudly instead.
      if (!compact && Number(args.limit ?? 25) > 25) {
        throw new ToolFailure(
          "bad_request",
          "limit above 25 requires verbosity: 'compact' (full battles carry both sides' decks).",
          "Use compact for wide sweeps; deck_hash survives compaction.",
        );
      }
      const where = [];
      const params = [];
      if (byBattle) {
        params.push(String(args.battle_id));
        where.push(`bp.battle_id = $1`, `bp.side = 0`);
      } else if (corpusDeck) {
        where.push("bp.side is not null");
      } else {
        params.push(tag);
        where.push("bp.player_tag = $1");
      }
      const add = (clause, value) => {
        params.push(value);
        where.push(clause.replace("?", `$${params.length}`));
      };
      const { from, to } = win;
      if (from) add("bp.battle_time >= ?", from);
      requireEnum(args.outcome, ["win", "loss", "draw"], "outcome");
      if (args.with_card !== undefined) {
        const cardId = Number(args.with_card);
        if (
          !Number.isInteger(cardId) ||
          cardId < 26000000 ||
          cardId >= 29000000
        ) {
          throw new ToolFailure(
            "bad_request",
            `with_card ${args.with_card} is not a Clash Royale card id.`,
            "Card ids are 8-digit values like 26000000; resolve names to ids with cards_catalog.",
          );
        }
      }
      if (to) add("bp.battle_time < ?", to);
      modeClause(args, add);
      if (args.game_mode_id !== undefined)
        add("b.game_mode_id = ?", args.game_mode_id);
      if (args.game_mode)
        add("b.game_mode_name ilike ?", `%${String(args.game_mode)}%`);
      if (args.outcome) add("bp.outcome = ?", args.outcome);
      if (args.deck_hash) add("bp.deck_hash = ?", args.deck_hash);
      // Card filters read the played-card rows (0091): an index probe per
      // card, never a JSON containment scan. round 0 and slot > 0 match
      // what the deck's cards array held (no duel rounds, no tower troop).
      if (args.with_card !== undefined) {
        add(
          `exists (select 1 from battle_participant_card c
                   where c.battle_id = bp.battle_id and c.player_tag = bp.player_tag
                     and c.round = 0 and c.slot > 0 and c.card_id = ?)`,
          Number(args.with_card),
        );
      }
      if (Array.isArray(args.with_cards) && args.with_cards.length > 0) {
        const ids = [...new Set(args.with_cards.map(Number))];
        add(
          `(select count(distinct c.card_id) from battle_participant_card c
             where c.battle_id = bp.battle_id and c.player_tag = bp.player_tag
               and c.round = 0 and c.slot > 0 and c.card_id = any(?)) = ${ids.length}`,
          ids,
        );
      }
      let opponent = null;
      if (args.opponent_tag) {
        try {
          opponent = normalizeTag(String(args.opponent_tag));
        } catch {
          throw new ToolFailure(
            "invalid_tag",
            `Invalid opponent_tag: ${args.opponent_tag}`,
          );
        }
        add(
          `exists (select 1 from battle_participant o
                   where o.battle_id = bp.battle_id and o.side <> bp.side and o.player_tag = ?)`,
          opponent,
        );
      }
      if (args.against_card !== undefined) {
        add(
          `exists (select 1 from battle_participant o
                   join battle_participant_card c
                     on c.battle_id = o.battle_id and c.player_tag = o.player_tag
                   where o.battle_id = bp.battle_id and o.side <> bp.side
                     and c.round = 0 and c.slot > 0 and c.card_id = ?)`,
          Number(args.against_card),
        );
      }
      if (args.cursor !== undefined) {
        // Keyset on (battle_time, battle_id): battles are ordered by when
        // they were PLAYED, never by insert order — the archive backfill
        // made those permanently different.
        const m = /^(.+)\|([0-9a-f]{64})$/.exec(String(args.cursor));
        if (!m || Number.isNaN(Date.parse(m[1]))) {
          throw new ToolFailure(
            "bad_request",
            "Invalid cursor.",
            "Cursors are opaque tokens; restart from the first page.",
          );
        }
        // Integrity: the id half must be a real battle. A forged or
        // corrupted-but-parseable cursor otherwise returns an empty page
        // indistinguishable from end-of-data (round-3 finding). Battles
        // are never deleted, so a genuine cursor always passes.
        const { rows: cursorRow } = await ctx.db.query(
          `select 1 from battle where battle_id = $1`,
          [m[2]],
        );
        if (!cursorRow[0]) {
          throw new ToolFailure(
            "bad_request",
            "Invalid cursor (not issued by this server, or corrupted).",
            "Cursors are opaque tokens; restart from the first page.",
          );
        }
        params.push(m[1], m[2]);
        where.push(
          `(b.battle_time, b.battle_id) < ($${params.length - 1}, $${params.length})`,
        );
      }

      const { rows } = await ctx.db.query(
        `select b.cursor, b.battle_id, b.battle_time, b.type, b.type_class, b.game_mode_id, b.game_mode_name,
                b.arena, b.arena_id, b.league_number,
                b.event_tag, b.tournament_tag, b.deck_selection, b.is_ladder_tournament,
                b.is_hosted_match, b.boat_battle_side, b.new_towers_destroyed,
                b.prev_towers_destroyed, b.remaining_towers,
                bp.player_tag, bp.side, bp.crowns, bp.trophy_change, bp.starting_trophies, bp.deck_hash,
                bp.elixir_leaked, bp.king_tower_hp, bp.princess_tower_hp_1,
                bp.princess_tower_hp_2, bp.outcome, p.name as player_name
         from battle_participant bp
         join battle b on b.battle_id = bp.battle_id
         left join player p on p.player_tag = bp.player_tag
         where ${where.join(" and ")}
         order by b.battle_time desc, b.battle_id desc
         limit ${limit}`,
        params,
      );

      let others = new Map();
      if (rows.length > 0) {
        const ids = rows.map((r) => r.battle_id);
        const sides = rows.map((r) => r.side);
        const { rows: rest } = await ctx.db.query(
          tag
            ? `select o.battle_id, o.player_tag, o.side, o.crowns, o.deck_hash, o.clan_tag,
                  o.king_tower_hp, o.princess_tower_hp_1, o.princess_tower_hp_2, o.elixir_leaked, p.name
           from battle_participant o join player p on p.player_tag = o.player_tag
           where o.battle_id = any($1) and o.player_tag <> $2`
            : `select o.battle_id, o.player_tag, o.side, o.crowns, o.deck_hash, o.clan_tag,
                  o.king_tower_hp, o.princess_tower_hp_1, o.princess_tower_hp_2, o.elixir_leaked, p.name
           from battle_participant o join player p on p.player_tag = o.player_tag
           join unnest($1::text[], $2::int[]) me(battle_id, side)
             on me.battle_id = o.battle_id
           where o.side <> me.side`,
          tag ? [ids, tag] : [ids, sides],
        );
        others = rest.reduce((map, r) => {
          if (!map.has(r.battle_id)) map.set(r.battle_id, []);
          map.get(r.battle_id).push(r);
          return map;
        }, new Map());
      }

      // Decks render from the card rows (0091) for the page's battles;
      // compact needs only rounds_played, which the same rows carry.
      const decks = await renderDecks(
        ctx.db,
        rows.map((r) => r.battle_id),
      );
      const deckOf = (o) => decks.get(`${o.battle_id}|${o.player_tag}`) ?? null;
      const leaked = (v) => (v === null || v === undefined ? null : Number(v));
      let leakRows = 0;
      let floorLosses = 0;
      const battles = rows.map((r) => {
        const rest = others.get(r.battle_id) ?? [];
        // The other side's leak (feedback #58): the log row carries both
        // sides' counters and the record kept both; a caller was paying
        // one battles_query per opponent to reconstruct the pair.
        const shape = (o) => ({
          player_tag: o.player_tag,
          name: o.name,
          // Explicit, so "never captured" is distinguishable from "field not
          // populated on this path" (feedback #14).
          name_known: o.name !== null,
          crowns: o.crowns,
          deck_hash: o.deck_hash,
          clan_tag: o.clan_tag,
          ...roundsPlayed(deckOf(o)),
          ...(compact
            ? {}
            : {
                deck: deckOf(o),
                elixir: elixirOf(
                  leaked(o.elixir_leaked),
                  null,
                  r.type,
                  deckOf(o),
                ),
                tower_hp: towerHpOf(o),
              }),
        });
        const opponents = rest.filter((o) => o.side !== r.side);
        const myLeak = leaked(r.elixir_leaked);
        const oppLeak =
          opponents.length === 1 ? leaked(opponents[0].elixir_leaked) : null;
        if (!compact && myLeak !== null) leakRows++;
        if (
          r.type === "PvP" &&
          r.outcome === "loss" &&
          r.trophy_change === null
        )
          floorLosses++;
        return {
          battle_id: r.battle_id,
          battle_time: r.battle_time.toISOString(),
          ...(tz ? { battle_time_local: formatLocal(r.battle_time, tz) } : {}),
          type: r.type,
          game_mode: { id: r.game_mode_id, name: r.game_mode_name },
          // One shape with trophy_floor.arena and modal_arena (4.0.0):
          // the name has been on every row since 0001, the id since the
          // 0131 backfill (null on a row it never reached).
          arena: { id: r.arena_id, name: r.arena },
          league_number: r.league_number,
          // The contract's fold of type (modes.ts), so no consumer keeps
          // its own copy of the table (3.15.0).
          mode_group: modeGroupOf(r.type),
          // The battle's own facts (0131): which event or tournament, and
          // whether the deck was drafted or the player's own. Compact
          // keeps deck_selection alone, the one that changes what a deck
          // row means.
          ...(compact
            ? { deck_selection: r.deck_selection }
            : {
                context: {
                  event_tag: r.event_tag,
                  tournament_tag: r.tournament_tag,
                  ladder_tournament: r.is_ladder_tournament,
                  hosted: r.is_hosted_match,
                  deck_selection: r.deck_selection,
                },
              }),
          // A boat battle's own story: which side attacked and the towers
          // before, after and left standing.
          ...(r.type_class === "boat" && !compact
            ? {
                boat: {
                  side: r.boat_battle_side,
                  towers_before: r.prev_towers_destroyed,
                  towers_after: r.new_towers_destroyed,
                  remaining: r.remaining_towers,
                },
              }
            : {}),
          me: {
            // Who this row is, when the call did not name one subject
            // (a battle by id, a deck across the corpus).
            ...(tag ? {} : { player_tag: r.player_tag, name: r.player_name }),
            outcome: r.outcome,
            crowns: r.crowns,
            trophy_change: r.trophy_change,
            starting_trophies: r.starting_trophies,
            deck_hash: r.deck_hash,
            ...roundsPlayed(deckOf(r)),
            ...(compact
              ? {}
              : {
                  deck: deckOf(r),
                  elixir: elixirOf(myLeak, oppLeak, r.type, deckOf(r)),
                  tower_hp: towerHpOf(r),
                }),
          },
          teammates: rest.filter((o) => o.side === r.side).map(shape),
          opponents: opponents.map(shape),
        };
      });

      let deckStats;
      if (corpusDeck) {
        // The honest aggregate: counts, W-L, distinct pilots, span.
        // Deliberately NO win rate - a deck's pooled rate describes who
        // plays it (docs/META-INTEL §2); lift with a sample size is an
        // agent tool (battles_meta_decks).
        const { rows: ds } = await ctx.db.query(
          `select count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  count(*) filter (where bp.outcome = 'loss')::int as losses,
                  count(distinct bp.player_tag)::int as players,
                  min(b.battle_time) as first_used,
                  max(b.battle_time) as last_used
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where bp.deck_hash = $1`,
          [String(args.deck_hash)],
        );
        deckStats = {
          battles: ds[0].battles,
          wins: ds[0].wins,
          losses: ds[0].losses,
          players: ds[0].players,
          first_used: ds[0].first_used?.toISOString() ?? null,
          last_used: ds[0].last_used?.toISOString() ?? null,
        };
      }

      let totalCount;
      if (args.include_total === true) {
        // Same filters minus the cursor: the cursor positions a page, the
        // total describes the whole match set.
        const countWhere = where.filter(
          (w) => !w.includes("(b.battle_time, b.battle_id) <"),
        );
        const { rows: cnt } = await ctx.db.query(
          `select count(*)::int as n
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where ${countWhere.join(" and ")}`,
          params.slice(0, countWhere.length),
        );
        totalCount = cnt[0].n;
      }

      // The subject's last-observed name beside its tag: the page's rows
      // carry it when there are any, and an empty page still names who.
      let subjectName = null;
      if (tag) {
        subjectName = rows[0]?.player_name ?? null;
        if (subjectName === null) {
          const { rows: named } = await ctx.db.query(
            `select name from player where player_tag = $1`,
            [tag],
          );
          subjectName = named[0]?.name ?? null;
        }
      }

      // Empty page + a window that ends before the first recorded battle
      // reads as "player was inactive" unless we say otherwise.
      const caveats = [];
      if (battles.length === 0 && to && tag) {
        const { rows: firstRec } = await ctx.db.query(
          `select min(battle_time) as first from battle_participant where player_tag = $1`,
          [tag],
        );
        const first = firstRec[0]?.first;
        if (first && to.getTime() < first.getTime()) {
          caveats.push(
            `window_precedes_recording: the window ends before this player's first recorded battle (${first.toISOString()}); emptiness means no COVERAGE, not inactivity.`,
          );
        }
      }

      return {
        ...(tag ? { player_tag: tag, name: subjectName } : {}),
        ...(byBattle ? { battle_id: String(args.battle_id) } : {}),
        ...(deckStats
          ? { deck_hash: String(args.deck_hash), deck_stats: deckStats }
          : {}),
        applied: appliedBlock({
          window: win.echo,
          limit,
          verbosity: compact ? "compact" : "full",
          mode: args.mode,
          outcome: args.outcome,
          game_mode: args.game_mode,
          game_mode_id: args.game_mode_id,
          opponent_tag: opponent ?? undefined,
          deck_hash: args.deck_hash,
          with_card: args.with_card,
          against_card: args.against_card,
          live: args.live === true ? true : undefined,
        }),
        ...(live ? { live_status: liveStatus(live) } : {}),
        battles,
        ...(totalCount !== undefined ? { total_count: totalCount } : {}),
        // Explicit null = end of results (absent-vs-null was ambiguous).
        next_cursor:
          rows.length === limit
            ? `${rows[rows.length - 1].battle_time.toISOString()}|${rows[rows.length - 1].battle_id}`
            : null,
        notes: notes(
          livePendingNote(live),
          compact ? null : ARCHETYPE_NOTE,
          win.seasonNotes,
          caveats,
          deckStats &&
            "deck_stats carries no pooled win rate by design: a deck's rate describes who plays it; battles_meta_decks has shrunk rates with sample sizes.",
          "Duel rows (riverRaceDuel*) collapse up to three games: crowns sum across rounds, elixir.leaked sums across rounds for both sides (elixir.rounds says how many and elixir.differential is null), tower_hp describes the final round only, deck_hash is null, decks sit under deck.rounds[] and rounds_played says how many.",
          compact
            ? null
            : "Deck card levels are the in-game 1-16 scale; form is the FORM played (base, evolution or hero), never a level; tower_hp is hitpoints REMAINING at the end (null = not reported by the game).",
          leakRows > 0
            ? "elixir is each side's own leaked-elixir counter with its caveat on the object: read elixir.differential (me minus the one opponent, null on duels) before elixir.leaked, and neither as a skill measure."
            : null,
          floorLosses > 0
            ? `${floorLosses} ladder ${floorLosses === 1 ? "loss carries" : "losses carry"} trophy_change null: a loss standing ON the arena's trophy floor costs nothing and the game omits the field, and a loss just above the floor is clamped to it, so trophy sums understate losses for a floored player (battles_performance.trophy_floor names the floor).`
            : null,
        ),
        docs: BATTLE_DOCS,
        meta: await buildMeta(
          ctx.db,
          ctx.account,
          tag ?? rows[0]?.player_tag ?? "#",
          ["player_battlelog"],
          { timezone: tz, windowTo: win.to },
        ),
      };
    },
  },

  battles_performance: {
    description:
      'Computed record over a window: W/L/D, win rate, crowns for/against, net trophies, three-crown rate, streaks, and trophy_floor when the player stood on an arena floor (losses there cost nothing, so net_trophies is asymmetric). compare_from/compare_to or before_after runs a second window server-side for "since X vs before" questions (before_after wins over compare_*); group_by week is the trend view (buckets the window clips are marked partial) and group_by game_mode the "what have I been playing" view.',
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
        display_name: DISPLAY_NAME_SCHEMA,
        ...WINDOW_ARGS,
        season: SEASON_ARG_SCHEMA,
        last_n_battles: {
          type: "integer",
          minimum: 1,
          maximum: 500,
          description: "Sample the most recent N battles instead of a window.",
        },
        mode: MODE_SCHEMA,
        deck_hash: {
          type: "string",
          description: "Only battles on this exact deck (see battles_decks).",
        },
        compare_from: { type: "string", description: WINDOW_FROM_DESC },
        compare_to: { type: "string", description: WINDOW_TO_DESC },
        group_by: {
          type: "string",
          enum: ["week", "game_mode"],
          description:
            "week: weekly series (ISO weeks). game_mode: per named game mode (the row's game_mode, not the mode group; event modes included). Overrides before_after and compare_*.",
        },
        before_after: {
          type: "string",
          description:
            "Date splitting two windows: [from..date) vs [date..to], e.g. before vs after a deck change.",
        },
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = (
        await subject(
          ctx.db,
          ctx.account,
          args.player_tag,
          "summary",
          args.on_behalf_of,
          args.display_name,
        )
      ).tag;
      const win = await resolveSeasonWindow(ctx, args, {
        seasonDefault: false,
      });
      const tz = win.timezone;

      const segment = async ({ from, to, lastN }) => {
        const where = ["bp.player_tag = $1", `bp.outcome is not null`];
        const params = [tag];
        const add = (clause, value) => {
          params.push(value);
          where.push(clause.replace("?", `$${params.length}`));
        };
        if (from) add("bp.battle_time >= ?", from);
        if (to) add("bp.battle_time < ?", to);
        modeClause(args, add);
        if (args.deck_hash) add("bp.deck_hash = ?", args.deck_hash);
        requireOrderedWindow(from, to);
        const {
          rows: [row],
        } = await ctx.db.query(
          `with sample as materialized (
             select bp.outcome, bp.crowns, bp.trophy_change, b.battle_time, b.battle_id,
                    b.type_class, b.type,
                    (select max(o.crowns) from battle_participant o
                     where o.battle_id = bp.battle_id and o.side <> bp.side) as opp_crowns
             from battle_participant bp join battle b on b.battle_id = bp.battle_id
             where ${where.join(" and ")}
             order by b.battle_time desc, b.battle_id desc
             ${lastN ? `limit ${lastN}` : ""}
           ), decided as (
             select outcome, row_number() over w as rn, first_value(outcome) over w as latest
             from sample where outcome in ('win','loss')
             window w as (order by battle_time desc, battle_id desc)
           ), streak as (
             select coalesce(min(rn) filter (where outcome <> latest) - 1, count(*))
                    * case when min(latest) = 'loss' then -1 else 1 end as n
             from decided
           )
           select count(*)::int as battles,
                  count(*) filter (where outcome = 'win')::int as wins,
                  count(*) filter (where outcome = 'loss')::int as losses,
                  count(*) filter (where outcome = 'draw')::int as draws,
                  count(*) filter (where type_class = 'boat')::int as boat_battles,
                  count(*) filter (where outcome = 'win' and type_class = 'pvp')::int as decided_wins,
                  count(*) filter (where outcome = 'loss' and type_class = 'pvp')::int as decided_losses,
                  count(*) filter (where type = any($${params.length + 1}))::int as duel_battles,
                  coalesce(sum(crowns),0)::int as crowns_for,
                  coalesce(sum(opp_crowns),0)::int as crowns_against,
                  coalesce(sum(trophy_change),0)::int as net_trophies,
                  count(*) filter (where outcome in ('win','loss') and type_class = 'pvp'
                                   and type <> all($${params.length + 1}))::int as head_to_head,
                  count(*) filter (where crowns = 3 and type_class = 'pvp'
                                   and type <> all($${params.length + 1}))::int as three_crowns,
                  (select n::int from streak) as current_streak
           from sample`,
          [...params, DUEL_TYPES],
        );
        const {
          three_crowns,
          head_to_head,
          decided_wins,
          decided_losses,
          ...counts
        } = row;
        // Decided = head-to-head wins + losses. Boat attacks (a static
        // defense, no live opponent) and draws stay in `battles` and in
        // W/L/D but never in the win_rate denominator (feedback #23).
        const decided = decided_wins + decided_losses;
        return {
          ...counts,
          decided_battles: decided,
          decided_wins,
          decided_losses,
          win_rate:
            decided > 0 ? Number((decided_wins / decided).toFixed(3)) : null,
          head_to_head_battles: head_to_head,
          // Three crowns means the king tower fell, which only reads as a
          // sweep on a single game; duel rows sum crowns across rounds
          // and boat attacks have no king tower (playtest 2026-09-09).
          three_crown_rate:
            head_to_head > 0
              ? Number((three_crowns / head_to_head).toFixed(3))
              : null,
        };
      };

      if (
        args.last_n_battles !== undefined &&
        (!Number.isInteger(args.last_n_battles) ||
          args.last_n_battles < 1 ||
          args.last_n_battles > 500)
      ) {
        throw new ToolFailure(
          "bad_request",
          `last_n_battles must be an integer from 1 to 500 (got ${args.last_n_battles}).`,
        );
      }
      const { from, to } = win;
      let result;
      const caveats = [];
      if (args.group_by === "game_mode") {
        const where = ["bp.player_tag = $1", "bp.outcome is not null"];
        const params = [tag];
        const add = (clause, value) => {
          params.push(value);
          where.push(clause.replace("?", `$${params.length}`));
        };
        if (from) add("bp.battle_time >= ?", from);
        if (to) add("bp.battle_time < ?", to);
        modeClause(args, add);
        if (args.deck_hash) add("bp.deck_hash = ?", args.deck_hash);
        const { rows } = await ctx.db.query(
          `select b.game_mode_name as game_mode, b.type,
                  count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  count(*) filter (where bp.outcome = 'loss')::int as losses,
                  count(*) filter (where bp.outcome = 'draw')::int as draws,
                  max(b.battle_time) as last_played
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where ${where.join(" and ")}
           group by b.game_mode_name, b.type
           order by count(*) desc`,
          params,
        );
        result = {
          by_mode: rows.map((r) => ({
            game_mode: r.game_mode,
            type: r.type,
            battles: r.battles,
            wins: r.wins,
            losses: r.losses,
            draws: r.draws,
            win_rate:
              r.wins + r.losses > 0
                ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
                : null,
            last_played: r.last_played?.toISOString() ?? null,
          })),
        };
        caveats.push(
          "Rows are keyed by the pair (game_mode, type): the same mode name recurs under different API types, and 'unknown' is the API's own value for some friendly and event battles.",
          "Per-row win_rate is wins/(wins+losses) within that row, boat rows included; filter battles_query by game_mode to drill in.",
        );
        if (args.before_after || args.compare_from || args.compare_to)
          caveats.push(
            "group_by takes precedence; before_after and compare_* were ignored.",
          );
      } else if (args.group_by === "week") {
        const where = ["bp.player_tag = $1", "bp.outcome is not null"];
        const params = [tag];
        const add = (clause, value) => {
          params.push(value);
          where.push(clause.replace("?", `$${params.length}`));
        };
        if (from) add("bp.battle_time >= ?", from);
        if (to) add("bp.battle_time < ?", to);
        modeClause(args, add);
        if (args.deck_hash) add("bp.deck_hash = ?", args.deck_hash);
        // trophy_battles counts the rows that REPORTED a delta and a loss
        // on an arena floor reports none (feedback #61), so the trophy-mode
        // count rides beside it as the denominator for "games played".
        params.push(TROPHY_MODE_TYPES);
        const trophyModes = `$${params.length}`;
        const { rows } = await ctx.db.query(
          `select to_char(date_trunc('week', bp.battle_time), 'IYYY-"W"IW') as iso_week,
                  date_trunc('week', bp.battle_time)::date::text as week_of,
                  count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  count(*) filter (where bp.outcome = 'loss')::int as losses,
                  count(*) filter (where bp.outcome = 'draw')::int as draws,
                  count(*) filter (where b.type = any(${trophyModes}))::int as trophy_mode_battles,
                  count(*) filter (where bp.trophy_change is not null)::int as trophy_battles,
                  coalesce(sum(bp.trophy_change), 0)::int as net_trophies
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where ${where.join(" and ")}
           group by date_trunc('week', bp.battle_time)
           order by date_trunc('week', bp.battle_time)`,
          params,
        );
        // A bucket the window clips is marked (feedback #60): the first
        // row of a days:30 series is usually two thirds of a week shaped
        // exactly like the whole ones, and it anchors the trend.
        const weekly = markPartialWeeks(
          rows.map((r) => ({
            iso_week: r.iso_week,
            week_of: r.week_of,
            battles: r.battles,
            wins: r.wins,
            losses: r.losses,
            draws: r.draws,
            trophy_mode_battles: r.trophy_mode_battles,
            trophy_battles: r.trophy_battles,
            net_trophies: r.net_trophies,
            win_rate:
              r.wins + r.losses > 0
                ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
                : null,
          })),
          { from, to },
        );
        result = { weekly: weekly.rows };
        caveats.push(
          partialWeeksNote(weekly.partial),
          trophyBattlesNote(weekly.rows),
          "week_of is the ISO week's Monday (UTC); win_rate = wins/(wins+losses), draws excluded.",
          "net_trophies sums trophy_battles, the trophy-mode battles (ladder and Path of Legends) that reported a delta; war and event modes carry no trophies, so a rising win_rate with flat trophies usually means war-heavy weeks, and trophy_mode_battles is the count of those battles played.",
        );
        if (args.before_after || args.compare_from || args.compare_to)
          caveats.push(
            "group_by takes precedence; before_after and compare_* were ignored.",
          );
      } else if (args.before_after) {
        const split = resolveInstant(tz, args.before_after);
        if (!split)
          throw new ToolFailure(
            "bad_request",
            `Unparseable before_after: ${args.before_after}`,
          );
        result = {
          before: await segment({ from, to: split }),
          after: await segment({ from: split, to }),
          split_at: split.toISOString(),
        };
        if (args.compare_from || args.compare_to)
          caveats.push(
            "before_after takes precedence; compare_from/compare_to were ignored.",
          );
      } else if (args.compare_from || args.compare_to) {
        const cf = resolveInstant(tz, args.compare_from);
        const ct = resolveInstant(tz, args.compare_to, { endOfDay: true });
        result = {
          window: await segment({ from, to, lastN: args.last_n_battles }),
          compare_window: await segment({ from: cf, to: ct }),
        };
      } else {
        result = {
          window: await segment({ from, to, lastN: args.last_n_battles }),
        };
      }
      const grouped = Boolean(args.group_by);
      // The floor under net_trophies (feedback #59): a player standing on
      // an arena's trophy floor loses nothing on a loss, so the sum counts
      // wins in full and losses at zero. Read once over the window (a
      // last_n_battles sample and the compare windows share the state).
      const floor =
        args.mode && args.mode !== "ladder"
          ? null
          : await trophyFloor(ctx.db, tag, { from, to });
      return {
        player_tag: tag,
        applied: appliedBlock({
          window: win.echo,
          mode: args.mode,
          deck_hash: args.deck_hash,
          last_n_battles:
            args.last_n_battles && !args.before_after && !grouped
              ? args.last_n_battles
              : undefined,
          group_by: args.group_by,
          before_after: !grouped ? args.before_after : undefined,
          compare_window:
            !grouped &&
            !args.before_after &&
            (args.compare_from || args.compare_to)
              ? {
                  from:
                    resolveInstant(tz, args.compare_from)?.toISOString() ??
                    null,
                  to:
                    resolveInstant(tz, args.compare_to, {
                      endOfDay: true,
                    })?.toISOString() ?? null,
                }
              : undefined,
        }),
        ...result,
        ...(floor ? { trophy_floor: floor } : {}),
        notes: notes(
          trophyFloorNote(floor),
          win.seasonNotes,
          caveats,
          grouped
            ? null
            : [
                "win_rate = decided_wins / decided_battles, where decided_battles = decided_wins + decided_losses: boat battles and draws are outside both sides, while wins/losses still count boat wins.",
                "duel_battles collapse up to three games and count crowns once per round, so crowns_for/against mix units when duels are present.",
                "three_crown_rate = three-crown wins / head_to_head_battles, duels and boat battles excluded from both sides.",
              ],
        ),
        docs: DENOMINATOR_DOCS,
        meta: await buildMeta(ctx.db, ctx.account, tag, ["player_battlelog"], {
          timezone: tz,
          windowTo: win.to,
        }),
      };
    },
  },

  battles_cards: {
    description:
      'Per-card win/loss attribution over recorded battles. perspective "mine": which of your cards carry. perspective "opponent": which enemy cards beat you (the nemesis question). Each row carries its battles per mode group and mean_level_gap; modes_in_window and comparable say whether modes with different matchmaking were pooled (pass mode to isolate one). Duels are excluded (no single deck).',
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
        display_name: DISPLAY_NAME_SCHEMA,
        perspective: {
          type: "string",
          enum: ["mine", "opponent"],
          default: "mine",
        },
        ...WINDOW_ARGS,
        season: SEASON_ARG_SCHEMA,
        mode: MODE_SCHEMA,
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = (
        await subject(
          ctx.db,
          ctx.account,
          args.player_tag,
          "summary",
          args.on_behalf_of,
          args.display_name,
        )
      ).tag;
      const win = await resolveSeasonWindow(ctx, args, {
        seasonDefault: false,
      });
      const mine = args.perspective !== "opponent";
      const where = ["bp.player_tag = $1", `bp.outcome in ('win','loss')`];
      const params = [tag];
      const add = (clause, value) => {
        params.push(value);
        where.push(clause.replace("?", `$${params.length}`));
      };
      if (win.from) add("bp.battle_time >= ?", win.from);
      if (win.to) add("bp.battle_time < ?", win.to);
      modeClause(args, add);

      // Cards as rows (0091): mine are this participant's played cards;
      // the opponent's are one opposing participant's (the first by tag,
      // as the JSON path took the first with a deck). round 0, slot > 0:
      // the deck's cards array, no duel rounds, no tower troop.
      const cardSource = mine
        ? `join battle_participant_card pc
             on pc.battle_id = bp.battle_id and pc.player_tag = bp.player_tag`
        : `join lateral (select o.player_tag from battle_participant o
                         where o.battle_id = bp.battle_id and o.side <> bp.side
                           and o.deck_hash is not null
                         order by o.player_tag limit 1) opp on true
           join battle_participant_card pc
             on pc.battle_id = bp.battle_id and pc.player_tag = opp.player_tag`;
      // The control beside each row (feedback #54, 3.13.0): the mean
      // level gap over the battles the card appeared in, and the row's
      // battles by mode group, so a card met mostly in war games does not
      // read as a ladder nemesis.
      const levelSource = `left join lateral (
           select avg(o.deck_avg_level) as lvl from battle_participant o
           where o.battle_id = bp.battle_id and o.side <> bp.side
             and bp.deck_avg_level is not null) lv on true`;
      const { rows } = await ctx.db.query(
        `select c.name, pc.card_id as id, pc.form as evolution,
                count(*) filter (where bp.outcome = 'win')::int as wins,
                count(*) filter (where bp.outcome = 'loss')::int as losses,
                round(avg(bp.deck_avg_level - lv.lvl)::numeric, 2) as mean_level_gap,
                array_agg(b.type) as types
         from battle_participant bp
         join battle b on b.battle_id = bp.battle_id
         ${cardSource}
         ${levelSource}
         join card c on c.card_id = pc.card_id
         where ${where.join(" and ")} and pc.round = 0 and pc.slot > 0
         group by 1, 2, 3
         having count(*) >= 3
         order by count(*) desc
         limit 120`,
        params,
      );
      // The window's own split, for the pooled note: battles and mean
      // level gap per mode group over every battle the rows were drawn
      // from (duels excluded as the rows are).
      const { rows: groups } = await ctx.db.query(
        `select b.type, count(*)::int as battles, count(lv.lvl)::int as level_battles,
                round(avg(bp.deck_avg_level - lv.lvl)::numeric, 2) as mean_level_gap
         from battle_participant bp
         join battle b on b.battle_id = bp.battle_id
         ${levelSource}
         where ${where.join(" and ")} and bp.deck_hash is not null
         group by b.type`,
        params,
      );
      const pooledGroups = modeGaps(groups);
      const guard = args.mode ? null : pooledModesNote(pooledGroups);
      return {
        player_tag: tag,
        applied: appliedBlock({
          window: win.echo,
          perspective: mine ? "mine" : "opponent",
          mode: args.mode,
          min_battles: 3,
        }),
        modes_in_window: Object.fromEntries(
          pooledGroups.map((g) => [
            g.mode,
            { battles: g.battles, mean_level_gap: g.mean_level_gap },
          ]),
        ),
        comparable: guard === null,
        cards: rows.map((r) => ({
          id: Number(r.id),
          name: r.name,
          form: formName(r.evolution),
          battles: r.wins + r.losses,
          wins: r.wins,
          losses: r.losses,
          win_rate: Number((r.wins / (r.wins + r.losses)).toFixed(3)),
          modes: countByMode(r.types),
          mean_level_gap:
            r.mean_level_gap === null ? null : Number(r.mean_level_gap),
        })),
        notes: notes(
          guard,
          win.seasonNotes,
          mine
            ? "win_rate is YOUR record when this card is in your deck."
            : "win_rate is YOUR record when this card appears in the OPPONENT deck; low means nemesis.",
          "Each row's modes counts its battles by mode group and mean_level_gap is your deck's average level minus the opposing side's in those battles; a row's record is comparable to another's only at similar values of both.",
          FORM_ROWS_NOTE,
        ),
        docs: CONTROLS_DOCS,
        meta: await buildMeta(ctx.db, ctx.account, tag, ["player_battlelog"], {
          timezone: win.timezone,
          windowTo: win.to,
        }),
      };
    },
  },

  battles_decks: {
    description:
      "Battles grouped by exact deck identity (deck_hash): per-deck record, win rate, share of battles, first/last used, plus the controls that make a win rate readable: modes (battles per mode group), dominant_mode and mean_level_gap against the opposing side. comparable is false when rows were played in different modes or at gaps half a level apart (war matchmaking flatters a deck), and a note says which. Duels have no single deck and sit under excluded, outside rows and shares. Unbounded by default; pass mode to rank within one mode, a deck_hash to battles_query or battles_performance to drill in.",
    inputSchema: {
      type: "object",
      properties: {
        player_tag: TAG_SCHEMA,
        on_behalf_of: ON_BEHALF_OF_SCHEMA,
        display_name: DISPLAY_NAME_SCHEMA,
        ...WINDOW_ARGS,
        season: SEASON_ARG_SCHEMA,
        mode: MODE_SCHEMA,
        sort: {
          type: "string",
          enum: ["battles", "wins", "win_rate"],
          default: "battles",
          description: "win_rate sorting respects min_battles.",
        },
        min_battles: {
          type: "integer",
          minimum: 1,
          description: "Drop decks with fewer battles than this.",
        },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 40 },
        archetype: ARCHETYPE_ARG,
      },
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const tag = (
        await subject(
          ctx.db,
          ctx.account,
          args.player_tag,
          "summary",
          args.on_behalf_of,
          args.display_name,
        )
      ).tag;
      const win = await resolveSeasonWindow(ctx, args, {
        seasonDefault: false,
      });
      const where = ["bp.player_tag = $1", "bp.deck_hash is not null"];
      const params = [tag];
      const add = (clause, value) => {
        params.push(value);
        where.push(clause.replace("?", `$${params.length}`));
      };
      if (win.from) add("bp.battle_time >= ?", win.from);
      if (win.to) add("bp.battle_time < ?", win.to);
      modeClause(args, add);
      // The control beside the win rate (feedback #54, 3.13.0): the mean
      // level gap against the opposing side (deck_avg_level is stamped at
      // ingest) and the mode split, so a war-only deck's 79% and a
      // ladder-only deck's 42% stop reading as deck quality.
      const { rows } = await ctx.db.query(
        `select bp.deck_hash,
                min(b.battle_time) as first_used, max(b.battle_time) as last_used,
                count(*)::int as battles,
                count(*) filter (where bp.outcome = 'win')::int as wins,
                count(*) filter (where bp.outcome = 'loss')::int as losses,
                count(*) filter (where bp.outcome = 'draw')::int as draws,
                round(avg(bp.deck_avg_level - opp.lvl)::numeric, 2) as mean_level_gap,
                round(avg(opp.lvl)::numeric, 2) as opponent_mean_level,
                round(avg(bp.deck_avg_level) filter (where opp.lvl is not null)::numeric, 2) as own_mean_level,
                count(opp.lvl)::int as level_gap_battles
         from battle_participant bp join battle b on b.battle_id = bp.battle_id
         left join lateral (
           select avg(o.deck_avg_level) as lvl from battle_participant o
           where o.battle_id = bp.battle_id and o.side <> bp.side
             and bp.deck_avg_level is not null) opp on true
         where ${where.join(" and ")}
         group by bp.deck_hash
         order by count(*) desc
         limit 100`,
        params,
      );
      const { rows: byType } = await ctx.db.query(
        `select bp.deck_hash, b.type,
                count(*)::int as battles,
                count(*) filter (where bp.outcome = 'win')::int as wins,
                count(*) filter (where bp.outcome = 'loss')::int as losses
         from battle_participant bp join battle b on b.battle_id = bp.battle_id
         where ${where.join(" and ")}
         group by bp.deck_hash, b.type`,
        params,
      );
      const typesByDeck = new Map();
      for (const r of byType) {
        if (!typesByDeck.has(r.deck_hash)) typesByDeck.set(r.deck_hash, []);
        typesByDeck.get(r.deck_hash).push(r);
      }
      const identities = await deckIdentities(
        ctx.db,
        rows.map((r) => r.deck_hash),
      );
      // The denominator of share_of_battles is every deck-bearing battle
      // in the window (the type split above has no row cap; the deck
      // query keeps 100), and what has no deck is itemized beside it
      // (feedback #63): a duel has no single deck, so it is outside
      // these rows, and battles_performance.battles counts it.
      const totalBattles = byType.reduce((n, r) => n + r.battles, 0);
      const {
        rows: [left],
      } = await ctx.db.query(
        `select count(*) filter (where b.type = any($${params.length + 1}))::int as duels,
                count(*) filter (where not coalesce(b.type = any($${params.length + 1}), false))::int as no_deck
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
          where ${where
            .filter((w) => w !== "bp.deck_hash is not null")
            .join(" and ")} and bp.deck_hash is null`,
        [...params, DUEL_TYPES],
      );
      const excluded = { duels: left.duels, no_deck: left.no_deck };
      const excludedNote =
        excluded.duels + excluded.no_deck > 0
          ? `${[
              excluded.duels > 0
                ? `${excluded.duels} duel ${excluded.duels === 1 ? "battle is" : "battles are"}`
                : null,
              excluded.no_deck > 0
                ? `${excluded.no_deck} ${excluded.no_deck === 1 ? "battle" : "battles"} with no recorded deck ${excluded.no_deck === 1 ? "is" : "are"}`
                : null,
            ]
              .filter(Boolean)
              .join(
                " and ",
              )} outside these rows (a duel has no single deck); total_battles_in_window and share_of_battles are over the ${totalBattles} head-to-head battles with a deck, and battles_performance.battles counts every one.`
          : null;
      let shaped = rows;
      if (args.min_battles) {
        shaped = shaped.filter((r) => r.battles >= args.min_battles);
      }
      // The archetype filter (6.5.0): over the player's decks, by the
      // label each carries; share_of_battles stays over every deck.
      const archetype =
        args.archetype === undefined
          ? null
          : await resolveArchetypeArg(ctx.db, args.archetype);
      if (archetype)
        shaped = shaped.filter((r) =>
          matchesArchetype(identities.get(r.deck_hash)?.archetype, archetype),
        );
      const wr = (r) =>
        r.wins + r.losses > 0 ? r.wins / (r.wins + r.losses) : -1;
      requireEnum(args.sort, ["battles", "wins", "win_rate"], "sort");
      if (args.sort === "wins") shaped.sort((a, z) => z.wins - a.wins);
      else if (args.sort === "win_rate") shaped.sort((a, z) => wr(z) - wr(a));
      const limit = Math.min(Math.max(Number(args.limit ?? 40), 1), 100);
      shaped = shaped.slice(0, limit);
      const decks = shaped.map((r) => {
        const modes = modeSplit(typesByDeck.get(r.deck_hash) ?? []);
        const dominant = dominantMode(modes);
        return {
          deck_hash: r.deck_hash,
          ...(identities.get(r.deck_hash) ?? { cards: [] }),
          battles: r.battles,
          wins: r.wins,
          losses: r.losses,
          draws: r.draws,
          win_rate:
            r.wins + r.losses > 0
              ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
              : null,
          share_of_battles:
            totalBattles > 0
              ? Number((r.battles / totalBattles).toFixed(3))
              : null,
          modes,
          ...(dominant
            ? {
                dominant_mode: dominant.mode,
                dominant_mode_share: dominant.share,
              }
            : {}),
          mean_level_gap:
            r.mean_level_gap === null ? null : Number(r.mean_level_gap),
          own_mean_level:
            r.own_mean_level === null ? null : Number(r.own_mean_level),
          opponent_mean_level:
            r.opponent_mean_level === null
              ? null
              : Number(r.opponent_mean_level),
          level_gap_battles: r.level_gap_battles,
          first_used: r.first_used.toISOString(),
          last_used: r.last_used.toISOString(),
        };
      });
      const guard = comparabilityNote(
        decks.map((d) => ({ ...d, label: shortHash(d.deck_hash) })),
        { what: "deck" },
      );
      const {
        rows: [named],
      } = await ctx.db.query(`select name from player where player_tag = $1`, [
        tag,
      ]);
      return {
        player_tag: tag,
        name: named?.name ?? null,
        applied: appliedBlock({
          window: win.echo,
          mode: args.mode,
          sort: args.sort ?? "battles",
          min_battles: args.min_battles,
          archetype: archetype ?? undefined,
          limit,
        }),
        total_battles_in_window: totalBattles,
        excluded,
        comparable: guard === null,
        decks,
        notes: notes(
          guard,
          ARCHETYPE_NOTE,
          excludedNote,
          win.seasonNotes,
          win.source === "unbounded"
            ? "No window was given, so this is the whole recorded history for the player; pass from/to for a period."
            : null,
          "Deck identity includes each card's form and the tower troop, so two decks with the same eight names can be different decks.",
          "mean_level_gap is this deck's average card level minus the opposing side's over level_gap_battles (positive = you outlevelled them); modes splits the row by mode group, and win rates across rows are comparable only when comparable is true.",
        ),
        docs: CONTROLS_DOCS,
        meta: await buildMeta(ctx.db, ctx.account, tag, ["player_battlelog"], {
          timezone: win.timezone,
          windowTo: win.to,
        }),
      };
    },
  },

  battles_meta_decks: {
    description:
      "Observed deck meta for a named population: segment 'mine' (your clan), 'corpus' (the whole recorded corpus, on purpose) or {clan_tag | player_tag | collection}. Per exact deck identity: decided player-battle observations (not unique matches), record, distinct players, usage share, raw and shrunk win rates. Default window: the current season to date; season selects another. No tier lists: what the recorded data shows, with sample sizes.",
    inputSchema: {
      type: "object",
      properties: {
        segment: SEGMENT_SCHEMA,
        ...WINDOW_ARGS,
        season: SEASON_ARG_SCHEMA,
        mode: MODE_SCHEMA,
        min_battles: {
          type: "integer",
          minimum: 1,
          default: 5,
          description: "Decided observations a deck needs to be listed.",
        },
        sort: {
          type: "string",
          enum: ["battles", "shrunk_win_rate", "players"],
          default: "battles",
        },
        limit: { type: "integer", minimum: 1, maximum: 40, default: 20 },
        trophy_band: META_TROPHY_BAND_SCHEMA,
        containing: {
          ...CARD_IDS_ARG,
          description:
            "Only decks whose played cards include ALL these card ids, any form, tower troop excluded (the with_cards semantics of battles_query). Applied after aggregation: usage_share and decided_battles stay the population's.",
        },
        fit_for: FIT_FOR_SCHEMA,
        archetype: ARCHETYPE_ARG,
        group_by: GROUP_BY_SCHEMA,
      },
      required: ["segment"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const params = [];
      const seg = await segmentFilter(ctx, args, params);
      const win = await resolveSeasonWindow(ctx, args);
      const fit =
        args.fit_for === undefined
          ? null
          : await resolveFitFor(ctx.db, args.fit_for);
      const archetype =
        args.archetype === undefined
          ? null
          : await resolveArchetypeArg(ctx.db, args.archetype);
      const scope = []; // segment + window + mode: the population considered
      if (seg.where) scope.push(seg.where);
      const from = win.from.toISOString();
      params.push(from);
      scope.push(`${seg.timeColumn} >= $${params.length}`);
      const to = win.to;
      if (to) {
        params.push(to);
        scope.push(`${seg.timeColumn} < $${params.length}`);
      }
      requireEnum(args.mode, MODE_GROUPS, "mode");
      if (args.mode) {
        params.push(typesForModeGroup(args.mode));
        scope.push(`bp.type = any($${params.length})`);
      }
      requireEnum(args.trophy_band, TROPHY_BAND_NAMES, "trophy_band");
      if (args.trophy_band)
        scope.push(trophyBandClause(args.trophy_band, params));
      const where = [
        ...scope,
        "bp.deck_hash is not null",
        "bp.outcome in ('win','loss')",
        "bp.type_class = 'pvp'",
      ];
      const minBattles = args.min_battles ?? 5;
      // A corpus read over one season comes from the rollup (0121); a
      // segment or an explicit window scans the raw rows as before. A
      // banded read (0135) comes from the band tables once built.
      const rolled = await seasonRollup(ctx.db, {
        win,
        seg,
        mode: args.mode,
        trophyBand: args.trophy_band ?? null,
      });
      const bandPending = rolled?.pending === true;
      const roll = bandPending ? null : rolled;
      let rows;
      let excluded;
      let prior;
      let totalDecided;
      let totalWins;
      let modeGroups = null;
      let playersInWindow = null;
      if (roll) {
        ({ excluded, prior } = roll);
        rows = await rollupDecks(ctx.db, roll, { minBattles });
        totalDecided = prior.decided;
        totalWins = Math.round((prior.mean ?? 0) * prior.decided);
        playersInWindow = roll.players;
        if (!args.mode) modeGroups = await rollupModeGroups(ctx.db, roll);
      } else {
        await rawScanMemory(ctx.db);
        const { prior: populationPrior, ...breakdown } =
          await excludedBreakdown(ctx.db, scope, params, {
            withPrior: !seg.where,
          });
        excluded = breakdown;
        prior =
          populationPrior ??
          (await seasonPrior(ctx.db, { win, mode: args.mode })) ??
          (await corpusPrior(ctx.db, {
            from,
            to,
            types: args.mode ? typesForModeGroup(args.mode) : null,
          }));
        // The participant carries everything this aggregate needs (0095,
        // 0099: type_class and type); no join to battle.
        // ONE scan, grouped by (deck, type): the per-deck row, its mode
        // split and the window's per-type groups all fold from it (3.16.0);
        // the level gap is the lateral avg battles_decks uses (3.13.0).
        const { rows: byDeckType } = await ctx.db.query(
          `with d as (
             select bp.deck_hash, bp.type, bp.player_tag,
                    count(*)::int as battles,
                    count(*) filter (where bp.outcome = 'win')::int as wins,
                    count(*) filter (where bp.outcome = 'loss')::int as losses,
                    min(bp.battle_time) as first_used,
                    max(bp.battle_time) as last_used,
                    sum(bp.deck_avg_level - lv.lvl) as gap_sum,
                    count(lv.lvl)::int as gap_n
             from battle_participant bp
             left join lateral (
               select avg(o.deck_avg_level) as lvl from battle_participant o
               where o.battle_id = bp.battle_id and o.side <> bp.side
                 and bp.deck_avg_level is not null) lv on true
             where ${where.join(" and ")}
             group by bp.deck_hash, bp.type, bp.player_tag)
           select deck_hash, type,
                  sum(battles)::int as battles, sum(wins)::int as wins, sum(losses)::int as losses,
                  count(distinct player_tag)::int as players,
                  min(first_used) as first_used, max(last_used) as last_used,
                  sum(gap_sum) as gap_sum, sum(gap_n)::int as gap_n,
                  (select count(distinct d2.player_tag)::int from d d2 where d2.deck_hash = d.deck_hash) as deck_players,
                  (select count(distinct d3.player_tag)::int from d d3) as window_players
           from d group by deck_hash, type`,
          params,
        );
        const byDeck = new Map();
        for (const t of byDeckType) {
          const cur = byDeck.get(t.deck_hash) ?? {
            deck_hash: t.deck_hash,
            battles: 0,
            wins: 0,
            losses: 0,
            players: t.deck_players,
            first_used: t.first_used,
            last_used: t.last_used,
            gap_sum: 0,
            gap_n: 0,
            types: [],
          };
          cur.battles += t.battles;
          cur.wins += t.wins;
          cur.losses += t.losses;
          if (t.first_used < cur.first_used) cur.first_used = t.first_used;
          if (t.last_used > cur.last_used) cur.last_used = t.last_used;
          cur.gap_sum += Number(t.gap_sum ?? 0);
          cur.gap_n += t.gap_n;
          cur.types.push(t);
          byDeck.set(t.deck_hash, cur);
        }
        rows = [...byDeck.values()].map((r) => ({
          ...r,
          // + 0 folds a -0 to 0 so the two paths compare equal.
          mean_level_gap:
            r.gap_n > 0 ? Number((r.gap_sum / r.gap_n).toFixed(2)) + 0 : null,
          level_gap_battles: r.gap_n,
        }));
        playersInWindow = byDeckType[0]?.window_players ?? 0;
        totalDecided = rows.reduce((n, r) => n + r.battles, 0);
        totalWins = rows.reduce((n, r) => n + r.wins, 0);
        if (!args.mode) {
          const perType = new Map();
          for (const t of byDeckType) {
            const cur = perType.get(t.type) ?? {
              type: t.type,
              battles: 0,
              gap_sum: 0,
              level_battles: 0,
            };
            cur.battles += t.battles;
            cur.gap_sum += Number(t.gap_sum ?? 0);
            cur.level_battles += t.gap_n;
            perType.set(t.type, cur);
          }
          modeGroups = modeGaps(
            [...perType.values()].map((g) => ({
              ...g,
              mean_level_gap:
                g.level_battles > 0 ? g.gap_sum / g.level_battles : null,
            })),
          );
        }
      }
      if (args.containing) {
        const keep = await decksContaining(ctx.db, args.containing);
        rows = rows.filter((r) => keep.has(r.deck_hash));
      }
      const mean = totalDecided > 0 ? totalWins / totalDecided : 0.5;
      const priorMean = prior.mean ?? 0.5;
      const sufficient = totalDecided >= META_METHODOLOGY.segment_min_decided;
      let shaped = rows
        .filter((r) => r.battles >= minBattles)
        .map((r) => ({
          deck_hash: r.deck_hash,
          battles: r.battles,
          wins: r.wins,
          losses: r.losses,
          players: r.players,
          usage_share:
            totalDecided > 0
              ? Number((r.battles / totalDecided).toFixed(3))
              : null,
          win_rate:
            r.wins + r.losses > 0
              ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
              : null,
          ...(sufficient
            ? {
                shrunk_win_rate: ebShrink(r.wins, r.wins + r.losses, priorMean),
              }
            : {}),
          first_used: r.first_used.toISOString(),
          last_used: r.last_used.toISOString(),
          mean_level_gap:
            r.mean_level_gap === null || r.mean_level_gap === undefined
              ? null
              : Number(r.mean_level_gap),
          level_gap_battles: r.level_gap_battles ?? 0,
        }));
      const sort = args.sort ?? "battles";
      shaped.sort((a, z) =>
        sort === "shrunk_win_rate"
          ? (z.shrunk_win_rate ?? z.win_rate) -
            (a.shrunk_win_rate ?? a.win_rate)
          : sort === "players"
            ? (z.players ?? 0) - (a.players ?? 0)
            : z.battles - a.battles,
      );
      const limit = Math.min(args.limit ?? 20, 40);
      // The archetype filter (6.5.0) reads the label off each identity,
      // so with one asked the identities are fetched for every candidate
      // row and the filter runs before the limit; without one, for the
      // returned rows only, as before.
      // Over the stamp (0148), so the whole population is filtered.
      let archetypeCandidates = null;
      if (archetype) {
        archetypeCandidates = shaped.length;
        const stamps = await deckStamps(
          ctx.db,
          shaped.map((r) => r.deck_hash),
        );
        shaped = shaped.filter((r) =>
          stampMatches(stamps.get(r.deck_hash), archetype),
        );
      }
      // group_by (6.6.0): fold every deck in scope (over min_battles) by
      // its stamp; the deck rows are not returned.
      requireEnum(args.group_by, ["archetype", "family"], "group_by");
      const grouped = args.group_by
        ? await groupByArchetype(ctx.db, {
            groupBy: args.group_by,
            rows: shaped,
            where,
            params,
            withMembers: Boolean(seg.where),
            limit,
          })
        : null;
      if (grouped) shaped = [];
      shaped = shaped.slice(0, limit);
      // The identity's cards come from deck_card (0091), for the returned
      // rows only - no exemplar, no participant JSON. The row's mode
      // split (3.16.0): the rollup's per-group keys, or one group-by over
      // the returned decks' raw rows.
      const hashes = shaped.map((r) => r.deck_hash);
      const identities = await deckIdentities(ctx.db, hashes);
      const modesByDeck = roll
        ? await rollupDeckModes(ctx.db, roll, hashes)
        : new Map(rows.map((r) => [r.deck_hash, r.types]));
      shaped = shaped.map((row) => {
        const modes = modeSplit(modesByDeck.get(row.deck_hash) ?? []);
        return {
          ...row,
          modes,
          dominant_mode: dominantMode(modes),
          ...(identities.get(row.deck_hash) ?? { cards: [] }),
        };
      });
      // The fit (6.4.0): what the player holds rides each card, each
      // row says what it would field at and what upgrades would open,
      // and a row the player cannot field is not in decks[] at all.
      let fitBlock = null;
      let unfieldable = [];
      if (fit) {
        const fielded = await fieldedLevel(ctx.db, fit.tag, {
          from,
          to,
          types: args.mode ? typesForModeGroup(args.mode) : null,
        });
        // What the player already fields, by shape (6.6.0, design §12.2):
        // a row in a family they play costs the least to adopt.
        const { rows: ownDecks } = await ctx.db.query(
          `select distinct deck_hash from battle_participant
           where player_tag = $1 and battle_time >= $2
             and ($3::timestamptz is null or battle_time < $3)
             and ($4::text[] is null or type = any($4))
             and type_class = 'pvp' and deck_hash is not null`,
          [
            fit.tag,
            from,
            to ?? null,
            args.mode ? typesForModeGroup(args.mode) : null,
          ],
        );
        const ownStamps = await deckStamps(
          ctx.db,
          ownDecks.map((r) => r.deck_hash),
        );
        const playsFamily = new Set(
          [...ownStamps.values()].map((st) => st.family),
        );
        const playsLabel = new Set(
          [...ownStamps.values()].map((st) => st.label),
        );
        fitBlock = {
          player_tag: fit.tag,
          collection_as_of: fit.as_of,
          fielded_mean_level: fielded.mean_level,
          fielded_battles: fielded.battles,
          plays: {
            families: [...playsFamily].sort(),
            archetypes: [...playsLabel].sort(),
          },
        };
        shaped = shaped.map((row) => ({
          ...row,
          cards: row.cards.map((c) => ({
            ...c,
            held_level: fit.held.get(c.id)?.level ?? null,
          })),
          fit: {
            ...deckFit(row.cards, fit.held, fielded.mean_level),
            plays_family: playsFamily.has(row.archetype?.family),
            plays_archetype: playsLabel.has(row.archetype?.label),
          },
        }));
        unfieldable = shaped.filter((r) => !r.fit.fieldable);
        shaped = shaped.filter((r) => r.fit.fieldable);
      }
      const clash = comparabilityNote(
        shaped.map((r) => ({ ...r, label: shortHash(r.deck_hash) })),
      );
      // A corpus read says whose neighbourhood it describes (3.16.0).
      const population = seg.where
        ? null
        : await populationBlock(ctx.db, { playersInWindow });
      return {
        applied: appliedBlock({
          segment: seg.echo,
          window: win.echo,
          mode: args.mode,
          trophy_band: args.trophy_band,
          containing: args.containing,
          fit_for: fit?.tag,
          archetype: archetype ?? undefined,
          group_by: args.group_by,
          min_battles: minBattles,
          sort,
          limit,
        }),
        ...(population ? { population } : {}),
        methodology: META_METHODOLOGY,
        decided_battles: totalDecided,
        segment_win_rate: totalDecided > 0 ? Number(mean.toFixed(3)) : null,
        prior_win_rate: Number(priorMean.toFixed(3)),
        prior_basis: prior.mean === null ? "neutral_0.5" : "corpus_window",
        ...(sufficient
          ? {}
          : {
              insufficient_sample: true,
              insufficient_sample_floor: META_METHODOLOGY.segment_min_decided,
            }),
        excluded,
        ...(roll ? { players_as_of: roll.players_as_of } : {}),
        comparable: clash === null,
        ...(modeGroups ? { modes_in_window: modeGroups } : {}),
        ...(fitBlock ? { fit_for: fitBlock } : {}),
        ...(grouped ? { archetypes: grouped.rows } : {}),
        decks: shaped,
        ...(fitBlock ? { unfieldable } : {}),
        notes: notes(
          grouped ? grouped.folded : null,
          fitBlock ? fitNotes(fitBlock, shaped, unfieldable) : NO_FIT_NOTE,
          ARCHETYPE_NOTE,
          archetype
            ? `archetype '${archetype.requested}' resolved to ${archetype.family ? archetype.family.replace("_", " ") : "any family"}${archetype.win_conditions.length ? ` with ${archetype.win_conditions.map((w) => w.name).join(" and ")}` : ""} (${archetype.resolved_from}); the filter ran over all ${archetypeCandidates} decks over min_battles, and decided_battles and usage_share stay the population's.`
            : null,
          clash,
          modeGroups ? pooledModesNote(modeGroups) : null,
          seg.where ? singlePlayerNote(shaped) : null,
          bandPending ? BAND_FALLBACK_NOTE : null,
          args.trophy_band && roll
            ? "excluded counts the season and mode, not the band (a duel or a boat battle has no band); decided_battles and every row are the band's."
            : null,
          SEGMENT_NOTES,
          win.seasonNotes,
          roll?.note,
        ),
        docs: SEGMENT_DOCS,
        meta: responseMeta({
          as_of: new Date().toISOString(),
          ...(win.timezone ? { timezone_applied: win.timezone } : {}),
        }),
      };
    },
  },

  battles_meta_cards: {
    description:
      "Observed card meta for a named population: segment 'mine', 'corpus' or {clan_tag | player_tag | collection}. Per card AND form (forms never merge): usage share among decided player-battle observations, distinct players, raw and shrunk win rates. Default window: the current season to date; season selects another. What the recorded data shows, with sample sizes; never a tier list.",
    inputSchema: {
      type: "object",
      properties: {
        segment: SEGMENT_SCHEMA,
        ...WINDOW_ARGS,
        season: SEASON_ARG_SCHEMA,
        mode: MODE_SCHEMA,
        min_battles: {
          type: "integer",
          minimum: 1,
          default: 10,
          description: "Decided observations a card needs to be listed.",
        },
        sort: {
          type: "string",
          enum: ["usage", "shrunk_win_rate"],
          default: "usage",
        },
        limit: { type: "integer", minimum: 1, maximum: 130, default: 30 },
        trophy_band: META_TROPHY_BAND_SCHEMA,
        cards: {
          ...CARD_IDS_ARG,
          description:
            "Only these card ids (every form of each). Applied after aggregation: usage_share and decided_battles stay the population's; min_battles still applies.",
        },
        fit_for: FIT_FOR_SCHEMA,
      },
      required: ["segment"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const params = [];
      const seg = await segmentFilter(ctx, args, params);
      const win = await resolveSeasonWindow(ctx, args);
      const fit =
        args.fit_for === undefined
          ? null
          : await resolveFitFor(ctx.db, args.fit_for);
      const scope = [];
      if (seg.where) scope.push(seg.where);
      const from = win.from.toISOString();
      params.push(from);
      scope.push(`${seg.timeColumn} >= $${params.length}`);
      const to = win.to;
      if (to) {
        params.push(to);
        scope.push(`${seg.timeColumn} < $${params.length}`);
      }
      requireEnum(args.mode, MODE_GROUPS, "mode");
      if (args.mode) {
        params.push(typesForModeGroup(args.mode));
        scope.push(`bp.type = any($${params.length})`);
      }
      requireEnum(args.trophy_band, TROPHY_BAND_NAMES, "trophy_band");
      if (args.trophy_band)
        scope.push(trophyBandClause(args.trophy_band, params));
      const where = [
        ...scope,
        "bp.deck_hash is not null",
        "bp.outcome in ('win','loss')",
        "bp.type_class = 'pvp'",
      ];
      const minBattles = args.min_battles ?? 10;
      const rolled = await seasonRollup(ctx.db, {
        win,
        seg,
        mode: args.mode,
        trophyBand: args.trophy_band ?? null,
      });
      const bandPending = rolled?.pending === true;
      const roll = bandPending ? null : rolled;
      let rows;
      let excluded;
      let prior;
      let totalDecided;
      let totalWins;
      let modeGroups = null;
      let playersInWindow = null;
      if (roll) {
        ({ excluded, prior } = roll);
        rows = await rollupCards(ctx.db, roll, { minBattles });
        totalDecided = prior.decided;
        totalWins = Math.round((prior.mean ?? 0) * prior.decided);
        playersInWindow = roll.players;
        if (!args.mode) modeGroups = await rollupModeGroups(ctx.db, roll);
      } else {
        await rawScanMemory(ctx.db);
        const { prior: populationPrior, ...breakdown } =
          await excludedBreakdown(ctx.db, scope, params, {
            withPrior: !seg.where,
          });
        excluded = breakdown;
        prior =
          populationPrior ??
          (await seasonPrior(ctx.db, { win, mode: args.mode })) ??
          (await corpusPrior(ctx.db, {
            from,
            to,
            types: args.mode ? typesForModeGroup(args.mode) : null,
          }));
        // Deck-first: the window's participants collapse to (deck, player)
        // pairs, and the identity's cards come from deck_card - one row per
        // card per deck, not one probe per card per participant. A deck's
        // cards are exactly its round-0, slot > 0 played cards, so the
        // counts are the per-participant counts.
        // ONE scan into (deck, player, type) pairs; the card rows, their
        // mode splits and the window's per-type groups fold from the
        // materialised CTE (3.16.0). The level gap is the lateral avg
        // battles_decks uses (3.13.0).
        ({ rows } = await ctx.db.query(
          `with pairs as (
           select bp.deck_hash, bp.player_tag, bp.type,
                  count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  sum(bp.deck_avg_level - lv.lvl) as gap_sum,
                  count(lv.lvl)::int as gap_n
           from battle_participant bp
           left join lateral (
             select avg(o.deck_avg_level) as lvl from battle_participant o
             where o.battle_id = bp.battle_id and o.side <> bp.side
               and bp.deck_avg_level is not null) lv on true
           where ${where.join(" and ")}
           group by bp.deck_hash, bp.player_tag, bp.type),
         totals as (
           select coalesce(sum(battles), 0)::int as decided,
                  coalesce(sum(wins), 0)::int as wins,
                  count(distinct player_tag)::int as players,
                  (select jsonb_agg(jsonb_build_object('type', g.type, 'battles', g.battles,
                                                       'level_battles', g.gap_n,
                                                       'mean_level_gap', g.gap))
                     from (select type, sum(battles)::int as battles, sum(gap_n)::int as gap_n,
                                  round((sum(gap_sum) / nullif(sum(gap_n), 0))::numeric, 2) as gap
                             from pairs group by type) g) as by_type
           from pairs),
         per_type as (
           select dc.card_id, dc.form, p.type,
                  sum(p.battles)::int as battles, sum(p.wins)::int as wins,
                  sum(p.gap_sum) as gap_sum, sum(p.gap_n)::int as gap_n
           from pairs p join deck_card dc on dc.deck_hash = p.deck_hash
           group by dc.card_id, dc.form, p.type),
         per_card as (
           select dc.card_id, dc.form, count(distinct p.player_tag)::int as players
           from pairs p join deck_card dc on dc.deck_hash = p.deck_hash
           group by dc.card_id, dc.form)
         select pt.card_id, c.name, pt.form as evolution,
                sum(pt.battles)::int as battles,
                sum(pt.wins)::int as wins,
                sum(pt.battles - pt.wins)::int as losses,
                pc.players,
                round((sum(pt.gap_sum) / nullif(sum(pt.gap_n), 0))::numeric, 2) as mean_level_gap,
                json_agg(json_build_object('type', pt.type, 'battles', pt.battles,
                                           'wins', pt.wins, 'losses', pt.battles - pt.wins)) as by_type,
                t.decided as total_decided,
                t.wins as total_wins,
                t.players as total_players,
                t.by_type as window_types
         from per_type pt
         join per_card pc on pc.card_id = pt.card_id and pc.form = pt.form
         join card c on c.card_id = pt.card_id
         cross join totals t
         group by pt.card_id, c.name, pt.form, pc.players, t.decided, t.wins, t.players, t.by_type`,
          params,
        ));
        totalDecided = rows[0]?.total_decided ?? 0;
        totalWins = rows[0]?.total_wins ?? 0;
        playersInWindow = rows[0]?.total_players ?? 0;
        if (!args.mode) modeGroups = modeGaps(rows[0]?.window_types ?? []);
      }
      if (args.cards) {
        const keep = new Set(args.cards.map(Number));
        rows = rows.filter((r) => keep.has(Number(r.card_id)));
      }
      const mean = totalDecided > 0 ? totalWins / totalDecided : 0.5;
      const priorMean = prior.mean ?? 0.5;
      const sufficient = totalDecided >= META_METHODOLOGY.segment_min_decided;
      let shaped = rows
        .filter((r) => r.battles >= minBattles)
        .map((r) => ({
          card_id: Number(r.card_id),
          name: r.name,
          form: formName(r.evolution),
          battles: r.battles,
          wins: r.wins,
          losses: r.losses,
          players: r.players,
          usage_share:
            totalDecided > 0
              ? Number((r.battles / totalDecided).toFixed(3))
              : null,
          win_rate:
            r.wins + r.losses > 0
              ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
              : null,
          ...(sufficient
            ? {
                shrunk_win_rate: ebShrink(r.wins, r.wins + r.losses, priorMean),
              }
            : {}),
          mean_level_gap:
            r.mean_level_gap === null || r.mean_level_gap === undefined
              ? null
              : Number(r.mean_level_gap),
          _form: r.evolution,
          _types: r.by_type ?? null,
        }));
      const sort = args.sort ?? "usage";
      shaped.sort((a, z) =>
        sort === "shrunk_win_rate"
          ? (z.shrunk_win_rate ?? z.win_rate) -
            (a.shrunk_win_rate ?? a.win_rate)
          : z.battles - a.battles,
      );
      const limit = Math.min(args.limit ?? 30, 130);
      shaped = shaped.slice(0, limit);
      // The row's mode split (3.16.0): the rollup's per-group keys, or
      // one group-by over the returned cards' raw rows.
      const modesByCard = roll
        ? await rollupCardModes(
            ctx.db,
            roll,
            shaped.map((r) => ({ card_id: r.card_id, form: r._form })),
          )
        : null;
      shaped = shaped.map(({ _form, _types, ...row }) => ({
        ...row,
        modes: modeSplit(
          (modesByCard ? modesByCard.get(`${row.card_id}|${_form}`) : _types) ??
            [],
        ),
        // What the player holds of the card, on the row (6.4.0).
        ...(fit ? { held: heldCard(fit.held, row.card_id, row.form) } : {}),
      }));
      let fitBlock = null;
      if (fit) {
        const fielded = await fieldedLevel(ctx.db, fit.tag, {
          from,
          to,
          types: args.mode ? typesForModeGroup(args.mode) : null,
        });
        fitBlock = {
          player_tag: fit.tag,
          collection_as_of: fit.as_of,
          fielded_mean_level: fielded.mean_level,
          fielded_battles: fielded.battles,
        };
      }
      const clash = comparabilityNote(
        shaped.map((r) => ({ ...r, label: r.name })),
        { what: "card" },
      );
      const population = seg.where
        ? null
        : await populationBlock(ctx.db, { playersInWindow });
      return {
        applied: appliedBlock({
          segment: seg.echo,
          window: win.echo,
          mode: args.mode,
          trophy_band: args.trophy_band,
          cards: args.cards,
          fit_for: fit?.tag,
          min_battles: minBattles,
          sort,
          limit,
        }),
        ...(population ? { population } : {}),
        methodology: META_METHODOLOGY,
        decided_battles: totalDecided,
        segment_win_rate: totalDecided > 0 ? Number(mean.toFixed(3)) : null,
        prior_win_rate: Number(priorMean.toFixed(3)),
        prior_basis: prior.mean === null ? "neutral_0.5" : "corpus_window",
        ...(sufficient
          ? {}
          : {
              insufficient_sample: true,
              insufficient_sample_floor: META_METHODOLOGY.segment_min_decided,
            }),
        excluded,
        ...(roll ? { players_as_of: roll.players_as_of } : {}),
        comparable: clash === null,
        ...(modeGroups ? { modes_in_window: modeGroups } : {}),
        ...(fitBlock ? { fit_for: fitBlock } : {}),
        cards: shaped,
        notes: notes(
          fitBlock ? cardFitNote(fitBlock, shaped) : NO_FIT_NOTE,
          clash,
          modeGroups ? pooledModesNote(modeGroups) : null,
          seg.where ? singlePlayerNote(shaped, { what: "card" }) : null,
          bandPending ? BAND_FALLBACK_NOTE : null,
          args.trophy_band && roll
            ? "excluded counts the season and mode, not the band (a duel or a boat battle has no band); decided_battles and every row are the band's."
            : null,
          SEGMENT_NOTES,
          win.seasonNotes,
          roll?.note,
          FORM_ROWS_NOTE,
          "Card win rates are heavily skill-confounded: compare shrunk rates within similar usage, never across segments.",
        ),
        docs: SEGMENT_DOCS,
        meta: responseMeta({
          as_of: new Date().toISOString(),
          ...(win.timezone ? { timezone_applied: win.timezone } : {}),
        }),
      };
    },
  },

  battles_trends: {
    description:
      "Weekly time series for a named population: segment 'mine', 'corpus' or {clan_tag | player_tag | collection}. Per ISO week: battles, record, aggregate win rate, distinct active players, net trophies, the season the week starts in. Default 12 weeks; weeks, from/to or season set the window; applied.window.crosses marks each season roll inside it. Single-player weekly detail also lives in battles_performance group_by 'week'.",
    inputSchema: {
      type: "object",
      properties: {
        segment: SEGMENT_SCHEMA,
        ...WINDOW_ARGS,
        weeks: {
          type: "integer",
          minimum: 1,
          maximum: 52,
          description: "How many ISO weeks back (default 12); or use from/to.",
        },
        season: SEASON_ARG_SCHEMA,
        mode: MODE_SCHEMA,
      },
      required: ["segment"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const params = [];
      const seg = await segmentFilter(ctx, args, params);
      const where = ["bp.outcome is not null"];
      if (seg.where) where.push(seg.where);
      const win = await resolveSeasonWindow(ctx, args, {
        defaultDays: 12 * 7,
      });
      // Weeks are aligned: the window's start snaps to its ISO Monday so
      // the first row is a whole week.
      params.push(win.from);
      where.push(
        `${seg.timeColumn} >= date_trunc('week', $${params.length}::timestamptz)`,
      );
      if (win.to) {
        params.push(win.to);
        where.push(`${seg.timeColumn} < $${params.length}`);
      }
      requireEnum(args.mode, MODE_GROUPS, "mode");
      if (args.mode) {
        params.push(typesForModeGroup(args.mode));
        where.push(`b.type = any($${params.length})`);
      }
      const { rows } = await ctx.db.query(
        `select w.*,
                (select s.season_month from season s
                  where s.starts_at <= w.week_start + interval '1 day'
                    and s.ends_at > w.week_start + interval '1 day') as season_month
         from (
           select date_trunc('week', b.battle_time) as week_start,
                  to_char(date_trunc('week', b.battle_time), 'IYYY-"W"IW') as iso_week,
                  date_trunc('week', b.battle_time)::date::text as week_of,
                  count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  count(*) filter (where bp.outcome = 'loss')::int as losses,
                  count(distinct bp.player_tag)::int as players,
                  count(*) filter (where b.type = any($${params.length + 1}))::int as trophy_mode_battles,
                  count(*) filter (where bp.trophy_change is not null)::int as trophy_battles,
                  coalesce(sum(bp.trophy_change), 0)::int as net_trophies
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where ${where.join(" and ")}
           group by date_trunc('week', b.battle_time)) w
         order by w.week_start`,
        [...params, TROPHY_MODE_TYPES],
      );
      // The control next to the number (3.16.0): the week's mode split
      // (one more group-by over the same rows), and the buckets the
      // window clips marked with the span they hold.
      const { rows: byType } = await ctx.db.query(
        `select date_trunc('week', b.battle_time)::date::text as week_of, b.type,
                count(*)::int as battles,
                count(*) filter (where bp.outcome = 'win')::int as wins,
                count(*) filter (where bp.outcome = 'loss')::int as losses,
                (select count(distinct bp2.player_tag)::int
                   from battle_participant bp2 join battle b2 on b2.battle_id = bp2.battle_id
                  where ${where.join(" and ").replaceAll("bp.", "bp2.").replaceAll("b.type", "b2.type").replaceAll("b.battle_time", "b2.battle_time")}) as window_players
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
          where ${where.join(" and ")}
          group by 1, 2`,
        params,
      );
      const typesByWeek = new Map();
      for (const t of byType) {
        if (!typesByWeek.has(t.week_of)) typesByWeek.set(t.week_of, []);
        typesByWeek.get(t.week_of).push(t);
      }
      const shaped = rows.map((r) => ({
        iso_week: r.iso_week,
        week_of: r.week_of,
        battles: r.battles,
        wins: r.wins,
        losses: r.losses,
        players: r.players,
        win_rate:
          r.wins + r.losses > 0
            ? Number((r.wins / (r.wins + r.losses)).toFixed(3))
            : null,
        trophy_mode_battles: r.trophy_mode_battles,
        trophy_battles: r.trophy_battles,
        net_trophies: r.net_trophies,
        season_month: r.season_month,
        modes: modeSplit(typesByWeek.get(r.week_of) ?? []),
      }));
      const { rows: weeks, partial } = markPartialWeeks(shaped, {
        from: null,
        to: win.to ? new Date(win.to) : null,
      });
      const population = seg.where
        ? null
        : await populationBlock(ctx.db, {
            playersInWindow: byType[0]?.window_players ?? 0,
          });
      return {
        applied: appliedBlock({
          segment: seg.echo,
          window: win.echo,
          weeks: args.weeks,
          mode: args.mode,
        }),
        ...(population ? { population } : {}),
        weeks,
        notes: notes(
          partialWeeksNote(partial),
          trophyBattlesNote(weeks),
          "Aggregate win_rate over a group moves with COMPOSITION (who played that week) as much as with skill; players per week is the tell.",
          !args.mode && weeks.some((w) => Object.keys(w.modes).length > 1)
            ? "Weeks pool every mode group (modes says which); matchmaking differs by mode, so pass mode before reading win_rate as a trend of strength."
            : null,
          "season_month is the season the week's Tuesday to Sunday fall in; a season rolls on Monday at 10:00 UTC, so a roll week's first hours belong to the season before (applied.window.crosses says where).",
          win.seasonNotes,
          "Recording start dates differ per player, so early weeks may be thin because capture was, not because play was.",
        ),
        docs: docsRef("recording", "completeness"),
        meta: responseMeta({
          as_of: new Date().toISOString(),
          ...(win.timezone ? { timezone_applied: win.timezone } : {}),
        }),
      };
    },
  },

  battles_compare: {
    description:
      "Side-by-side of 2-4 recorded tags (any recorded player): latest snapshot topline plus a shared performance window.",
    inputSchema: {
      type: "object",
      properties: {
        player_tags: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 4,
          description: "Two to four player tags.",
        },
        ...WINDOW_ARGS,
        season: SEASON_ARG_SCHEMA,
      },
      required: ["player_tags"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      if ((args.player_tags ?? []).length > 4)
        throw new ToolFailure("bad_request", "battles_compare needs 2-4 tags.");
      const tags = [];
      for (const raw of args.player_tags ?? []) {
        tags.push((await subject(ctx.db, ctx.account, raw, "summary")).tag);
      }
      if (tags.length < 2)
        throw new ToolFailure("bad_request", "battles_compare needs 2-4 tags.");
      const win = await resolveSeasonWindow(ctx, args, {
        seasonDefault: false,
      });
      const { from, to } = win;
      const players = [];
      for (const tag of tags) {
        const { rows: snap } = await ctx.db.query(
          `select p.name, s.trophies, s.donations, s.battle_count, s.collection_level
           from player p
           left join lateral (
             select * from player_snapshot_daily where player_tag = p.player_tag
               and profile_observed_at is not null
             order by snapshot_date desc, snapshot_kind desc limit 1
           ) s on true where p.player_tag = $1`,
          [tag],
        );
        const params = [tag];
        const where = [
          `bp.player_tag = $1`,
          `bp.outcome in ('win','loss','draw')`,
        ];
        if (from) {
          params.push(from);
          where.push(`bp.battle_time >= $${params.length}`);
        }
        if (to) {
          params.push(to);
          where.push(`bp.battle_time < $${params.length}`);
        }
        const { rows: perf } = await ctx.db.query(
          `select count(*)::int battles,
                  count(*) filter (where bp.outcome = 'win')::int wins,
                  count(*) filter (where bp.outcome = 'loss')::int losses,
                  coalesce(sum(bp.trophy_change), 0)::int net_trophies
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where ${where.join(" and ")}`,
          params,
        );
        players.push({ player_tag: tag, ...snap[0], window: perf[0] });
      }
      return {
        applied: appliedBlock({ window: win.echo, player_tags: tags }),
        players,
        notes: notes(
          win.seasonNotes,
          "window covers RECORDED battles only, and recording start dates differ per player; net_trophies sums recorded trophy changes, not the full ladder delta.",
        ),
        docs: docsRef("recording", "completeness"),
        meta: responseMeta({
          as_of: new Date().toISOString(),
          ...(win.timezone ? { timezone_applied: win.timezone } : {}),
        }),
      };
    },
  },
};
