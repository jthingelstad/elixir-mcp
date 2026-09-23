/** The Card of the Week brief: the ONLY source of numbers the writer
 *  gets, built by a program from the readers the tools answer with.
 *
 *  Two windows, and the mail says so. The HEADLINE is the closed game
 *  week (Mon 10:00Z to Mon 10:00Z, the grid every clan shares). The
 *  DEPTH - modes, bands, partners, decks - is the season to date,
 *  because cards_card returns by_mode, by_band and partners only on a
 *  corpus SEASON read: every other window is a raw scan of the
 *  participant heap and the rollup cannot answer it.
 *
 *  Every rate is carried twice, as the rate and as the percentage a
 *  writer would print (usage_share 0.294 and usage_share_pct 29.4).
 *  That is not redundancy: the lint traces a printed number back to the
 *  brief, and a brief that holds only rates makes every percentage in
 *  the issue untraceable - which is exactly the bug that had the editor
 *  deleting true numbers from the Top 100. */
import { accountCtx, callTool } from "./ctx.mjs";
import { tryTool, cardLabel, modeLabel } from "./shared.mjs";
import { rankOf } from "./card-of-week-select.mjs";
import { seasonChartAlt } from "./chart.mjs";

const SITE = "https://elixir.poapkings.com";
const ELITE = "pol-global-top-100";
// A mode or band row under this many decided battles is called thin,
// wherever it appears - in a table, and to the writer that reads it.
const THIN = 2000;
// A season enters the trend only if the corpus that month was large
// enough for its usage share to mean what September's means. Elixir
// recorded 194 decided battles in January and 367,736 in September, so
// "12 percent in June, 31 percent now" is mostly a story about how much
// Elixir was recording - which is not a story about the card.
const TREND_SEASON_FLOOR = 50_000;
const TREND_MIN_SEASONS = 4;
// The two ends of the trophy range, compared only when both are real.
const BAND_FLOOR = 2000;
// A band's own boundaries, as NUMBERS. The band is named `under_5000`
// and a writer naturally says "under 5,000 trophies" - which the lint
// refused, correctly, because 5000 existed only inside a string. The
// boundary is a fact about the band; it belongs in the brief.
const BAND_BOUNDS = {
  under_5000: { trophies_from: 0, trophies_to: 5000 },
  "5000_8000": { trophies_from: 5000, trophies_to: 8000 },
  "8000_11000": { trophies_from: 8000, trophies_to: 11000 },
  "11000_13000": { trophies_from: 11000, trophies_to: 13000 },
  "13000_plus": { trophies_from: 13000, trophies_to: null },
};
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const pctOf = (v, dp = 1) =>
  v == null ? null : Number((Number(v) * 100).toFixed(dp));

/** The asset served for a given DISPLAY width. Mail asks for 64, 96 and
 *  160 CSS pixels; the file behind each is twice that, so a retina
 *  screen has real pixels to draw with instead of upscaling one. The
 *  hero's 160 maps to 285 rather than 320 because 285 is the source
 *  art's own width and inventing pixels above it would only add bytes. */
const ASSET_FOR_DISPLAY = { 64: 128, 96: 192, 160: 285 };

/** Cached card art, never Supercell's CDN: a mail client proxies or
 *  blocks a third-party image, and we do not hotlink in mail. */
export const cardAsset = (cardId, form, displayWidth) =>
  `${SITE}/assets/cards/${cardId}${form === "hero" ? "_hero" : form === "evolution" ? "_evo" : ""}-${ASSET_FOR_DISPLAY[displayWidth] ?? displayWidth}.png`;

const deckCards = (cards = []) =>
  cards.map((c) => ({
    id: c.id,
    name: c.name,
    form: c.form ?? "base",
    label: cardLabel({ name: c.name, form: c.form }),
    icon: cardAsset(c.id, c.form, 64),
  }));

function usageBlock(row, decided) {
  if (!row) return null;
  return {
    battles: row.battles ?? null,
    decided_battles: decided ?? null,
    players: row.players ?? null,
    usage_share: row.usage_share ?? null,
    usage_share_pct: pctOf(row.usage_share),
    win_rate: row.win_rate ?? null,
    win_rate_pct: pctOf(row.win_rate),
  };
}

