/**
 * A boat DEFENSE is not the member's battle (Jamie 2026-09-24; 0171): an
 * enemy attacked the member's boat and their defense deck answered, so no
 * read of a member's own battles counts it - battles, wins, losses,
 * streaks, decks. A boat ATTACK is theirs (it spends a war deck).
 *
 * Written over the participant row alone so it composes anywhere a
 * `battle_participant` alias is in scope (and survives the alias rewrite
 * battles_trends does for its window count). The lookup runs for boat
 * rows only, by primary key, so a scan over participants stays
 * index-only.
 */
export const notBoatDefense = (bp = "bp") =>
  `not (${bp}.type = 'boatBattle' and exists (
     select 1 from battle bd
      where bd.battle_id = ${bp}.battle_id and bd.boat_battle_side is not null
        and (bd.boat_battle_side = 'defender') = (${bp}.side = 0)))`;
