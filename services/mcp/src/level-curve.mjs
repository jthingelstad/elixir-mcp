// One population and one level precision for personal and clan scores.
// deck_avg_level is stamped at ingest (0025), to two decimal places.
export const LEVEL_EDGES_SQL =
  "array[-2.5,-1.5,-1.0,-0.6,-0.3,-0.1,0.1,0.3,0.6,1.0,1.5,2.5]";

export function medianSortedScores(scores) {
  if (!scores.length) return null;
  const middle = Math.floor(scores.length / 2);
  return scores.length % 2
    ? scores[middle]
    : (scores[middle - 1] + scores[middle]) / 2;
}

/**
 * The scored population as a temp table (one transaction), from which the
 * curve and every score are read. `clauses` filter the RECENT rows (alias
 * r: r.type, r.starting_trophies) so a mode or trophy-band condition
 * applies to both participants.
 *
 * The 2026-09-10 review measured this at 6-22 seconds per call: the
 * "exactly two participants" rule was a correlated count per row. It is
 * one group-by over the window now.
 */
export function levelPairsSql(clauses = []) {
  return `create temp table lv_pairs on commit drop as
    with recent as (
      select bp.battle_id, bp.player_tag, bp.side, bp.outcome, bp.starting_trophies,
             b.battle_time, b.type, bp.deck_avg_level as lvl
      from battle_participant bp join battle b on b.battle_id = bp.battle_id
      where b.battle_time > now() - $1::interval and b.type_class = 'pvp'),
    duos as (
      select battle_id from recent group by battle_id having count(*) = 2),
    sides as (
      select r.* from recent r join duos d on d.battle_id = r.battle_id
      where r.lvl is not null and r.outcome in ('win','loss')
        ${clauses.join(" ")})
    select a.battle_id, a.player_tag, a.outcome, a.battle_time,
           a.lvl - o.lvl as gap
    from sides a join sides o on o.battle_id = a.battle_id
      and o.side <> a.side and o.outcome <> a.outcome`;
}

export const PILOT_METHODOLOGY = {
  observation_unit: "player_battle",
  level_precision_decimals: 2,
  curve_min_observations: 200,
  player_min_battles: 30,
  monthly_min_battles: 20,
  baseline:
    "In-sample pooled level-gap bins; includes the scored player's observations. Both participants must qualify, including any trophy-band filter.",
  standard_error: {
    formula: "0.5 / sqrt(n)",
    confidence_interval: false,
    note: "Legacy field: maximum binomial standard error for an independent win proportion. Not a calibrated error estimate for Pilot Score; excludes fitted-curve uncertainty and dependence between observations.",
  },
};

/** One-sentence caveats for both Pilot Score tools; the formulas and the
 *  floors are on the methodology page (PILOT_DOCS). */
export const PILOT_NOTES = [
  "pilot_score = actual minus level-expected win rate over scored observations: a descriptive in-sample residual, not proof of skill, improvement or spending independence.",
  "Only recorded PvP battles with exactly two opposing participants, known deck-average levels and opposite decided outcomes qualify; each contributes two dependent observations.",
  "The curve is refit per request over the window, so a score can move with no new battles; standard_error is the legacy 0.5 / sqrt(n) approximation, not a confidence interval.",
];
export const PILOT_DOCS = "methodology#the-level-curve-and-pilot-score";
