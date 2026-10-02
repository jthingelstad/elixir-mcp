/** Factual recorder health: war-typed battles missing their calendar period. */
export function warUnresolvedEmf(count, now = Date.now()) {
  return JSON.stringify({
    _aws: {
      Timestamp: now,
      CloudWatchMetrics: [
        {
          Namespace: "ElixirMCP/Record",
          Dimensions: [[]],
          Metrics: [{ Name: "WarBattleUnresolved", Unit: "Count" }],
        },
      ],
    },
    WarBattleUnresolved: count,
  });
}

/** The count behind the guard: the diagnostics probe's UNRESOLVED
 *  bucket, over seven days of war-typed rows through the time index. */
export async function warBattlesUnresolved(db) {
  const {
    rows: [r],
  } = await db.query(
    `select count(*)::int as n
     from battle b
     where (b.type like 'riverRace%' or b.type = 'boatBattle')
       and b.battle_time > now() - interval '7 days'
       and not exists (select 1 from war_period p
                       where b.battle_time >= p.starts_at and b.battle_time < p.ends_at)`,
  );
  return r.n;
}
