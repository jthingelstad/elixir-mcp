/**
 * {trophy_band_census: {days?, schemes?}}: read-only. How the meta
 * population spreads across trophies, and what each candidate band
 * layout would hold (Jamie, 2026-09-24: "should they be even bigger or
 * smaller?"). The population is the raw meta path's: decided pvp battles
 * with a deck, not ranked or tournament (they carry no trophies), inside
 * the meta rule (no event content, chosen decks). Per band: battles,
 * distinct players, decks, decks with two or more repeat players (what
 * min_players 2 lists from 8.0.0) and those among them over the default
 * min_battles 5. Also the recorded players' current Trophy Road trophies.
 */

import pg from "pg";
import { unbandedTypes } from "@elixir-mcp/contracts";

const DEFAULT_SCHEMES = {
  current: [0, 5000, 8000, 11000, 13000],
  every_1000: [...Array(14).keys()].map((i) => i * 1000),
  every_2000: [0, 2000, 4000, 6000, 8000, 10000, 12000],
  three_wide: [0, 5000, 10000],
};

export async function trophyBandCensus(databaseUrl, spec = {}) {
  const days = Number(spec.days ?? 60);
  const schemes = spec.schemes ?? DEFAULT_SCHEMES;
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set statement_timeout = '600s'");
    await db.query("set work_mem = '64MB'");
    await db.query(
      `create temp table tp as
       select bp.player_tag, bp.deck_hash, bp.starting_trophies as st
         from battle_participant bp
        where bp.battle_time >= now() - make_interval(days => $1)
          and bp.type_class = 'pvp' and bp.outcome in ('win', 'loss')
          and bp.deck_hash is not null and bp.starting_trophies is not null
          and not (bp.type = any($2))
          and exists (select 1 from battle mb where mb.battle_id = bp.battle_id
                        and mb.event_tag is null
                        and (mb.deck_selection is null or mb.deck_selection in ('collection', 'warDeckPick')))`,
      [days, unbandedTypes()],
    );
    const out = { days, schemes: {} };
    for (const [name, bounds] of Object.entries(schemes)) {
      const { rows } = await db.query(
        `with b as (
           select width_bucket(st, $1::int[]) as band, player_tag, deck_hash, count(*)::int as n
             from tp group by 1, 2, 3),
         d as (
           select band, deck_hash, sum(n)::int as battles,
                  count(*) filter (where n >= 2)::int as rep
             from b group by 1, 2),
         p as (select band, count(distinct player_tag)::int as players from b group by 1)
         select d.band, ($1::int[])[d.band] as lo, sum(d.battles)::int as battles,
                p.players, count(*)::int as decks,
                count(*) filter (where d.rep >= 2)::int as decks_2_repeat,
                count(*) filter (where d.rep >= 2 and d.battles >= 5)::int as listed_default
           from d join p on p.band = d.band
          group by d.band, p.players order by d.band`,
        [bounds],
      );
      out.schemes[name] = rows;
    }
    const { rows: players } = await db.query(
      `with latest as (
         select distinct on (s.player_tag) s.player_tag, s.trophies
           from player_snapshot_daily s
          where s.snapshot_date >= current_date - 14 and s.trophies is not null
          order by s.player_tag, s.snapshot_date desc)
       select least(trophies / 1000, 14) * 1000 as lo, count(*)::int as players
         from latest group by 1 order by 1`,
    );
    out.recorded_players_by_current_trophies = players;
    const {
      rows: [tot],
    } = await db.query(
      "select count(*)::int as battles, count(distinct player_tag)::int as players from tp",
    );
    out.total = tot;
    return out;
  } finally {
    await db.end();
  }
}