/** The most counterintuitive thing the program can find, the way the Top
 *  100 chooses its deep cut: a form the elite win more with and everyone
 *  else wins less with, or a mode where usage falls by half. Absence is
 *  a valid answer - a week with nothing surprising says nothing. */
function deepCut({ headline, elite, byMode }) {
  const candidates = [];
  for (const f of elite?.forms ?? []) {
    const mine = (headline?.forms ?? []).find((x) => x.form === f.form);
    if (!mine || f.win_rate == null || mine.win_rate == null) continue;
    const eliteBase = (elite.forms ?? []).find((x) => x.form === "base");
    const corpusBase = (headline.forms ?? []).find((x) => x.form === "base");
    if (f.form === "base" || !eliteBase || !corpusBase) continue;
    const eliteBetter = f.win_rate > eliteBase.win_rate;
    const corpusWorse = mine.win_rate < corpusBase.win_rate;
    if (eliteBetter && corpusWorse)
      candidates.push({
        type: "form_splits_by_skill",
        score:
          f.win_rate -
          eliteBase.win_rate +
          (corpusBase.win_rate - mine.win_rate),
        facts: {
          form: f.form,
          elite_form_win_rate_pct: pctOf(f.win_rate),
          elite_base_win_rate_pct: pctOf(eliteBase.win_rate),
          corpus_form_win_rate_pct: pctOf(mine.win_rate),
          corpus_base_win_rate_pct: pctOf(corpusBase.win_rate),
        },
      });
  }
  const fat = (byMode ?? []).filter((m) => !m.thin);
  if (fat.length >= 2) {
    const hi = fat.reduce((a, b) => (b.usage_share > a.usage_share ? b : a));
    const lo = fat.reduce((a, b) => (b.usage_share < a.usage_share ? b : a));
    if (lo.usage_share > 0 && hi.usage_share / lo.usage_share >= 2)
      candidates.push({
        type: "mode_splits_usage",
        score: hi.usage_share / lo.usage_share / 10,
        facts: {
          high_mode: hi.mode,
          high_usage_pct: hi.usage_share_pct,
          low_mode: lo.mode,
          low_usage_pct: lo.usage_share_pct,
          ratio: Number((hi.usage_share / lo.usage_share).toFixed(1)),
        },
      });
  }
  if (candidates.length === 0) return { type: "none", facts: null };
  return candidates.sort((a, b) => b.score - a.score)[0];
}

