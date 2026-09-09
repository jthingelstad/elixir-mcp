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

export function levelPairsSql(clauses = []) {
  return `create temp table lv_pairs on commit drop as
    with sides as (
      select bp.battle_id, bp.player_tag, bp.side, bp.outcome, b.battle_time,
             bp.deck_avg_level as lvl
      from battle_participant bp join battle b on b.battle_id = bp.battle_id
      where bp.deck_avg_level is not null and b.type_class = 'pvp'
        and bp.outcome in ('win','loss')
        and b.battle_time > now() - $1::interval
        and (select count(*) from battle_participant allp
             where allp.battle_id = bp.battle_id) = 2
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

export const PILOT_NOTE =
  "pilot_score = actual minus level-expected win rate on scored observations. Rates and scores are calculated from unrounded aggregates, then independently rounded to three decimals. This is a descriptive in-sample residual, not proof of skill, improvement, or spending independence. Only recorded PvP battles with exactly two participants on opposing sides, known deck-average levels and opposite decided outcomes qualify. Each contributes two dependent player-battle observations. Bins need 200 observations, players need 30 scored battles, and monthly points need 20. The curve is refit per request; scores can move without new player battles. Aggregate basis counts do not identify the fitted curve: unchanged counts can hide changed composition or rates. Compare the underlying samples and populations before interpreting a change. standard_error is the legacy 0.5 / sqrt(n) approximation, not a confidence interval for the score.";
