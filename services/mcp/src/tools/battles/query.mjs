import { normalizeTag } from "@elixir-mcp/contracts";
import { formatLocal } from "../../time.mjs";
import {
  ARCHETYPE_NOTE,
  DISPLAY_NAME_SCHEMA,
  MODE_SCHEMA,
  ON_BEHALF_OF_SCHEMA,
  SEASON_ARG_SCHEMA,
  TAG_SCHEMA,
  ToolFailure,
  VERBOSITY,
  WINDOW_ARGS,
  appliedBlock,
  buildMeta,
  livePendingNote,
  liveRead,
  liveStatus,
  notes,
  renderDecks,
  requireEnum,
  resolveSeasonWindow,
  subject,
} from "../shared.mjs";
import { modeGroupOf } from "../../controls.mjs";
import {
  BATTLE_DOCS,
  durationOf,
  elixirOf,
  isDuel,
  modeClause,
  roundResultsOf,
  roundsPlayed,
  towerHpOf,
  versusOf,
} from "./common.mjs";

export const battles_query = {
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
        description:
          "Battles per page; above 25 needs verbosity: 'compact'. A FULL page is large - both sides' decks, tower hitpoints, elixir, the comparison block and a duel's rounds - and around ten battles can reach the 48,000-character result cap on a rich page. The refusal when it does names a limit that fits; compact keeps deck_hash, crowns and the outcome.",
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
      if (!clause.includes("?")) return where.push(clause);
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
        `(bp.battle_time, bp.battle_id) < ($${params.length - 1}, $${params.length})`,
      );
    }

    // Ordered on the PARTICIPANT's copy of battle_time (review 3.3 moved
    // the window there; the order stayed on the battle table until
    // 2026-09-21, when the acceptance suite found limit: 1 for the most-
    // recorded player timing out at 24 s: the planner walked the battle
    // table's time index backwards probing each row for the player).
    // The (player_tag, battle_time) covering index now serves the
    // ordered scan directly; the two columns are equal by construction.
    const { rows } = await ctx.db.query(
      `select b.cursor, b.battle_id, b.battle_time, b.type, b.type_class, b.game_mode_id, b.game_mode_name,
                b.arena, b.arena_id, b.league_number,
                b.event_tag, b.tournament_tag, b.deck_selection, b.is_ladder_tournament,
                b.is_hosted_match, b.boat_battle_side, b.new_towers_destroyed,
                b.prev_towers_destroyed, b.remaining_towers,
                bp.player_tag, bp.side, bp.crowns, bp.trophy_change, bp.starting_trophies, bp.deck_hash,
                bp.elixir_leaked, bp.king_tower_hp, bp.princess_tower_hp_1,
                bp.princess_tower_hp_2, bp.global_rank, bp.deck_avg_level,
                bp.outcome, p.name as player_name
         from battle_participant bp
         join battle b on b.battle_id = bp.battle_id
         left join player p on p.player_tag = bp.player_tag
         where ${where.join(" and ")}
         order by bp.battle_time desc, bp.battle_id desc
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
                  o.king_tower_hp, o.princess_tower_hp_1, o.princess_tower_hp_2,
                  o.elixir_leaked, o.global_rank, o.deck_avg_level,
                  o.starting_trophies, p.name
           from battle_participant o join player p on p.player_tag = o.player_tag
           where o.battle_id = any($1) and o.player_tag <> $2`
          : `select o.battle_id, o.player_tag, o.side, o.crowns, o.deck_hash, o.clan_tag,
                  o.king_tower_hp, o.princess_tower_hp_1, o.princess_tower_hp_2,
                  o.elixir_leaked, o.global_rank, o.deck_avg_level,
                  o.starting_trophies, p.name
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
    // The tower troop's level (slot 0, rendered as supportCards): towers
    // one level apart start 1,564 HP apart (Gym #97).
    const towerLevel = (o) => deckOf(o)?.supportCards?.[0]?.level ?? null;
    // A duel's round results (0151). Only a duel has them, and only
    // full verbosity carries them, so the read is skipped entirely on
    // a page without one.
    const roundRows = new Map();
    if (!compact && rows.some((r) => isDuel(r.type))) {
      const { rows: rr } = await ctx.db.query(
        `select battle_id, player_tag, round, crowns, king_tower_hp,
                  princess_tower_hp_1, princess_tower_hp_2, elixir_leaked
             from battle_participant_round
            where battle_id = any($1)
            order by player_tag, round`,
        [rows.filter((r) => isDuel(r.type)).map((r) => r.battle_id)],
      );
      for (const x of rr) {
        const k = `${x.battle_id}|${x.player_tag}`;
        if (!roundRows.has(k)) roundRows.set(k, []);
        roundRows.get(k).push(x);
      }
    }
    const roundsFor = (o) => roundRows.get(`${o.battle_id}|${o.player_tag}`);
    const leaked = (v) => (v === null || v === undefined ? null : Number(v));
    // A duel's leaked elixir is the SUM of its games, as the note, the
    // outputSchema and the docs say (Gym #96): the API's top-level
    // counter is the final game's. The per-game rows carry each; a duel
    // recorded before them keeps the counter it has.
    const leakOf = (o) => {
      const rounds = roundsFor(o); // loaded for duel battles only
      const games = (rounds ?? [])
        .map((g) => leaked(g.elixir_leaked))
        .filter((v) => v !== null);
      return games.length
        ? Number(games.reduce((a, v) => a + v, 0).toFixed(2))
        : leaked(o.elixir_leaked);
    };
    let leakRows = 0;
    let towerGapRows = 0;
    let towerUnknownRows = 0;
    let warVsRows = 0;
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
        // Their global leaderboard position at battle time, null
        // unless they were ranked then (0151).
        global_rank: o.global_rank ?? null,
        ...roundsPlayed(deckOf(o)),
        ...(compact
          ? {}
          : {
              deck: deckOf(o),
              elixir: elixirOf(leakOf(o), null, r.type, deckOf(o)),
              tower_hp: towerHpOf(o),
              ...(roundsFor(o)
                ? { rounds: roundResultsOf(roundsFor(o), undefined) }
                : {}),
            }),
      });
      const opponents = rest.filter((o) => o.side !== r.side);
      const myLeak = leakOf(r);
      const oppLeak = opponents.length === 1 ? leakOf(opponents[0]) : null;
      if (!compact && myLeak !== null) leakRows++;
      if (!compact && opponents.length === 1 && !isDuel(r.type)) {
        const a = towerLevel(r);
        const b = towerLevel(opponents[0]);
        if (a !== null && b !== null && a !== b) towerGapRows++;
        // River race rows record no support cards on either side (#150),
        // so the level is unknown there - which is not "equal".
        if (a === null || b === null) towerUnknownRows++;
        if (/^riverRace/.test(String(r.type)) && r.starting_trophies !== null)
          warVsRows++;
      }
      if (r.type === "PvP" && r.outcome === "loss" && r.trophy_change === null)
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
        mode_group: modeGroupOf(r.type, r.event_tag),
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
        // Compact keeps the side (Gym #263: a sweep could not tell an
        // attack from a defense, which is not the member's battle).
        ...(r.type_class === "boat"
          ? compact
            ? { boat: { side: r.boat_battle_side } }
            : {
                boat: {
                  side: r.boat_battle_side,
                  towers_before: r.prev_towers_destroyed,
                  towers_after: r.new_towers_destroyed,
                  remaining: r.remaining_towers,
                },
              }
          : {}),
        // What the signature proves about the battle itself. The log
        // carries no duration; the crown pair bounds it.
        ...(compact
          ? {}
          : {
              inferred: {
                duration:
                  opponents.length === 1
                    ? durationOf(r, opponents[0], r.type)
                    : null,
              },
            }),
        me: {
          // Who this row is, when the call did not name one subject
          // (a battle by id, a deck across the corpus).
          ...(tag ? {} : { player_tag: r.player_tag, name: r.player_name }),
          outcome: r.outcome,
          crowns: r.crowns,
          trophy_change: r.trophy_change,
          starting_trophies: r.starting_trophies,
          global_rank: r.global_rank ?? null,
          deck_hash: r.deck_hash,
          ...roundsPlayed(deckOf(r)),
          ...(compact
            ? {}
            : {
                deck: deckOf(r),
                elixir: elixirOf(myLeak, oppLeak, r.type, deckOf(r)),
                tower_hp: towerHpOf(r),
                ...(roundsFor(r)
                  ? {
                      rounds: roundResultsOf(
                        roundsFor(r),
                        opponents.length === 1
                          ? roundsFor(opponents[0])
                          : undefined,
                      ),
                    }
                  : {}),
                // The differences the row always held both halves of.
                vs:
                  opponents.length === 1
                    ? versusOf(
                        { ...r, tower_level: towerLevel(r) },
                        {
                          ...opponents[0],
                          tower_level: towerLevel(opponents[0]),
                        },
                        r.type,
                      )
                    : null,
              }),
        },
        teammates: rest.filter((o) => o.side === r.side).map(shape),
        opponents: opponents.map(shape),
      };
    });

    // The whole match set: the page's filters minus the cursor (the
    // cursor positions a page; the total and deck_stats describe every
    // page). Parameters up to the highest one the clauses name.
    const setWhere = where.filter(
      (w) => !w.includes("(bp.battle_time, bp.battle_id) <"),
    );
    const setParams = params.slice(
      0,
      Math.max(
        0,
        ...[...setWhere.join(" ").matchAll(/\$(\d+)/g)].map((m) =>
          Number(m[1]),
        ),
      ),
    );

    let deckStats;
    if (corpusDeck) {
      // The honest aggregate over THIS call's match set (feedback #149:
      // it had counted the deck's lifetime whatever the window and
      // filters said): counts, W-L, distinct pilots, span. Deliberately
      // NO win rate - a deck's pooled rate describes who plays it
      // (docs/archive/META-INTEL.md §2); lift with a sample size is an agent tool
      // (battles_meta_decks).
      const { rows: ds } = await ctx.db.query(
        `select count(*)::int as battles,
                  count(*) filter (where bp.outcome = 'win')::int as wins,
                  count(*) filter (where bp.outcome = 'loss')::int as losses,
                  count(distinct bp.player_tag)::int as players,
                  min(b.battle_time) as first_used,
                  max(b.battle_time) as last_used
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where ${setWhere.join(" and ")}`,
        setParams,
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
      const { rows: cnt } = await ctx.db.query(
        `select count(*)::int as n
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           where ${setWhere.join(" and ")}`,
        setParams,
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
          "deck_stats counts the battles this call matches (its window, mode and other filters; every page, not this one) and carries no pooled win rate by design: a deck's rate describes who plays it; battles_meta_decks has shrunk rates with sample sizes.",
        "me.vs is every comparison the row already held both halves of, as me MINUS the one opponent: crowns, deck_level (the level edge in THIS battle, from the cards as played), starting_trophies (on ladder, what matchmaking paired), tower_hp (hitpoints REMAINING on both sides) and tower_level (the tower troop's level). tower_hp is a margin of victory only when tower_level is 0. Null on 2v2, duels and boat battles (a defense against an attack), and a field is null where the record lacks a side's value. Read these before the absolute numbers - a leak, a level or a tower total means little except against the other side's.",
        towerGapRows > 0
          ? `${towerGapRows} ${towerGapRows === 1 ? "row's towers" : "rows' towers"} started unequal (tower levels differ; vs.tower_level is not 0): a tower one level higher starts with more hitpoints (1,564 more across the three towers at 16 against 15), so vs.tower_hp there carries the starting gap as well as the damage - it is not a margin of victory.`
          : null,
        towerUnknownRows > 0
          ? `${towerUnknownRows} ${towerUnknownRows === 1 ? "row carries" : "rows carry"} no tower level on one side or both (vs.tower_level null: river race rows record no support cards), so those towers may have started unequal and vs.tower_hp there is not a margin of victory.`
          : null,
        warVsRows > 0
          ? `On river race rows, starting_trophies is each side's Trophy Road count, and war matchmaking draws opponents from the racing clans without pairing on it, so vs.starting_trophies there is not what matchmaking paired (on ladder it is).`
          : null,
        "inferred.duration is what the battle's signature PROVES about its length, never a measurement: the log carries no duration. A King Tower is the only way to end before regulation, so a three-crown finish is at_most_s 300 with no floor; any other finish ran at least 180 s; and level crowns means overtime expired and the tiebreaker resolved it, which is exactly 300 s. Head-to-head 1v1 only - a duel sums crowns over up to three games and a boat battle has no overtime - basis is which rule fired: king_tower_fell (a King Tower ended it, so nothing bounds it below), regulation_ran (no King Tower, so it reached at least 3:00; whether it ended there or in overtime is not recorded) or overtime_expired.",
        "global_rank is the player's global leaderboard position as the API reported it ON that battle - null unless they were ranked at the time, and not a rank in this record: it says you met a ranked opponent, never how they rank now.",
        "Duel rows (riverRaceDuel*) collapse up to three games: crowns sum across rounds, elixir.leaked sums across rounds for both sides (elixir.rounds says how many and elixir.differential is null), tower_hp describes the final round only, deck_hash is null, decks sit under deck.rounds[] and rounds_played says how many. rounds[] carries each GAME's own result - crowns, tower_hp and elixir with its own differential - on the same round numbers deck.rounds[] uses, so read it rather than the summed values when the question is about one game (6.16.0; empty on a duel recorded before the round results were kept).",
        compact
          ? null
          : "Deck card levels are the in-game 1-16 scale; form is the FORM played (base, evolution or hero), never a level; tower_hp is hitpoints REMAINING at the end (null = not reported by the game).",
        leakRows > 0
          ? "elixir is each side's own leaked-elixir counter with its caveat on the object: read elixir.differential (me minus the one opponent, null on duels - a duel's per-round differentials ride rounds[]) before elixir.leaked, and neither as a skill measure."
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
};
