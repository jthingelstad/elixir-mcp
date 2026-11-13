/**
 * A year of a realistic record for measuring the signed-in pages
 * (2026-11-13): the player page, Stats, Find, the bell and the rest.
 *
 * One week of the fixture clan's battle logs goes in through the ingest
 * pipeline (`seedClanLanding`, its leader King Thing #20JJJ2CCRU signed
 * in), then plain SQL makes it a year and twenty clans:
 *
 * - the clan's week, fifty-one more times, a week earlier each time (the
 *   same players, so every member has a year of battles: about 1,800 for
 *   the reader),
 * - nineteen more clans, the clan's week under other tags,
 * - a year of day rows (profile and roster) for every member of the
 *   twenty clans,
 * - the reader following 55 players (48 clanmates and 7 elsewhere), 20
 *   other accounts following the reader, and the reader's highlights
 *   over the year, some shared.
 *
 * About 118,000 battles and 980 clan members at the defaults (52 weeks,
 * 20 clans); the budget test takes 26 weeks and 8 clans (about 55,000
 * battles), which seeds in a few minutes. The day rows span the weeks. Every tag but King Thing's
 * and POAP KINGS' is made up at run time and never written to a file.
 * The caller drops the database (`seed.scratch.drop()`).
 */
import { addPlayer } from "@elixir-mcp/claims";
import { seedClanLanding } from "./clan-landing-seed.mjs";

/** Another clan's copy `k` of a tag: `#Q`, two letters for k, the rest. */
const code = (sql) => `translate(${sql}, '0123456789', '0289PYLQGR')`;
const other = (col, k) =>
  `'#Q' || ${code(`lpad(${k}::text, 2, '0')`)} || substr(${col}, 3)`;

