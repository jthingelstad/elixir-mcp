/** cards_card - everything the record knows about ONE card, in one call
 *  (5.0.0; docs/reviews/2026-09-19-CARDS-REVIEW.md). Before it, a card
 *  question cost the whole 130-row card meta and a hand search of the
 *  deck rows, and a card's season-by-season history sat in
 *  card_meta_season with no reader. The blocks are read from tables that
 *  exist: the catalog, deck/deck_card (first played per form), the
 *  season rollups (this season, by band, every season) on a corpus read,
 *  the raw participant rows on a segment or an explicit window, and
 *  player_card / battle_participant_card for a clan's members. */
import {
  responseMeta,
  MODE_GROUPS,
  typesForModeGroup,
  cardForms,
  cardType,
  formName,
} from "@elixir-mcp/contracts";
import {
  VERBOSITY,
  MODE_SCHEMA,
  WINDOW_ARGS,
  SEASON_ARG_SCHEMA,
  SEGMENT_SCHEMA,
  SEGMENT_NOTES,
  appliedBlock,
  notes,
  docsRef,
  requireEnum,
  resolveSeasonWindow,
  resolveSegment,
  segmentFilter,
  ebShrink,
  META_METHODOLOGY,
  deckIdentities,
  ARCHETYPE_NOTE,
  decksContaining,
  populationBlock,
} from "./shared.mjs";
import {
  seasonRollup,
  rollupDecks,
  rollupSynergy,
  rawScanMemory,
} from "../meta-season.mjs";
import { resolveCard } from "./synergy.mjs";

const CARD_DOCS = docsRef("cards", "one-card-in-one-call");

/** The decided-observation scope every raw read here shares: segment,
 *  window and mode, pushed onto `params` in one place. */
function scopeClauses(seg, win, args, params) {
  const where = [
    "bp.deck_hash is not null",
    "bp.outcome in ('win','loss')",
    "bp.type_class = 'pvp'",
  ];
  if (seg.where) where.push(seg.where);
  params.push(win.from.toISOString());
  where.push(`${seg.timeColumn} >= $${params.length}`);
  if (win.to) {
    params.push(win.to);
    where.push(`${seg.timeColumn} < $${params.length}`);
  }
  if (args.mode) {
    params.push(typesForModeGroup(args.mode));
    where.push(`bp.type = any($${params.length})`);
  }
  return where;
}
const FORM_ROWS = [
  { form: -1, name: "all" },
  { form: 0, name: "base" },
  { form: 1, name: "evolution" },
  { form: 2, name: "hero" },
];
const rate = (w, l) => (w + l > 0 ? Number((w / (w + l)).toFixed(3)) : null);
const share = (n, d) => (d > 0 ? Number((n / d).toFixed(3)) : null);

/** One usage row: battles, W/L, players, usage share against the
 *  population's decided total, raw and (when the population clears the
 *  floor) shrunk win rate toward the population prior. */
function usageRow(r, decided, prior) {
  const wins = Number(r.wins ?? 0);
  const losses = Number(r.losses ?? 0);
  const battles = Number(r.battles ?? 0);
  const out = {
    battles,
    wins,
    losses,
    players:
      r.players === null || r.players === undefined ? null : Number(r.players),
    usage_share: share(battles, decided),
    win_rate: rate(wins, losses),
  };
  if (
    decided >= META_METHODOLOGY.segment_min_decided &&
    prior !== null &&
    prior !== undefined
  )
    out.shrunk_win_rate = ebShrink(wins, wins + losses, prior);
  return out;
}

