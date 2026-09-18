/**
 * The event ledgers' facts from their typed columns (0124; schema review
 * 1.8): the inverse of services/ingest/src/event-columns.mjs. A reader
 * loads rows with the columns and calls hydratePlayerEvents /
 * hydrateClanEvents once per batch; each row then carries `payload`,
 * the object the timeline has always decorated - the card's name and
 * rarity from the catalog, the crossing battle described from its row
 * (opponent, crowns, the trophy change), a member's name from the
 * player row, a week's colosseum flag and rivals from the war tables.
 * What the copied JSON held is what the record holds; nothing is
 * looked up that the keys do not name.
 */

import { finishInstant } from "./time.mjs";

const ROLE_RANK = { member: 0, elder: 1, coLeader: 2, leader: 3 };

/** As ingest/roster.mjs spells it: promoted / demoted / unknown. */
function roleDirection(before, after) {
  const a = ROLE_RANK[before] ?? -1;
  const b = ROLE_RANK[after] ?? -1;
  if (a < 0 || b < 0 || a === b) return "unknown";
  return b > a ? "promoted" : "demoted";
}

const pick = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/** The crossing battle as describeBattle wrote it (ingest/snapshots.mjs),
 *  for a batch of (battle_id, player_tag) pairs. */
async function describeBattles(db, pairs) {
  if (pairs.length === 0) return new Map();
  const { rows } = await db.query(
    `select bp.battle_id, bp.player_tag, b.battle_time, b.type,
            bp.side, bp.crowns, bp.trophy_change, bp.starting_trophies,
            (select coalesce(jsonb_agg(jsonb_build_object(
                 'player_tag', o.player_tag, 'name', p.name, 'side', o.side,
                 'crowns', o.crowns, 'starting_trophies', o.starting_trophies)
               order by o.side, o.player_tag), '[]'::jsonb)
             from battle_participant o left join player p on p.player_tag = o.player_tag
             where o.battle_id = bp.battle_id and o.player_tag <> bp.player_tag) as others
     from battle_participant bp join battle b on b.battle_id = bp.battle_id
     where (bp.battle_id, bp.player_tag) in (
       select t.b, t.p from unnest($1::text[], $2::text[]) as t(b, p))`,
    [pairs.map((x) => x.battle_id), pairs.map((x) => x.player_tag)],
  );
  const out = new Map();
  for (const b of rows) {
    const opponents = b.others.filter((o) => o.side !== b.side);
    const opponent =
      opponents.length === 1
        ? {
            player_tag: opponents[0].player_tag,
            name: opponents[0].name ?? null,
            starting_trophies: opponents[0].starting_trophies ?? null,
          }
        : null;
    out.set(`${b.battle_id}|${b.player_tag}`, {
      battle_id: b.battle_id,
      battle_time: b.battle_time.toISOString(),
      type: b.type,
      opponent,
      ...(opponent
        ? {}
        : {
            opponents: opponents.map((o) => ({
              player_tag: o.player_tag,
              name: o.name ?? null,
            })),
          }),
      crowns: b.crowns,
      crowns_against: opponents[0]?.crowns ?? null,
      trophy_change: b.trophy_change,
      ...(typeof b.starting_trophies === "number" &&
      typeof b.trophy_change === "number"
        ? { trophies_after: b.starting_trophies + b.trophy_change }
        : {}),
    });
  }
  return out;
}

export async function hydratePlayerEvents(db, rows) {
  const cardIds = [...new Set(rows.map((r) => r.card_id).filter(Boolean))];
  const cards = new Map();
  if (cardIds.length) {
    const { rows: cs } = await db.query(
      `select card_id, name, rarity from card where card_id = any($1)`,
      [cardIds],
    );
    for (const c of cs) cards.set(c.card_id, c);
  }
  const battles = await describeBattles(
    db,
    rows
      .filter((r) => r.battle_id)
      .map((r) => ({ battle_id: r.battle_id, player_tag: r.player_tag })),
  );
  for (const r of rows) {
    const b = r.battle_id
      ? battles.get(`${r.battle_id}|${r.player_tag}`)
      : null;
    const crossing = b
      ? { ...b, ...(r.floor !== null ? { arena_floor: r.floor } : {}) }
      : null;
    const card = r.card_id ? cards.get(r.card_id) : null;
    switch (r.event_type) {
      case "card_leveled":
        r.payload = pick({
          card_id: r.card_id,
          name: card?.name ?? null,
          rarity: card?.rarity ?? null,
          level: r.level,
          prior_level: r.prior_level,
        });
        break;
      case "card_unlocked":
        r.payload = pick({
          card_id: r.card_id,
          name: card?.name ?? null,
          rarity: card?.rarity ?? null,
        });
        break;
      case "badge_earned":
        r.payload = pick({
          name: r.badge_name,
          ...(r.level !== null ? { level: r.level } : {}),
          ...(r.max_level !== null ? { max_level: r.max_level } : {}),
          ...(r.prior_level !== null ? { prior_level: r.prior_level } : {}),
        });
        break;
      case "legendary_badge_earned":
        r.payload = { name: r.badge_name };
        break;
      case "arena_changed":
        r.payload = pick({
          from: r.arena_from,
          to: r.arena_to,
          to_name: r.arena_to_name,
          ...(crossing ? { promoted_by: crossing } : {}),
        });
        break;
      case "ranked_promotion":
        r.payload = pick({
          from: r.league_from,
          to: r.league_to,
          ...(crossing ? { promoted_by: crossing } : {}),
        });
        break;
      case "donation_reset":
        r.payload = {
          donations_before: r.value_before,
          donations_after: r.value_after,
        };
        break;
      case "best_trophies_band":
        r.payload = pick({
          best: r.value_after,
          ...(r.step !== null ? { band: r.step } : {}),
          ...(crossing ? { crossed_by: crossing } : {}),
        });
        break;
      case "career_wins_step":
        r.payload = pick({
          wins: r.value_after,
          ...(r.step !== null ? { step: r.step } : {}),
          ...(crossing ? { crossed_by: crossing } : {}),
        });
        break;
      case "collection_level_step":
        r.payload = pick({
          level: r.level,
          ...(r.step !== null ? { step: r.step } : {}),
        });
        break;
      default:
        r.payload = r.payload ?? {};
    }
  }
  return rows;
}