export async function seedSignedIn(
  name = "signed_in",
  { weeks: WEEKS = 52, clans: CLANS = 20 } = {},
) {
  const t0 = Date.now();
  const step = (what) =>
    process.env.SEED_LOG && console.log(`seed ${what} ${Date.now() - t0} ms`);
  const base = await seedClanLanding(name, { weeks: 1, others: 0 });
  const { db, clanTag, leaderTag, accountId } = base;
  step("base week");

  const columns = async (table) =>
    (
      await db.query(
        `select column_name from information_schema.columns
          where table_schema = current_schema() and table_name = $1
            and is_generated = 'NEVER'
          order by ordinal_position`,
        [table],
      )
    ).rows.map((r) => r.column_name);
  /** Copies of the base week's rows, whole but for the named columns,
   *  once per k in the series. */
  const copy = async (table, alias, replace, from, series, tail = "") => {
    const cols = await columns(table);
    const list = cols.map((c) => replace[c] ?? `${alias}.${c}`).join(", ");
    await db.query(
      `insert into ${table} (${cols.join(", ")})${table === "battle" ? " overriding system value" : ""}
       select ${list} from ${from}, ${series} k${tail}`,
    );
  };

  await db.query("set session_replication_role = replica");
  await db.query(
    "create temporary table base_battle as select battle_id from battle",
  );
  // The `where` sits after the series in the from list, so it goes in
  // the tail.
  const fromBase = (table, alias) => `${table} ${alias}`;
  const onlyBase = (alias) =>
    ` where ${alias}.battle_id in (select battle_id from base_battle)`;

  // Nineteen more clans: the week under other tags, every player's.
  const clans = `generate_series(1, ${CLANS - 1})`;
  await db.query(
    `insert into player (player_tag, name)
     select distinct ${other("p.player_tag", "k")}, 'Invented Other'
       from player p, ${clans} k
     on conflict do nothing`,
  );
  await db.query(
    `insert into clan (clan_tag, name)
     select ${other("c.clan_tag", "k")}, 'Invented Clan ' || k
       from clan c, ${clans} k where c.clan_tag = $1
     on conflict do nothing`,
    [clanTag],
  );
  await copy(
    "clan_membership",
    "cm",
    {
      clan_tag: other("cm.clan_tag", "k"),
      player_tag: other("cm.player_tag", "k"),
    },
    "clan_membership cm",
    clans,
    ` where cm.clan_tag = '${clanTag}'`,
  );
  const remap = (alias) => ({
    battle_id: `${alias}.battle_id || '-c' || k`,
    player_tag: other(`${alias}.player_tag`, "k"),
  });
  await copy(
    "battle",
    "b",
    {
      battle_id: "b.battle_id || '-c' || k",
      cursor: "b.cursor + k * 10000000",
      battle_time: "b.battle_time - k * interval '7 minutes'",
      created_at: "b.created_at - k * interval '7 minutes'",
    },
    fromBase("battle", "b"),
    clans,
    onlyBase("b"),
  );
  await copy(
    "battle_participant",
    "bp",
    {
      ...remap("bp"),
      clan_tag: `case when bp.clan_tag is null then null else ${other("bp.clan_tag", "k")} end`,
      battle_time: "bp.battle_time - k * interval '7 minutes'",
    },
    fromBase("battle_participant", "bp"),
    clans,
    onlyBase("bp"),
  );
  await copy(
    "battle_participant_round",
    "r",
    remap("r"),
    fromBase("battle_participant_round", "r"),
    clans,
    onlyBase("r"),
  );
  await copy(
    "player_daily_battle_rollup",
    "u",
    { player_tag: other("u.player_tag", "k") },
    "player_daily_battle_rollup u",
    clans,
    " on conflict do nothing",
  );
  step("clans");

  // A year: the clan's week again, a week earlier each time, the same
  // players (members and the opponents they met).
  const weeks = `generate_series(1, ${WEEKS - 1})`;
  await copy(
    "battle",
    "b",
    {
      battle_id: "b.battle_id || '-w' || k",
      cursor: "b.cursor + (100 + k) * 10000000",
      battle_time: "b.battle_time - k * interval '7 days'",
      created_at: "b.created_at - k * interval '7 days'",
    },
    fromBase("battle", "b"),
    weeks,
    onlyBase("b"),
  );
  await copy(
    "battle_participant",
    "bp",
    {
      battle_id: "bp.battle_id || '-w' || k",
      battle_time: "bp.battle_time - k * interval '7 days'",
    },
    fromBase("battle_participant", "bp"),
    weeks,
    onlyBase("bp"),
  );
  await copy(
    "battle_participant_round",
    "r",
    { battle_id: "r.battle_id || '-w' || k" },
    fromBase("battle_participant_round", "r"),
    weeks,
    onlyBase("r"),
  );
  await copy(
    "player_daily_battle_rollup",
    "u",
    { day: "u.day - k * 7" },
    "player_daily_battle_rollup u",
    weeks,
    " where u.day > current_date - 8 and left(u.player_tag, 2) <> '#Q' on conflict do nothing",
  );
  step("year");

  // A year of day rows for every member of the twenty clans: the
  // profile (trophies climbing, battle count rising) and the roster.
  await db.query(
    `insert into player_snapshot_daily
       (player_tag, snapshot_date, snapshot_kind, trophies, best_trophies,
        battle_count, wins, losses, exp_points, donations, clan_tag,
        observed_at, profile_observed_at, roster_observed_at)
     select cm.player_tag, current_date - d, 'daily',
            7000 + (365 - d) * 3, 7000 + (365 - d) * 3,
            5000 + (365 - d) * 5, 2600 + (365 - d) * 3, 2400 + (365 - d) * 2,
            100000 + (365 - d) * 50, (d % 7) * 20, cm.clan_tag,
            now() - d * interval '1 day', now() - d * interval '1 day' + interval '1 hour',
            now() - d * interval '1 day'
       from clan_membership cm, generate_series(0, ${WEEKS * 7 - 1}) d
      where cm.left_observed_at is null
     on conflict (player_tag, snapshot_date, snapshot_kind) do update set
       trophies = excluded.trophies, best_trophies = excluded.best_trophies,
       battle_count = excluded.battle_count, wins = excluded.wins,
       losses = excluded.losses, exp_points = excluded.exp_points,
       profile_observed_at = excluded.profile_observed_at`,
  );
  await db.query("set session_replication_role = default");
  step("day rows");

  // The reader follows 48 clanmates and 7 players of another clan, as
  // Home's Follow does.
  const { rows: mates } = await db.query(
    `select player_tag from clan_membership
      where clan_tag = $1 and left_observed_at is null and player_tag <> $2
      order by player_tag`,
    [clanTag, leaderTag],
  );
  const { rows: away } = await db.query(
    `select player_tag from clan_membership
      where clan_tag = ${other("$1::text", 1)} and left_observed_at is null
      order by player_tag limit 7`,
    [clanTag],
  );
  const follows = [...mates, ...away].map((r) => r.player_tag);
  for (const tag of follows) {
    const r = await addPlayer(db, { accountId }, { tag, follow: true });
    if (!r.ok) throw new Error(`seed follow ${JSON.stringify(r)}`);
  }
  // Twenty accounts that verified a player of another clan follow the
  // reader.
  await db.query(
    `with players as (
       select cm.player_tag, row_number() over (order by cm.player_tag) n
         from clan_membership cm
        where cm.clan_tag = ${other("$1::text", 2)} and cm.left_observed_at is null
        limit 20
     ), accounts as (
       insert into account (email_hash, status, role)
       select 'follower-' || n, 'approved', 'member' from players
       returning account_id, email_hash
     ), own as (
       insert into claim (account_id, player_tag, status, relationship, is_primary)
       select a.account_id, p.player_tag, 'verified', 'primary', true
         from accounts a join players p on a.email_hash = 'follower-' || p.n
     )
     insert into claim (account_id, player_tag, status, relationship, is_primary)
     select account_id, $2, 'unverified', 'friend', false from accounts`,
    [clanTag, leaderTag],
  );
  // The reader's highlights: one battle a week over the year, every
  // fourth shared.
  await db.query(
    `insert into battle_highlight (player_tag, battle_id, account_id, words, share_id, shared_at, created_at, updated_at)
     select $1, x.battle_id, $2, 'What a game ' || x.n,
            case when x.n % 4 = 0 then lpad(translate(x.n::text, '0123456789', 'abcdefghij'), 15, 'q') end,
            case when x.n % 4 = 0 then x.battle_time + interval '1 hour' end,
            x.battle_time + interval '1 hour', x.battle_time + interval '1 hour'
       from (select bp.battle_id, bp.battle_time,
                    row_number() over (order by bp.battle_time desc) n
               from battle_participant bp
              where bp.player_tag = $1 and bp.battle_id like '%-w%'
                and bp.battle_id like '%0' ) x
      where x.n <= 40`,
    [leaderTag, accountId],
  );
  await db.query("vacuum analyze");
  step("done");
  return { ...base, follows };
}
