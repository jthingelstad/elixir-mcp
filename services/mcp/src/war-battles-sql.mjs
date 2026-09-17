/**
 * A clan's war battles in a week, resolved by the calendar (0105; schema
 * review 2026-09-16, 1.2). The API stamps nothing on a war battle beyond
 * its type and time, so the record does not either: a battle's week and
 * day are where its battle_time falls on the policy grid (`war_period`,
 * 10:00Z days, global for every clan), and whose war it was is the
 * participant's own clan_tag. Every reader that used to join `battle` on
 * the stamped season_id / section_index / war_day - which three
 * quarters of war battles never carried - takes this instead.
 *
 * `season`, `section`, `clan`, `types` and `warDay` are SQL expressions
 * (a `$n` placeholder or a column reference such as `wp.season_id`), so
 * the same text serves a parameterised read and a correlated subquery.
 * Columns out: player_tag, battle_id, battle_time, war_day, period_index.
 */

import { typesForModeGroup } from "@elixir-mcp/contracts";

/** The four battle types a river race produces (modes.ts: the war group). */
export const WAR_BATTLE_TYPES = typesForModeGroup("war");

export function warBattlesSql({ clan, season, section, types, warDay = null }) {
  return `select bp.player_tag, bp.battle_id, bp.battle_time, p.war_day, p.period_index
          from war_period p
          join battle_participant bp
            on bp.battle_time >= p.starts_at and bp.battle_time < p.ends_at
          where p.war_season_id = ${season} and p.section_index = ${section}
            and p.war_day is not null${warDay ? ` and p.war_day = ${warDay}` : ""}
            and bp.clan_tag = ${clan} and bp.type = any(${types})`;
}