/** Column list for a player_event read, so every reader selects the
 *  same set (the JSON column is not in it). */
export const PLAYER_EVENT_COLUMNS =
  "event_id, player_tag, event_type, timing, window_start, window_end, occurred_at, " +
  "card_id, badge_name, level, prior_level, max_level, arena_from, arena_to, arena_to_name, " +
  "league_from, league_to, value_before, value_after, step, battle_id, floor";

export const CLAN_EVENT_COLUMNS =
  "event_id, clan_tag, event_type, timing, window_start, window_end, occurred_at, " +
  "player_tag, role_before, role_after, joined_observed_at, roster_size_before, roster_size_after, " +
  "war_season_id, section_index, fame, rank, trophy_change, finish_time";

export async function hydrateClanEvents(db, rows) {
  const tags = [...new Set(rows.map((r) => r.player_tag).filter(Boolean))];
  const names = new Map();
  if (tags.length) {
    const { rows: ps } = await db.query(
      `select player_tag, name from player where player_tag = any($1)`,
      [tags],
    );
    for (const p of ps) names.set(p.player_tag, p.name ?? null);
  }
  // Week facts the JSON copied: the colosseum flag from war_week, the
  // rivals of a bracket from war_week_clan, recorded as of now.
  const weeks = rows.filter(
    (r) => r.war_season_id !== null && r.section_index !== null,
  );
  const weekInfo = new Map();
  if (weeks.length) {
    const { rows: ws } = await db.query(
      `select w.clan_tag, w.season_id, w.section_index, w.is_colosseum,
              (select coalesce(jsonb_agg(jsonb_build_object(
                   'tag', c.participant_clan_tag, 'name', c.participant_name,
                   'recorded', exists (select 1 from recording r
                                       where r.subject_type = 'clan' and r.subject_tag = c.participant_clan_tag
                                         and r.status = 'active'))
                 order by c.participant_clan_tag), '[]'::jsonb)
               from war_week_clan c
               where c.clan_tag = w.clan_tag and c.season_id = w.season_id
                 and c.section_index = w.section_index
                 and c.participant_clan_tag <> w.clan_tag) as rivals
       from war_week w
       where (w.clan_tag, w.season_id, w.section_index) in (
         select t.c, t.s, t.i from unnest($1::text[], $2::int[], $3::int[]) as t(c, s, i))`,
      [
        weeks.map((r) => r.clan_tag),
        weeks.map((r) => r.war_season_id),
        weeks.map((r) => r.section_index),
      ],
    );
    for (const w of ws)
      weekInfo.set(`${w.clan_tag}|${w.season_id}|${w.section_index}`, w);
  }
  for (const r of rows) {
    const sizes = {
      roster_size_before: r.roster_size_before,
      roster_size_after: r.roster_size_after,
    };
    const week = weekInfo.get(
      `${r.clan_tag}|${r.war_season_id}|${r.section_index}`,
    );
    switch (r.event_type) {
      case "member_joined":
        r.payload = {
          player_tag: r.player_tag,
          name: names.get(r.player_tag) ?? null,
          role: r.role_after,
          ...sizes,
        };
        break;
      case "member_left":
        r.payload = {
          player_tag: r.player_tag,
          name: names.get(r.player_tag) ?? null,
          role_at_departure: r.role_before,
          joined_observed_at: r.joined_observed_at
            ? r.joined_observed_at.toISOString()
            : null,
          ...sizes,
        };
        break;
      case "role_changed":
        r.payload = {
          player_tag: r.player_tag,
          name: names.get(r.player_tag) ?? null,
          role_before: r.role_before,
          role_after: r.role_after,
          direction: roleDirection(r.role_before, r.role_after),
          ...sizes,
        };
        break;
      case "week_resolved":
        r.payload = {
          season_id: r.war_season_id,
          section_index: r.section_index,
          is_colosseum: week?.is_colosseum ?? false,
          fame: r.fame,
          rank: r.rank,
          trophy_change: r.trophy_change,
        };
        break;
      case "bracket_observed":
        r.payload = {
          season_id: r.war_season_id,
          section_index: r.section_index,
          is_colosseum: week?.is_colosseum ?? false,
          rivals: week?.rivals ?? [],
        };
        break;
      case "race_finished":
        r.payload = {
          season_id: r.war_season_id,
          section_index: r.section_index,
          fame: r.fame,
          finish_time: finishInstant(r.finish_time),
        };
        break;
      default:
        r.payload = r.payload ?? {};
    }
  }
  return rows;
}