export const cardProfileTools = {
  cards_card: {
    description:
      "Everything the record knows about ONE card, in one call, for a named population (segment 'mine', 'corpus' or {clan_tag | player_tag | collection}): the catalog row with type and forms and when each form was first played; this window's usage and win rate, all forms and per form, by mode group; the same by trophy band; every recorded season as a series; the top partners; the most-played decks carrying it; on a clan segment, who played it (and at what level) and who holds it. Anchor by card_id or exact name. Default window: the current season. verbosity compact keeps card, season and history.",
    inputSchema: {
      type: "object",
      properties: {
        card_id: { type: "integer", description: "The card id (preferred)." },
        card: {
          type: "string",
          description:
            "The card by EXACT name (case-insensitive); ambiguous names are refused with candidates.",
        },
        segment: SEGMENT_SCHEMA,
        ...WINDOW_ARGS,
        season: SEASON_ARG_SCHEMA,
        mode: MODE_SCHEMA,
        verbosity: VERBOSITY(
          "keeps card, season and history; drops by_band, partners, decks and members.",
        ),
      },
      required: ["segment"],
      additionalProperties: false,
    },
    async handler(ctx, args) {
      const anchor = await resolveCard(ctx.db, args);
      const compact = args.verbosity === "compact";
      requireEnum(args.mode, MODE_GROUPS, "mode");
      const segment = await resolveSegment(ctx, args);
      const params = [];
      const seg = await segmentFilter(ctx, args, params);
      const segParamCount = params.length;
      const win = await resolveSeasonWindow(ctx, args);
      const modeGroup = args.mode ?? "all";

      // --- card: the catalog row, the type, the record's own dates -----
      const {
        rows: [cat],
      } = await ctx.db.query(
        `select first_seen_at, observed_at from card where card_id = $1`,
        [anchor.id],
      );
      // First played per form: the earliest deck carrying that form
      // (deck.first_seen_at), one indexed read per form; no participant scan.
      const { rows: firstPlayed } = await ctx.db.query(
        `select dc.form, min(d.first_seen_at) as at
         from deck_card dc join deck d on d.deck_hash = dc.deck_hash
         where dc.card_id = $1 group by dc.form`,
        [anchor.id],
      );
      const first = { base: null, evolution: null, hero: null };
      for (const r of firstPlayed) first[formName(r.form)] = r.at.toISOString();
      const card = {
        id: anchor.id,
        name: anchor.name,
        type: cardType(anchor.id),
        rarity: anchor.rarity ?? null,
        elixir_cost: anchor.elixirCost ?? null,
        forms_available: cardForms(anchor.maxEvolutionLevel),
        icon_urls: anchor.iconUrls ?? null,
        first_seen_in_catalog: cat?.first_seen_at?.toISOString() ?? null,
        first_played: first,
      };

      // --- the population: rollup or raw ------------------------------
      const roll = await seasonRollup(ctx.db, {
        win,
        seg,
        mode: args.mode,
      });
      const usage = await seasonUsage(ctx, {
        anchor,
        seg,
        win,
        params,
        args,
        roll,
        modeGroup,
      });

      const out = {
        applied: appliedBlock({
          segment: seg.echo,
          window: win.echo,
          mode: args.mode,
          verbosity: compact ? "compact" : "full",
        }),
        card,
        season: usage.season,
      };
      if (!seg.where)
        out.population = await populationBlock(ctx.db, {
          playersInWindow: usage.playersInWindow,
        });
      const extraNotes = [];

      // --- history: one point per recorded season (corpus only) --------
      if (!seg.where) {
        const { rows } = await ctx.db.query(
          `select cm.season_month, cm.battles, cm.wins, cm.losses, cm.players,
                  t.decided, s.war_season_id
           from card_meta_season cm
           join meta_season_totals t
             on t.season_month = cm.season_month and t.mode_group = cm.mode_group
           join season s on s.season_month = cm.season_month
           where cm.card_id = $1 and cm.form = -1 and cm.mode_group = $2
           order by cm.season_month`,
          [anchor.id, modeGroup],
        );
        out.history = rows.map((r) => ({
          season: { month: r.season_month, war: r.war_season_id },
          decided_battles: r.decided,
          ...usageRow(r, r.decided, null),
        }));
        if (rows.length === 0)
          extraNotes.push(
            "history is empty: no season rollup holds this card in this mode group yet (rollups are rebuilt nightly).",
          );
      } else
        extraNotes.push(
          "history (one point per recorded season) is a corpus series; a segment read carries this window's usage only.",
        );

      if (!compact) {
        // --- by_band (corpus season read only) -------------------------
        if (roll) {
          const { rows } = await ctx.db.query(
            `select b.trophy_band, b.battles, b.wins, b.losses, b.players,
                    round((b.level_gap_sum / nullif(b.level_gap_battles, 0))::numeric, 2) as mean_level_gap,
                    bt.decided, bt.wins as pop_wins
             from card_meta_season_band b
             join meta_season_band_totals bt
               on bt.season_month = b.season_month and bt.mode_group = b.mode_group
              and bt.trophy_band = b.trophy_band
             where b.season_month = $1 and b.mode_group = $2 and b.card_id = $3 and b.form = -1
             order by array_position(array['under_5000','5000_8000','8000_11000','11000_13000','13000_plus'], b.trophy_band)`,
            [roll.month, modeGroup, anchor.id],
          );
          out.by_band = rows.map((r) => ({
            trophy_band: r.trophy_band,
            decided_battles: r.decided,
            mean_level_gap:
              r.mean_level_gap === null ? null : Number(r.mean_level_gap),
            ...usageRow(
              r,
              r.decided,
              r.decided >= META_METHODOLOGY.segment_min_decided
                ? r.pop_wins / r.decided
                : null,
            ),
          }));
          if (rows.length === 0)
            extraNotes.push(
              "by_band is empty: the banded rollup has not been filled for this season yet.",
            );
        } else
          extraNotes.push(
            "by_band (usage by trophy band) is answered from the season rollup on a corpus season read only.",
          );

        // --- partners (corpus season read only; cards_synergy has the rest)
        if (roll) {
          const syn = await rollupSynergy(ctx.db, roll, {
            anchorId: anchor.id,
            anchorForm: -1,
            minPair: 5,
            limit: 8,
            season: win.season,
            types: args.mode ? typesForModeGroup(args.mode) : null,
          });
          const anchorDecks = syn.anchor?.battles ?? 0;
          out.partners = (syn.partners ?? []).map((r) => {
            const co = anchorDecks > 0 ? r.co_battles / anchorDecks : null;
            const base =
              roll.prior.decided > 0
                ? r.baseline_battles / roll.prior.decided
                : null;
            return {
              card_id: Number(r.card_id),
              name: r.name,
              form: formName(r.form),
              co_battles: r.co_battles,
              players: r.players,
              co_occurrence_rate: co === null ? null : Number(co.toFixed(3)),
              lift: co !== null && base ? Number((co / base).toFixed(2)) : null,
            };
          });
        } else
          extraNotes.push(
            "partners ride the corpus season read; cards_synergy answers them for any segment and window.",
          );

        // --- decks: the most-played decks containing the card ------------
        out.decks = await topDecks(ctx, {
          anchor,
          seg,
          params,
          segParamCount,
          win,
          args,
          roll,
          decided: usage.decided,
        });

        // --- members (clan segment only) ---------------------------------
        if (segment.kind === "clan") {
          out.members = await clanMembers(ctx, {
            anchor,
            clanTag: segment.clanTag,
            win,
            args,
          });
        }
      }

      out.methodology = META_METHODOLOGY;
      out.notes = notes(
        `Forms: season.all merges the card's forms; season.forms carries one row per form played (${FORM_ROWS.slice(
          1,
        )
          .map((f) => f.name)
          .join(
            ", ",
          )}); usage_share is the row's decided observations over the population's decided_battles.`,
        "A card's win rate describes who played it as much as the card: compare within one mode and similar mean_level_gap, never across segments.",
        out.decks ? ARCHETYPE_NOTE : null,
        ...extraNotes,
        SEGMENT_NOTES,
        win.seasonNotes,
        roll?.note,
      );
      out.docs = CARD_DOCS;
      out.meta = responseMeta({
        as_of: new Date().toISOString(),
        ...(win.timezone ? { timezone_applied: win.timezone } : {}),
      });
      return out;
    },
  },
};

