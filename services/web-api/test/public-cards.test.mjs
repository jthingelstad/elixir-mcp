/** Public card catalog facts stay available after global statistics retire. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { makeHandler } from "../src/handler.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_public_cards_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
let db, handler;

const get = async (p) => {
  const res = await handler({
    rawPath: p,
    requestContext: { http: { method: "GET" } },
    headers: {},
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

const KNIGHT = 26000000;
const ARCHERS = 26000001;

before(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  await migrate({
    databaseUrl,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  for (const [id, cardName, rarity, cost] of [
    [KNIGHT, "Knight", "common", 3],
    [ARCHERS, "Archers", "common", 3],
  ])
    await db.query(
      `insert into card (card_id, name, kind, rarity, elixir_cost, max_level,
                         icon_medium, in_catalog)
       values ($1, $2, 'card', $3, $4, 16,
               $5, true)
       on conflict (card_id) do update
         set name = excluded.name, kind = 'card', rarity = excluded.rarity,
             elixir_cost = excluded.elixir_cost, in_catalog = true`,
      [id, cardName, rarity, cost, `https://example.test/${id}.png`],
    );
  handler = makeHandler({ databaseUrl, secret: "test" });
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
});

test("catalog and card detail serve facts without season statistics", async () => {
  const { status, body } = await get("/api/public/cards");
  assert.equal(status, 200);
  assert.ok(body.cards.some((c) => c.id === KNIGHT && c.name === "Knight"));
  assert.ok(body.disclaimer);
  for (const field of ["season", "history", "modes", "card_of_week"])
    assert.equal(body[field], undefined);
  const detail = await get(`/api/public/cards/${KNIGHT}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.card.name, "Knight");
  assert.ok(detail.body.disclaimer);
  for (const field of ["season", "history", "modes", "card_of_week"])
    assert.equal(detail.body[field], undefined);
  assert.equal((await get("/api/public/cards/99999999")).status, 404);
});