export async function buildCardOfWeekBrief({
  db,
  account,
  selection,
  week,
  periodKey,
  now = new Date(),
}) {
  const ctx = accountCtx(db, account);
  const cardId = selection.card.card_id;

  // 1. The closed game week: the headline numbers, and the card row.
  const headlineRead = await callTool(ctx, "cards_card", {
    card_id: cardId,
    segment: "corpus",
    from: week.from.toISOString(),
    to: week.to.toISOString(),
    verbosity: "compact",
  });
  // 2. The season to date: everything the rollup alone can answer.
  const seasonRead = await callTool(ctx, "cards_card", {
    card_id: cardId,
    segment: "corpus",
    season: "current",
  });
  // 3. The top 100, same window, for the contrast.
  const eliteRead = await tryTool(callTool, ctx, "cards_card", {
    card_id: cardId,
    segment: { collection: ELITE },
    season: "current",
  });
  // 4. The top 100's OWN win rate over everything they played, so the
  //    writer can say how much of the elite number is just the players.
  const eliteBaseline = await tryTool(callTool, ctx, "battles_meta_cards", {
    segment: { collection: ELITE },
    season: "current",
    limit: 1,
    verbosity: "compact",
  });

  const card = seasonRead.card ?? headlineRead.card;
  const seasonMonth = seasonRead.applied?.window?.season?.month ?? null;
  const rank = await rankOf(db, { seasonMonth, cardId });

  const headline = {
    ...usageBlock(
      headlineRead.season?.all,
      headlineRead.season?.decided_battles,
    ),
    forms: (headlineRead.season?.forms ?? []).map((f) => ({
      form: f.form,
      ...usageBlock(f, headlineRead.season?.decided_battles),
    })),
  };
  const season = {
    ...usageBlock(seasonRead.season?.all, seasonRead.season?.decided_battles),
    forms: (seasonRead.season?.forms ?? []).map((f) => ({
      form: f.form,
      ...usageBlock(f, seasonRead.season?.decided_battles),
    })),
  };
  const byMode = (seasonRead.season?.by_mode ?? []).map((m) => ({
    // The name a player uses, not the API's key: "ladder" is Trophy Road.
    mode: modeLabel(m.mode_group),
    mode_group: m.mode_group,
    battles: m.all?.battles ?? null,
    decided_battles: m.decided_battles ?? null,
    usage_share: m.all?.usage_share ?? null,
    usage_share_pct: pctOf(m.all?.usage_share),
    win_rate: m.all?.win_rate ?? null,
    win_rate_pct: pctOf(m.all?.win_rate),
    thin: (m.all?.battles ?? 0) < THIN,
  }));
  const byBand = (seasonRead.by_band ?? []).map((b) => ({
    trophy_band: b.trophy_band,
    ...(BAND_BOUNDS[b.trophy_band] ?? {}),
    battles: b.battles ?? null,
    usage_share: b.usage_share ?? null,
    usage_share_pct: pctOf(b.usage_share),
    win_rate: b.win_rate ?? null,
    win_rate_pct: pctOf(b.win_rate),
    mean_level_gap: b.mean_level_gap ?? null,
    thin: (b.battles ?? 0) < THIN,
  }));
  const history = (seasonRead.history ?? []).map((h) => ({
    season_month: h.season?.month ?? null,
    comparable: Number(h.decided_battles ?? 0) >= TREND_SEASON_FLOOR,
    war_season: h.season?.war ?? null,
    battles: h.battles ?? null,
    decided_battles: h.decided_battles ?? null,
    usage_share: h.usage_share ?? null,
    usage_share_pct: pctOf(h.usage_share),
    win_rate: h.win_rate ?? null,
    win_rate_pct: pctOf(h.win_rate),
  }));
  // Partners come back ordered by co-occurrence; the issue wants lift.
  const partners = [...(seasonRead.partners ?? [])]
    .filter((p) => p.lift != null)
    .sort((a, z) => z.lift - a.lift)
    .slice(0, 5)
    .map((p) => ({
      name: p.name,
      form: p.form,
      label: cardLabel({ name: p.name, form: p.form }),
      co_occurrence_rate: p.co_occurrence_rate ?? null,
      co_occurrence_pct: pctOf(p.co_occurrence_rate),
      lift: p.lift,
      players: p.players ?? null,
    }));
  const allDecks = (seasonRead.decks ?? []).map((d) => ({
    deck_hash: d.deck_hash,
    archetype_label: d.archetype?.label ?? null,
    average_elixir: d.archetype?.average_elixir ?? null,
    tower_troop: d.tower_troop?.name ?? null,
    battles: d.battles ?? null,
    players: d.players ?? null,
    win_rate: d.win_rate ?? null,
    win_rate_pct: pctOf(d.win_rate),
    cards: deckCards(d.cards),
  }));
  const decks = allDecks.slice(0, 4);
  // The best of the five most played, when it is not already one of the
  // four shown - which after widening to four is usually the fifth alone.
  const best = [...allDecks]
    .filter((d) => d.win_rate != null)
    .sort((a, z) => z.win_rate - a.win_rate)[0];
  const bestOfFive =
    best && !decks.some((d) => d.deck_hash === best.deck_hash) ? best : null;

  // Played more low and won more high, or the reverse - stated only when
  // BOTH ends are real, and only with the level gap beside it, because
  // that is the one thing that would otherwise explain it.
  const low = byBand.find((b) => b.trophy_band === "under_5000");
  const high = byBand.find((b) => b.trophy_band === "13000_plus");
  const bandContrast =
    low && high && low.battles >= BAND_FLOOR && high.battles >= BAND_FLOOR
      ? {
          low: { band: "under 5,000 trophies", ...low },
          high: { band: "13,000 trophies and up", ...high },
          usage_falls: low.usage_share > high.usage_share,
          win_rises: high.win_rate > low.win_rate,
        }
      : null;

  const elite = eliteRead
    ? {
        ...usageBlock(eliteRead.season?.all, eliteRead.season?.decided_battles),
        forms: (eliteRead.season?.forms ?? []).map((f) => ({
          form: f.form,
          ...usageBlock(f, eliteRead.season?.decided_battles),
        })),
        collection: ELITE,
        // How the best players actually build it. Tiny player counts are
        // the norm here (84 people), so each row carries its own, and
        // the prompt refuses to generalise from a deck two people run.
        decks: (eliteRead.decks ?? []).slice(0, 3).map((d) => ({
          archetype_label: d.archetype?.label ?? null,
          average_elixir: d.archetype?.average_elixir ?? null,
          battles: d.battles ?? null,
          players: d.players ?? null,
          win_rate: d.win_rate ?? null,
          win_rate_pct: pctOf(d.win_rate),
          same_as_corpus_top:
            d.deck_hash === (seasonRead.decks ?? [])[0]?.deck_hash,
        })),
        // What the top 100 win across EVERYTHING, so the card's elite
        // win rate can be read against the players rather than the card.
        baseline_win_rate: eliteBaseline?.segment_win_rate ?? null,
        baseline_win_rate_pct: pctOf(eliteBaseline?.segment_win_rate),
        corpus_win_rate: season.win_rate,
        corpus_win_rate_pct: season.win_rate_pct,
      }
    : null;

  // The trend is a section the record has to EARN. Today one season
  // clears the floor, so there is no trend and no chart; it turns itself
  // on once four dense seasons exist, without anyone editing this.
  const comparable = history.filter((h) => h.comparable);
  const trend =
    comparable.length >= TREND_MIN_SEASONS
      ? { seasons: comparable, floor: TREND_SEASON_FLOOR }
      : null;
  const chartAlt = trend ? seasonChartAlt(comparable, card.name) : null;
  const pop = seasonRead.population ?? headlineRead.population ?? {};

  return {
    kind: "card_of_week",
    generated_at: now.toISOString(),
    period_key: periodKey,
    selection: {
      reason: selection.reason,
      score: selection.score,
      why: selection.why,
      candidates: selection.candidates,
    },
    card: {
      id: card.id,
      name: card.name,
      rarity: card.rarity,
      type: card.type,
      elixir_cost: card.elixir_cost,
      forms_available: card.forms_available ?? [],
      first_seen_in_catalog: card.first_seen_in_catalog ?? null,
      first_played: card.first_played ?? null,
      icons: {
        base: cardAsset(card.id, "base", 160),
        ...(card.forms_available?.includes("hero")
          ? { hero: cardAsset(card.id, "hero", 96) }
          : {}),
        ...(card.forms_available?.includes("evolution")
          ? { evolution: cardAsset(card.id, "evolution", 96) }
          : {}),
      },
      page_url: `${SITE}/cards/${card.id}`,
    },
    windows: {
      headline: {
        from: week.from.toISOString(),
        to: week.to.toISOString(),
        label: week.label,
        from_day: week.from.getUTCDate(),
        to_day: week.to.getUTCDate(),
        month: MONTHS[week.to.getUTCMonth()],
        year: week.to.getUTCFullYear(),
      },
      depth: {
        season_month: seasonMonth,
        label: `season ${seasonMonth} to date`,
      },
    },
    headline,
    season,
    rank,
    history,
    trend,
    by_mode: byMode,
    by_band: byBand,
    band_contrast: bandContrast,
    elite,
    partners,
    decks,
    best_of_five: bestOfFive,
    population: {
      recorded_players: pop.recorded_players ?? null,
      recorded_clans: pop.recorded_clans ?? null,
      players_in_window: pop.players_in_window ?? null,
    },
    deep_cut: deepCut({ headline, elite, byMode }),
    chart: chartAlt ? { alt: chartAlt } : null,
    thin_threshold: THIN,
  };
}