/** This window's usage of the card: all forms and per form, and (with
 *  mode omitted) the per-mode-group split; from the rollup on a corpus
 *  season read, from the participant rows otherwise. */
async function seasonUsage(
  ctx,
  { anchor, seg, win, params, args, roll, modeGroup },
) {
  if (roll) {
    const { rows } = await ctx.db.query(
      `select cm.mode_group, cm.form, cm.battles, cm.wins, cm.losses, cm.players,
              t.decided, t.wins as pop_wins
       from card_meta_season cm
       join meta_season_totals t
         on t.season_month = cm.season_month and t.mode_group = cm.mode_group
       where cm.season_month = $1 and cm.card_id = $2
         ${args.mode ? "and cm.mode_group = $3" : ""}`,
      args.mode ? [roll.month, anchor.id, modeGroup] : [roll.month, anchor.id],
    );
    const shape = (list) => {
      const byForm = new Map(list.map((r) => [Number(r.form), r]));
      const pop = list[0];
      const decided = pop ? Number(pop.decided) : roll.prior.decided;
      const prior =
        pop && decided >= META_METHODOLOGY.segment_min_decided
          ? Number(pop.pop_wins) / decided
          : null;
      const all = byForm.get(-1);
      return {
        decided_battles: decided,
        all: all ? usageRow(all, decided, prior) : usageRow({}, decided, prior),
        forms: FORM_ROWS.slice(1)
          .filter((f) => byForm.has(f.form))
          .map((f) => ({
            form: f.name,
            ...usageRow(byForm.get(f.form), decided, prior),
          })),
      };
    };
    const main = shape(rows.filter((r) => r.mode_group === modeGroup));
    const season = { mode_group: modeGroup, ...main };
    if (!args.mode) {
      const groups = [...new Set(rows.map((r) => r.mode_group))].filter(
        (g) => g !== "all",
      );
      season.by_mode = groups
        .map((g) => ({
          mode_group: g,
          ...shape(rows.filter((r) => r.mode_group === g)),
        }))
        .filter((g) => g.all.battles > 0)
        .sort((a, z) => z.all.battles - a.all.battles);
    }
    return {
      season,
      decided: main.decided_battles,
      playersInWindow: roll.players,
    };
  }
  // Raw path: the population's decided total, then the card's rows by
  // form (deck_card gives the form of the card in each deck).
  await rawScanMemory(ctx.db);
  const where = scopeClauses(seg, win, args, params);
  const {
    rows: [pop],
  } = await ctx.db.query(
    `select count(*)::int as decided,
            count(*) filter (where bp.outcome = 'win')::int as wins,
            count(distinct bp.player_tag)::int as players
     from battle_participant bp where ${where.join(" and ")}`,
    params,
  );
  params.push(anchor.id);
  const { rows } = await ctx.db.query(
    `select dc.form, bp.type,
            count(*)::int as battles,
            count(*) filter (where bp.outcome = 'win')::int as wins,
            count(*) filter (where bp.outcome = 'loss')::int as losses,
            count(distinct bp.player_tag)::int as players
     from battle_participant bp
     join deck_card dc on dc.deck_hash = bp.deck_hash and dc.card_id = $${params.length}
     where ${where.join(" and ")}
     group by dc.form, bp.type`,
    params,
  );
  const decided = pop?.decided ?? 0;
  const prior =
    decided >= META_METHODOLOGY.segment_min_decided ? pop.wins / decided : null;
  const fold = (list) => {
    const acc = { battles: 0, wins: 0, losses: 0 };
    for (const r of list) {
      acc.battles += r.battles;
      acc.wins += r.wins;
      acc.losses += r.losses;
    }
    return acc;
  };
  // Distinct players over (form, type) rows cannot be summed; the merged
  // row is re-counted once below and the per-form rows carry null.
  const forms = FORM_ROWS.slice(1)
    .map((f) => ({ f, list: rows.filter((r) => Number(r.form) === f.form) }))
    .filter(({ list }) => list.length)
    .map(({ f, list }) => ({
      form: f.name,
      ...usageRow({ ...fold(list), players: null }, decided, prior),
    }));
  const {
    rows: [allPlayers],
  } = await ctx.db.query(
    `select count(distinct bp.player_tag)::int as players
     from battle_participant bp
     join deck_card dc on dc.deck_hash = bp.deck_hash and dc.card_id = $${params.length}
     where ${where.join(" and ")}`,
    params,
  );
  const season = {
    mode_group: modeGroup,
    decided_battles: decided,
    all: usageRow(
      { ...fold(rows), players: allPlayers?.players ?? null },
      decided,
      prior,
    ),
    forms,
  };
  return { season, decided, playersInWindow: pop?.players ?? 0 };
}

