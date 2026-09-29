import { cardDisplayName, modeGroupSql } from "@elixir-mcp/contracts";
import {
  ARCHETYPE_ARG,
  ARCHETYPE_NOTE,
  DISPLAY_NAME_SCHEMA,
  DUEL_TYPES,
  MODE_SCHEMA,
  ON_BEHALF_OF_SCHEMA,
  SEASON_ARG_SCHEMA,
  TAG_SCHEMA,
  VERBOSITY,
  WINDOW_ARGS,
  appliedBlock,
  buildMeta,
  deckIdentities,
  matchesArchetype,
  notes,
  requireEnum,
  resolveArchetypeArg,
  resolveSeasonWindow,
  subject,
} from "../shared.mjs";
import {
  comparabilityNote,
  dominantMode,
  modeSplit,
  shortHash,
} from "../../controls.mjs";
import { CONTROLS_DOCS, modeClause, ownBattlesClause } from "./common.mjs";

/** Decks from duel rounds listed beside the rows, most rounds first. */
const DUEL_DECKS = 8;

/** A deck in the list (9.12.0): its eight cards as one line of names,
 *  forms prefixed, and its archetype label. A whole history of rows with
 *  eight card objects and the archetype object each reached the 48,000
 *  character result cap at 30 rows; the objects are one call away, by
 *  deck_hash. */
const cardNames = (identity) =>
  (identity?.cards ?? [])
    .map((c) => cardDisplayName({ name: c.name, form: c.form }))
    .join(", ");

