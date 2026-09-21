import pg from "pg";

/** Name-pattern census ({name_census: true | {min_players?}}): does the
 *  SHAPE of a display name go with performance? (Jamie, 2026-09-20,
 *  after a Minecraft study Tyler saw claiming it does there.) Three
 *  populations, each read once and aggregated by name feature:
 *
 *    battles  - every named participant in a decided pvp battle (the
 *               whole corpus, opponents included, so ~300k names);
 *               win rate pooled over battles and averaged per player.
 *    ranked   - the latest FINAL Path of Legends board we hold (the
 *               API's 9,999) plus the latest live boards of every
 *               location, one row per tag: rating.
 *    profiles - the latest daily snapshot per profiled player:
 *               trophies, best trophies, lifetime win rate, PoL.
 *
 *  Read-only, aggregates only: counts, means and rates per feature;
 *  no name, tag or row ever leaves the database. The pooled battle
 *  rate is dominated by recorded players (hundreds of battles each);
 *  the per-player mean is dominated by opponents (one battle each) -
 *  both are reported because they answer different questions. */

// One boolean per shape; the expression sees the name as `n`. Postgres
// AREs take \uXXXX and \UXXXXXXXX, so the script classes are literal
// Unicode blocks, not locale-dependent [:alpha:] guesses.
const FEATURES = {
  has_digit: String.raw`n ~ '\d'`,
  ends_with_digits: String.raw`n ~ '\d\d+$'`,
  year_suffix: String.raw`n ~ '(19[5-9]\d|20[0-2]\d)$'`,
  leet_mix: String.raw`n ~ '[A-Za-z]\d+[A-Za-z]'`,
  all_caps: String.raw`n !~ '[a-z]' and n ~ '[A-Z].*[A-Z].*[A-Z]'`,
  all_lower: String.raw`n !~ '[A-Z]' and n ~ '[a-z].*[a-z].*[a-z]'`,
  starts_lower: String.raw`n ~ '^[a-z]'`,
  letters_only: String.raw`n ~ '^[A-Za-z]+$'`,
  has_space: String.raw`n ~ ' '`,
  ascii_punct: String.raw`n ~ '[!-/:-@\[-` + "`" + String.raw`{-~]'`,
  x_wrapped: String.raw`n ~* '^x.*x$' and length(n) >= 4`,
  non_ascii: String.raw`n ~ '[^ -~]'`,
  decorative: String.raw`n ~ '[\u2000-\u2BFF\uA980-\uA9DF\u0E00-\u0E7F\U0001F000-\U0001FAFF\uFE00-\uFE0F]'`,
  cyrillic: String.raw`n ~ '[\u0400-\u04FF]'`,
  arabic: String.raw`n ~ '[\u0600-\u06FF]'`,
  cjk: String.raw`n ~ '[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]'`,
};

// A word people put in a name on purpose; case-insensitive substring.
const KEYWORDS = [
  "pro",
  "king",
  "god",
  "boss",
  "lord",
  "master",
  "gamer",
  "noob",
  "killer",
  "dark",
  "ninja",
  "dragon",
  "wolf",
  "yt",
  "ttv",
  "clash",
  "royale",
  "lol",
  "ez",
  "xd",
];

const LENGTH_BUCKETS = [
  ["1-4", "length(n) <= 4"],
  ["5-7", "length(n) between 5 and 7"],
  ["8-10", "length(n) between 8 and 10"],
  ["11-15", "length(n) >= 11"],
];

function featureCases(alias) {
  const out = [];
  for (const [key, expr] of Object.entries(FEATURES))
    out.push([key, expr.replaceAll(/\bn\b/g, alias)]);
  for (const kw of KEYWORDS) out.push([`kw_${kw}`, `${alias} ~* '${kw}'`]);
  for (const [key, expr] of LENGTH_BUCKETS)
    out.push([`len_${key}`, expr.replaceAll(/\bn\b/g, alias)]);
  return out;
}

// One SELECT per metric column: each feature becomes a row of
// (feature, n, mean...) through a lateral unnest over the boolean
// cases, so the base table is scanned once.
function censusSql(base, metrics, minPlayers) {
  const cases = featureCases("b.name");
  const flags = cases
    .map(([key, expr]) => `('${key}', (${expr}))`)
    .join(",\n            ");
  const cols = metrics
    .map(([key, expr]) => `round(avg(${expr})::numeric, 4)::float as ${key}`)
    .join(",\n            ");
  return `with b as (${base})
     select f.feature,
            count(*)::int as n,
            ${cols}
     from b
     cross join lateral (values ${flags}) as f(feature, hit)
     where f.hit
     group by f.feature
     having count(*) >= ${Number(minPlayers)}
     order by n desc`;
}

function baselineSql(base, metrics) {
  const cols = metrics
    .map(([key, expr]) => `round(avg(${expr})::numeric, 4)::float as ${key}`)
    .join(", ");
  return `with b as (${base})
     select count(*)::int as n, ${cols},
            round(corr(length(b.name), ${metrics[0][1]})::numeric, 4)::float as r_length,
            round(corr(length(regexp_replace(b.name, '\\D', '', 'g')), ${metrics[0][1]})::numeric, 4)::float as r_digit_count
     from b`;
}