/** The most-played decks containing the card in the window: the rollup's
 *  deck rows narrowed to the identities carrying it, or one grouped read
 *  of the participant rows on a segment / explicit window. */
async function topDecks(
  ctx,
  { anchor, seg, params, segParamCount, win, args, roll, decided },
) {
  const keep = await decksContaining(ctx.db, [anchor.id]);
  let rows;
  if (roll) {
    rows = (await rollupDecks(ctx.db, roll, { minBattles: 1 })).filter((r) =>
      keep.has(r.deck_hash),
    );
  } else {
    // The segment's own params (segmentFilter pushed them first), then
    // the scope, then the anchor: a fresh array built the same way.
    const p = params.slice(0, segParamCount);
    const where = scopeClauses(seg, win, args, p);
    p.push(anchor.id);
    where.push(
      `bp.deck_hash in (select a.deck_hash from deck_card a where a.card_id = $${p.length})`,
    );
    const res = await ctx.db.query(
      `select bp.deck_hash, count(*)::int as battles,
              count(*) filter (where bp.outcome = 'win')::int as wins,
              count(*) filter (where bp.outcome = 'loss')::int as losses,
              count(distinct bp.player_tag)::int as players
       from battle_participant bp where ${where.join(" and ")}
       group by bp.deck_hash`,
      p,
    );
    rows = res.rows;
  }
  rows.sort((a, z) => z.battles - a.battles);
  const top = rows.slice(0, 5);
  const identities = await deckIdentities(
    ctx.db,
    top.map((r) => r.deck_hash),
  );
  return top.map((r) => ({
    deck_hash: r.deck_hash,
    battles: r.battles,
    wins: r.wins,
    losses: r.losses,
    players: r.players ?? null,
    usage_share: share(r.battles, decided),
    win_rate: rate(r.wins, r.losses),
    ...(identities.get(r.deck_hash) ?? { cards: [] }),
  }));
}