export const battles_decks = {
  description:
    "Battles grouped by exact deck identity (deck_hash), one page at a time (offset, next_offset): each row's cards as one line of names, archetype label, record, win rate, share of battles and the controls that make a win rate readable (modes, dominant_mode, mean_level_gap; comparable says whether rows can be ranked). deck_hash returns that one deck with its cards, tower troop and archetype in full. A duel sits under excluded; duel_decks lists its round decks. Unbounded window by default.",
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
      offset: {
        type: "integer",
        minimum: 0,
        default: 0,
        description:
          "Rows of the sorted list to skip: the next page starts at the answer's next_offset (null on the last page).",
      },
      deck_hash: {
        type: "string",
        pattern: "^[0-9a-f]{64}$",
        description:
          "One deck, from a row's deck_hash: its row with the cards (id, name, form), tower troop and archetype in full, and its duel rounds in duel_decks when it was played in duels. The totals stay the window's.",
      },
      archetype: ARCHETYPE_ARG,
      verbosity: VERBOSITY(
        "rows keep the record, win rate, share, dominant_mode and mean_level_gap; modes and the level detail are dropped.",
      ),
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
      if (!clause.includes("?")) return where.push(clause);
      params.push(value);
      where.push(clause.replace("?", `$${params.length}`));
    };
    if (win.from) add("bp.battle_time >= ?", win.from);
    if (win.to) add("bp.battle_time < ?", win.to);
    ownBattlesClause(add);
    modeClause(args, add);
    // One deck (9.12.0): its row, in full; the window's totals stay the
    // window's, so its share of battles reads as in the list.
    const one = args.deck_hash ?? null;
    const compact = args.verbosity === "compact";
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
         cross join lateral (
             -- The other side's level, stamped at ingest (0156).
             select case when bp.deck_avg_level is not null
                         then bp.opp_deck_avg_level end as lvl) opp
         where ${[...where, ...(one ? [`bp.deck_hash = $${params.length + 1}`] : [])].join(" and ")}
         group by bp.deck_hash
         order by count(*) desc, bp.deck_hash`,
      one ? [...params, args.deck_hash] : params,
    );
    const { rows: byType } = await ctx.db.query(
      // The mode group is event-aware (Gym #130): by type alone, the
      // Seasonal Trophy Road's event battles were filed as casual.
      `select bp.deck_hash, b.type, ${modeGroupSql("b.type", "b.event_tag")} as mode_group,
                count(*)::int as battles,
                count(*) filter (where bp.outcome = 'win')::int as wins,
                count(*) filter (where bp.outcome = 'loss')::int as losses
         from battle_participant bp join battle b on b.battle_id = bp.battle_id
         where ${where.join(" and ")}
         group by bp.deck_hash, b.type, 3`,
      params,
    );
    const typesByDeck = new Map();
    for (const r of byType) {
      if (!typesByDeck.has(r.deck_hash)) typesByDeck.set(r.deck_hash, []);
      typesByDeck.get(r.deck_hash).push(r);
    }
    // The denominator of share_of_battles is every deck-bearing battle
    // in the window, and what has no deck is itemized beside it
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
    // A duel's rounds (feedback #363): the duel has no single deck, so it
    // stays outside the rows, but each round is a game on one deck, with
    // its own deck_hash and result (0182; a Clan Wars deck carries no
    // tower troop, so its deck_hash is the eight cards'). Listed beside
    // the rows, so a player's war decks include the one they play only in
    // duels.
    const duelDecks = [];
    if (left.duels > 0) {
      const base = where.filter((w) => w !== "bp.deck_hash is not null");
      const extra = [...params, DUEL_TYPES];
      if (one) extra.push(one);
      const { rows: rounds } = await ctx.db.query(
        `select r.deck_hash, count(*)::int as rounds,
                count(*) filter (where r.outcome = 'win')::int as wins,
                count(*) filter (where r.outcome = 'loss')::int as losses,
                min(bp.battle_time) as first_used, max(bp.battle_time) as last_used
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           join battle_participant_round r
             on r.battle_id = bp.battle_id and r.player_tag = bp.player_tag
          where ${base.join(" and ")} and b.type = any($${params.length + 1})
            and r.deck_hash is not null
            ${one ? `and r.deck_hash = $${params.length + 2}` : ""}
          group by r.deck_hash
          order by count(*) desc, r.deck_hash
          limit ${DUEL_DECKS}`,
        extra,
      );
      const named = await deckIdentities(
        ctx.db,
        rounds.map((r) => r.deck_hash),
      );
      for (const r of rounds)
        duelDecks.push({
          deck_hash: r.deck_hash,
          card_names: cardNames(named.get(r.deck_hash)),
          archetype_label: named.get(r.deck_hash)?.archetype?.label ?? null,
          rounds: r.rounds,
          wins: r.wins,
          losses: r.losses,
          first_used: r.first_used.toISOString(),
          last_used: r.last_used.toISOString(),
        });
    }
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
    // The identities: every row's when the archetype filters, else the
    // page's only (a whole history is hundreds of decks).
    const identities = new Map();
    if (archetype) {
      for (const [h, id] of await deckIdentities(
        ctx.db,
        shaped.map((r) => r.deck_hash),
      ))
        identities.set(h, id);
      shaped = shaped.filter((r) =>
        matchesArchetype(identities.get(r.deck_hash)?.archetype, archetype),
      );
    }
    const wr = (r) =>
      r.wins + r.losses > 0 ? r.wins / (r.wins + r.losses) : -1;
    requireEnum(args.sort, ["battles", "wins", "win_rate"], "sort");
    if (args.sort === "wins") shaped.sort((a, z) => z.wins - a.wins);
    else if (args.sort === "win_rate") shaped.sort((a, z) => wr(z) - wr(a));
    const limit = Math.min(Math.max(Number(args.limit ?? 40), 1), 100);
    const offset = Math.max(Number(args.offset ?? 0), 0);
    const totalDecks = shaped.length;
    shaped = shaped.slice(offset, offset + limit);
    const nextOffset = offset + limit < totalDecks ? offset + limit : null;
    const missing = shaped
      .map((r) => r.deck_hash)
      .filter((h) => !identities.has(h));
    for (const [h, id] of await deckIdentities(ctx.db, missing))
      identities.set(h, id);
    const decks = shaped.map((r) => {
      const modes = modeSplit(typesByDeck.get(r.deck_hash) ?? []);
      const dominant = dominantMode(modes);
      const identity = identities.get(r.deck_hash);
      return {
        deck_hash: r.deck_hash,
        card_names: cardNames(identity),
        archetype_label: identity?.archetype?.label ?? null,
        tower_troop_name: identity?.tower_troop?.name ?? null,
        // The one deck asked for carries its objects in full.
        ...(one ? (identity ?? { cards: [] }) : {}),
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
        ...(compact ? {} : { modes }),
        ...(dominant
          ? {
              dominant_mode: dominant.mode,
              dominant_mode_share: dominant.share,
            }
          : {}),
        mean_level_gap:
          r.mean_level_gap === null ? null : Number(r.mean_level_gap),
        ...(compact
          ? {}
          : {
              own_mean_level:
                r.own_mean_level === null ? null : Number(r.own_mean_level),
              opponent_mean_level:
                r.opponent_mean_level === null
                  ? null
                  : Number(r.opponent_mean_level),
              level_gap_battles: r.level_gap_battles,
            }),
        first_used: r.first_used.toISOString(),
        last_used: r.last_used.toISOString(),
      };
    });
    // Judged on each row's modes whether or not compact serves them.
    const guard = comparabilityNote(
      decks.map((d) => ({
        ...d,
        modes: modeSplit(typesByDeck.get(d.deck_hash) ?? []),
        label: shortHash(d.deck_hash),
      })),
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
        deck_hash: one ?? undefined,
        limit,
        offset,
        verbosity: compact ? "compact" : "full",
      }),
      total_battles_in_window: totalBattles,
      total_decks: totalDecks,
      next_offset: nextOffset,
      excluded,
      comparable: guard === null,
      decks,
      duel_decks: duelDecks,
      notes: notes(
        guard,
        ARCHETYPE_NOTE,
        excludedNote,
        win.seasonNotes,
        win.source === "unbounded"
          ? "No window was given, so this is the whole recorded history for the player; pass from/to for a period."
          : null,
        "Deck identity includes each card's form and the tower troop, so two decks with the same eight names can be different decks (a Clan Wars battle carries no tower troop, so a deck played in war and on Trophy Road is two rows; tower_troop_name tells them apart).",
        nextOffset === null
          ? null
          : `Rows ${offset + 1}-${offset + decks.length} of ${totalDecks} decks; the next page starts at offset ${nextOffset}.`,
        one
          ? null
          : "card_names lists each row's cards, forms prefixed; pass a row's deck_hash for its cards, tower troop and archetype in full.",
        duelDecks.length
          ? "duel_decks are the decks played in duel rounds, each round a game won or lost by its own crowns; a duel counts once in battles_performance and is outside the rows and shares above."
          : null,
        "mean_level_gap is this deck's average card level minus the opposing side's over level_gap_battles (positive = you outlevelled them); modes splits the row by mode group, and win rates across rows are comparable only when comparable is true.",
      ),
      docs: CONTROLS_DOCS,
      meta: await buildMeta(ctx.db, ctx.account, tag, ["player_battlelog"], {
        timezone: win.timezone,
        windowTo: win.to,
      }),
    };
  },
};
