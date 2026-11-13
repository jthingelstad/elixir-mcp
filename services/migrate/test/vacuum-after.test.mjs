/**
 * A migration that bulk-writes or rewrites a table declares it in
 * `-- vacuum after:`, and the ladder vacuums it after the commit
 * (src/vacuum-after.mjs, src/migrate.mjs). This pins the parser, the
 * heuristic's reach and its blind spots, and the rule over every
 * migration from FIRST_CHECKED_MIGRATION on. Earlier files are applied
 * and immutable; the heuristic finds their bulk writes too (0093, 0123,
 * 0210, 0234), which is how it is known to see real migrations.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMigrations } from "../src/migrate.mjs";
import {
  declaredVacuum,
  vacuumDemands,
  FIRST_CHECKED_MIGRATION,
} from "../src/vacuum-after.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(here, "../../../db/migrations");

test("the declaration is a line comment listing plain table names", () => {
  assert.deepEqual(
    declaredVacuum(
      "-- 0300: x.\n--\n-- vacuum after: battle_participant, battle\n--   Vacuum After: deck battle\nselect 1;",
    ),
    ["battle_participant", "battle", "deck"],
  );
  assert.deepEqual(declaredVacuum("-- the vacuum after a backfill\n"), []);
  assert.throws(
    () => declaredVacuum("-- vacuum after: battle; drop table x\n"),
    /not a plain lower-case table name/,
  );
  assert.throws(
    () => declaredVacuum('-- vacuum after: "Battle"\n'),
    /not a plain/,
  );
});

test("the heuristic sees the bulk writes and rewrites", () => {
  const cases = [
    ["update battle_participant set x = 1 where y", ["battle_participant"]],
    ["UPDATE only public.battle b SET x = 1", ["battle"]],
    ["update deck as d set x = 1", ["deck"]],
    ["delete from api_receipt where fetched_at < now()", ["api_receipt"]],
    [
      "insert into admitted_read_day (endpoint, day) select e, d from api_receipt",
      ["admitted_read_day"],
    ],
    [
      "with x as (select 1) insert into battle_participant_round (a) (select a from x)",
      ["battle_participant_round"],
    ],
    ["create table player_copy as select * from player", ["player_copy"]],
    [
      "alter table battle add column id_new uuid default gen_random_uuid()",
      ["battle"],
    ],
    [
      "alter table battle alter column battle_time set data type timestamptz",
      ["battle"],
    ],
    ["do $$ begin update player set x = 1; end $$;", ["player"]],
  ];
  for (const [sql, want] of cases)
    assert.deepEqual(vacuumDemands(sql), want, sql);
});

test("the heuristic leaves alone what writes no bulk rows", () => {
  for (const sql of [
    "insert into card_role (card_id) values (1), (2)",
    "insert into x (a) values (1) on conflict (a) do update set a = excluded.a",
    "alter table battle add column note text",
    "alter table battle add column seen boolean not null default false",
    "alter table battle add column tags text[] default '{}'::text[]",
    "alter table battle add column at timestamptz default now()",
    "alter table battle add column amount numeric default 0::numeric(10)",
    "create trigger t before update on account for each row execute function f()",
    "alter table battle add constraint fk foreign key (a) references b on delete cascade on update cascade",
    "create function f() returns trigger language plpgsql as $$ begin update player set x = 1; return new; end $$;",
    "-- update battle set x = 1\nselect 1",
    "comment on table battle is 'update battle set x = 1';",
    "select * from battle for update",
  ])
    assert.deepEqual(vacuumDemands(sql), [], sql);
});

test("the heuristic finds the bulk writes in shipped migrations", async () => {
  const byId = new Map(
    (await loadMigrations(MIGRATIONS_DIR)).map((m) => [m.id, m]),
  );
  assert.ok(vacuumDemands(byId.get(93).sql).includes("battle_participant"));
  assert.ok(vacuumDemands(byId.get(210).sql).includes("api_receipt"));
  assert.ok(vacuumDemands(byId.get(234).sql).includes("player"));
});

test("every migration from the first checked one declares the tables it bulk-writes", async () => {
  const migrations = await loadMigrations(MIGRATIONS_DIR);
  assert.ok(
    migrations.at(-1).id >= FIRST_CHECKED_MIGRATION - 1,
    "FIRST_CHECKED_MIGRATION is past the ladder's end",
  );
  const missing = [];
  for (const m of migrations.filter((x) => x.id >= FIRST_CHECKED_MIGRATION)) {
    const undeclared = vacuumDemands(m.sql).filter(
      (t) => !m.vacuumAfter.includes(t),
    );
    if (undeclared.length)
      missing.push(`${m.name}: -- vacuum after: ${undeclared.join(", ")}`);
  }
  assert.deepEqual(
    missing,
    [],
    "a migration that bulk-writes or rewrites a table must name it so the ladder vacuums it after the commit (migration skill, Vacuum after every big write); add the line shown",
  );
});

test("a declared table is one the migration names", async () => {
  const migrations = await loadMigrations(MIGRATIONS_DIR);
  for (const m of migrations) {
    const body = m.sql.replace(/^[ \t]*--[ \t]*vacuum after:.*$/gim, "");
    for (const t of m.vacuumAfter)
      assert.match(
        body,
        new RegExp(`\\b${t}\\b`, "i"),
        `${m.name} declares ${t} but never names it: a typo?`,
      );
  }
});
