import { cardDisplayName, deckHash, modeGroupSql } from "@elixir-mcp/contracts";
import {
  ARCHETYPE_ARG,
  ARCHETYPE_NOTE,
  DISPLAY_NAME_SCHEMA,
  DUEL_TYPES,
  MODE_SCHEMA,
  ON_BEHALF_OF_SCHEMA,
  SEASON_ARG_SCHEMA,
  TAG_SCHEMA,
  WINDOW_ARGS,
  appliedBlock,
  buildMeta,
  cardSetIdentities,
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

export const battles_decks = {
  description:
    "Battles grouped by exact deck identity (deck_hash): per-deck record, win rate, share of battles, first/last used, and the controls that make a win rate readable: modes, dominant_mode and mean_level_gap against the opposing side (comparable is false when rows mix modes or level gaps, with a note). A duel has no single deck: it sits under excluded, and duel_decks lists each deck its rounds were played with, by round record. Unbounded by default; pass mode to rank within one mode, a deck_hash to battles_query to drill in.",
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
      if (!clause.includes("?")) return where.push(clause);
      params.push(value);
      where.push(clause.replace("?", `$${params.length}`));
    };
    if (win.from) add("bp.battle_time >= ?", win.from);
    if (win.to) add("bp.battle_time < ?", win.to);
    ownBattlesClause(add);
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
         cross join lateral (
             -- The other side's level, stamped at ingest (0156).
             select case when bp.deck_avg_level is not null
                         then bp.opp_deck_avg_level end as lvl) opp
         where ${where.join(" and ")}
         group by bp.deck_hash
         order by count(*) desc
         limit 100`,
      params,
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
    // A duel's rounds (feedback #363): the duel has no single deck, so it
    // stays outside the rows, but each round is a game on one deck, won or
    // lost by that round's crowns. Listed beside the rows, so a player's
    // war decks include the one they play only in duels (a Clan Wars deck
    // carries no tower troop, so its deck_hash is the eight cards').
    const duelDecks = [];
    if (left.duels > 0) {
      const { rows: rounds } = await ctx.db.query(
        `select bpc.battle_id, bpc.round, b.battle_time,
                array_agg(bpc.card_id || ':' || bpc.form) as pairs,
                max(mine.crowns) as mine, max(theirs.crowns) as theirs
           from battle_participant bp join battle b on b.battle_id = bp.battle_id
           join battle_participant_card bpc
             on bpc.battle_id = bp.battle_id and bpc.player_tag = bp.player_tag
            and bpc.round > 0
           left join battle_participant_round mine
             on mine.battle_id = bp.battle_id and mine.player_tag = bp.player_tag
            and mine.round = bpc.round
           left join battle_participant op
             on op.battle_id = bp.battle_id and op.side <> bp.side
           left join battle_participant_round theirs
             on theirs.battle_id = op.battle_id and theirs.player_tag = op.player_tag
            and theirs.round = bpc.round
          where ${where
            .filter((w) => w !== "bp.deck_hash is not null")
            .join(" and ")} and b.type = any($${params.length + 1})
          group by bpc.battle_id, bpc.round, b.battle_time`,
        [...params, DUEL_TYPES],
      );
      const byKey = new Map();
      for (const r of rounds) {
        if (r.pairs?.length !== 8) continue;
        const key = [...r.pairs].sort().join(",");
        const d = byKey.get(key) ?? {
          pairs: key.split(",").map((p) => {
            const [id, form] = p.split(":").map(Number);
            return { id, form };
          }),
          rounds: 0,
          wins: 0,
          losses: 0,
          first: r.battle_time,
          last: r.battle_time,
        };
        d.rounds += 1;
        if (r.mine !== null && r.theirs !== null && r.mine !== r.theirs)
          d[r.mine > r.theirs ? "wins" : "losses"] += 1;
        if (r.battle_time < d.first) d.first = r.battle_time;
        if (r.battle_time > d.last) d.last = r.battle_time;
        byKey.set(key, d);
      }
      const named = await cardSetIdentities(
        ctx.db,
        new Map([...byKey].map(([k, d]) => [k, d.pairs])),
      );
      // Small beside the rows (a whole history of duels crossed the result
      // cap at 20 with full archetype objects): the most played, labelled.
      for (const [key, d] of [...byKey]
        .sort((a, z) => z[1].rounds - a[1].rounds)
        .slice(0, DUEL_DECKS))
        duelDecks.push({
          deck_hash: deckHash({
            cards: d.pairs.map(({ id, form }) => ({
              id,
              ...(form ? { evolutionLevel: form } : {}),
            })),
          }),
          card_names: (named.get(key)?.cards ?? [])
            .map((c) => cardDisplayName({ name: c.name, form: c.form }))
            .join(", "),
          archetype_label: named.get(key)?.archetype?.label ?? null,
          rounds: d.rounds,
          wins: d.wins,
          losses: d.losses,
          first_used: d.first.toISOString(),
          last_used: d.last.toISOString(),
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
          r.opponent_mean_level === null ? null : Number(r.opponent_mean_level),
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
      duel_decks: duelDecks,
      notes: notes(
        guard,
        ARCHETYPE_NOTE,
        excludedNote,
        win.seasonNotes,
        win.source === "unbounded"
          ? "No window was given, so this is the whole recorded history for the player; pass from/to for a period."
          : null,
        "Deck identity includes each card's form and the tower troop, so two decks with the same eight names can be different decks (a Clan Wars battle carries no tower troop, so a deck played in war and on Trophy Road is two rows).",
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