// Every named participant in a decided pvp battle, folded to one row
// per player: their decided count and win rate.
const BATTLES_BASE = `
  select p.name, count(*)::int as decided,
         avg((bp.outcome = 'win')::int)::float as win_rate,
         avg(bp.starting_trophies)::float as starting_trophies
  from battle_participant bp
  join player p on p.player_tag = bp.player_tag
  where bp.type_class = 'pvp'
    and bp.outcome in ('win', 'loss')
    and p.name is not null and p.name <> ''
  group by p.player_tag, p.name`;

// The latest final board plus the latest live board of every location,
// one row per tag at their best rating.
const RANKED_BASE = `
  with latest as (
    select distinct on (s.board, s.location_key) s.snapshot_id
    from ranking_snapshot s
    where s.board in ('pol', 'pol_final')
    order by s.board, s.location_key, s.observed_at desc
  )
  select e.player_tag, max(e.name) as name, max(e.rating)::float as rating,
         min(e.rank)::float as rank
  from ranking_entry e
  join latest l on l.snapshot_id = e.snapshot_id
  where e.name is not null and e.name <> '' and e.rating is not null
  group by e.player_tag`;

// The latest daily profile snapshot per player.
const PROFILES_BASE = `
  select distinct on (s.player_tag)
         p.name, s.trophies::float as trophies,
         s.best_trophies::float as best_trophies,
         s.pol_best_trophies::float as pol_best_trophies,
         case when coalesce(s.battle_count, 0) >= 100
              then s.wins::float / nullif(s.wins + s.losses, 0) end as lifetime_win_rate,
         s.exp_points::float as exp_points
  from player_snapshot_daily s
  join player p on p.player_tag = s.player_tag
  where s.snapshot_kind = 'daily'
    and p.name is not null and p.name <> ''
    and s.trophies is not null
  order by s.player_tag, s.snapshot_date desc`;

export async function nameCensus(databaseUrl, spec) {
  const minPlayers = Math.min(
    Math.max(Number(spec?.min_players ?? 50) || 50, 1),
    100_000,
  );
  const populations = {
    battles: {
      base: BATTLES_BASE,
      metrics: [
        ["win_rate_per_player", "b.win_rate"],
        ["decided_per_player", "b.decided"],
        ["starting_trophies", "b.starting_trophies"],
      ],
      pooled: `with b as (${BATTLES_BASE})
        select f.feature,
               sum(b.decided)::int as battles,
               round((sum(b.decided * b.win_rate) / sum(b.decided))::numeric, 4)::float as win_rate_pooled
        from b
        cross join lateral (values ${featureCases("b.name")
          .map(([key, expr]) => `('${key}', (${expr}))`)
          .join(", ")}) as f(feature, hit)
        where f.hit
        group by f.feature`,
      pooledBaseline: `with b as (${BATTLES_BASE})
        select sum(b.decided)::int as battles,
               round((sum(b.decided * b.win_rate) / sum(b.decided))::numeric, 4)::float as win_rate_pooled
        from b`,
    },
    ranked: {
      base: RANKED_BASE,
      metrics: [
        ["rating", "b.rating"],
        ["rank", "b.rank"],
      ],
    },
    profiles: {
      base: PROFILES_BASE,
      metrics: [
        ["trophies", "b.trophies"],
        ["best_trophies", "b.best_trophies"],
        ["pol_best_trophies", "b.pol_best_trophies"],
        ["lifetime_win_rate", "b.lifetime_win_rate"],
        ["exp_points", "b.exp_points"],
      ],
    },
  };
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const out = { min_players: minPlayers, populations: {} };
    for (const [name, pop] of Object.entries(populations)) {
      const { rows: baseline } = await db.query(
        baselineSql(pop.base, pop.metrics),
      );
      const { rows: features } = await db.query(
        censusSql(pop.base, pop.metrics, minPlayers),
      );
      const block = { baseline: baseline[0], features };
      if (pop.pooled) {
        const { rows: pooledBase } = await db.query(pop.pooledBaseline);
        const { rows: pooled } = await db.query(pop.pooled);
        Object.assign(block.baseline, pooledBase[0]);
        const byFeature = new Map(pooled.map((r) => [r.feature, r]));
        for (const f of features) {
          const p = byFeature.get(f.feature);
          if (p) {
            f.battles = p.battles;
            f.win_rate_pooled = p.win_rate_pooled;
          }
        }
      }
      out.populations[name] = block;
    }
    out.features = Object.keys(FEATURES);
    out.keywords = KEYWORDS;
    out.notes = [
      "Aggregates only: every row is a feature with its count and means; no name or tag is returned.",
      "battles: one row per named player over decided pvp battles; win_rate_per_player weights every player once (opponents dominate), win_rate_pooled weights every battle (recorded players dominate). starting_trophies is the API's field, whatever the mode meant by it.",
      "ranked: the latest final PoL board plus the latest live board per location, one row per tag - everyone here is already top-of-ladder, so this asks whether name shape sorts WITHIN the elite.",
      "profiles: latest daily snapshot per profiled player; lifetime_win_rate needs 100+ lifetime battles.",
      "r_length / r_digit_count are Pearson correlations of name length / digit count with the population's first metric.",
    ];
    return out;
  } finally {
    await db.end();
  }
}