/** A clan's members and the card: who played it in the window (and at
 *  what level), who holds it and at what level and forms. */
async function clanMembers(ctx, { anchor, clanTag, win, args }) {
  const params = [clanTag, anchor.id, win.from.toISOString()];
  const where = [
    "bp.outcome in ('win','loss')",
    "bp.type_class = 'pvp'",
    "bp.battle_time >= $3",
  ];
  if (win.to) {
    params.push(win.to);
    where.push(`bp.battle_time < $${params.length}`);
  }
  if (args.mode) {
    params.push(typesForModeGroup(args.mode));
    where.push(`bp.type = any($${params.length})`);
  }
  const { rows: played } = await ctx.db.query(
    `select bp.player_tag, p.name,
            count(*)::int as battles,
            count(*) filter (where bp.outcome = 'win')::int as wins,
            count(*) filter (where bp.outcome = 'loss')::int as losses,
            round(avg(c.level)::numeric, 1) as level_played,
            array_agg(distinct c.form) as forms
     from clan_membership cm
     join battle_participant bp on bp.player_tag = cm.player_tag
     join battle_participant_card c
       on c.battle_id = bp.battle_id and c.player_tag = bp.player_tag and c.card_id = $2
     join player p on p.player_tag = bp.player_tag
     where cm.clan_tag = $1 and cm.left_observed_at is null and ${where.join(" and ")}
     group by bp.player_tag, p.name
     order by battles desc`,
    params,
  );
  const { rows: held } = await ctx.db.query(
    `select cm.player_tag, p.name, pc.level, pc.evolution_level, pc.star_level, pc.observed_at,
            exists (select 1 from player_card any_pc where any_pc.player_tag = cm.player_tag) as has_collection
     from clan_membership cm
     join player p on p.player_tag = cm.player_tag
     left join player_card pc on pc.player_tag = cm.player_tag and pc.card_id = $2
     where cm.clan_tag = $1 and cm.left_observed_at is null
     order by pc.level desc nulls last, p.name`,
    [clanTag, anchor.id],
  );
  const withCollection = held.filter((h) => h.has_collection);
  return {
    played: played.map((r) => ({
      player_tag: r.player_tag,
      name: r.name,
      battles: r.battles,
      wins: r.wins,
      losses: r.losses,
      win_rate: rate(r.wins, r.losses),
      level_played: r.level_played === null ? null : Number(r.level_played),
      forms: (r.forms ?? []).map(formName).sort(),
    })),
    held: withCollection
      .filter((h) => h.observed_at !== null)
      .map((h) => ({
        player_tag: h.player_tag,
        name: h.name,
        level: h.level,
        forms_unlocked: cardForms(h.evolution_level),
        star_level: h.star_level ?? null,
        observed_at: h.observed_at.toISOString(),
      })),
    members_with_collection: withCollection.length,
    members: held.length,
  };
}
