/**
 * Choosing the week's card (0153) over a scratch database: the ten most
 * played of the season, minus anything SENT inside a year, drawn on a
 * seed that is fixed within a week and moves between them.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { ensureSeasonsAround, seasonAt } from "../../ingest/src/season.mjs";
import {
  selectCard,
  recordFeatured,
  recordFeaturedSent,
  drawIndex,
} from "../src/email/card-of-week-select.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_cow_select_${process.pid}`;
const URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

let db;
let month;
const NOW = new Date();
// Fifteen cards, descending by battles, so the top ten is a real cut.
const CARDS = Array.from({ length: 15 }, (_, i) => ({
  id: 26000000 + i,
  name: `Card ${String.fromCharCode(65 + i)}`,
  battles: 20000 - i * 1000,
}));

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: URL });
  await db.connect();
  await ensureSeasonsAround(db, NOW.getTime());
  month = (await seasonAt(db, NOW.getTime())).season_month;
  await db.query(
    `insert into meta_season_totals (season_month, mode_group, decided, wins)
     values ($1, 'all', 100000, 50000)`,
    [month],
  );
  for (const c of CARDS) {
    await db.query(
      `insert into card (card_id, name, kind) values ($1, $2, 'card')`,
      [c.id, c.name],
    );
    // form -1 is the MERGED row; a per-form row must never be ranked.
    for (const [form, battles] of [
      [-1, c.battles],
      [0, c.battles - 1],
    ])
      await db.query(
        `insert into card_meta_season (season_month, mode_group, card_id, form, battles, wins, losses, players)
         values ($1, 'all', $2, $3, $4, $5, $6, 100)`,
        [
          month,
          c.id,
          form,
          battles,
          Math.floor(battles / 2),
          Math.ceil(battles / 2),
        ],
      );
  }
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("the field is the ten most played of the season, merged across forms", async () => {
  const out = await selectCard(db, {
    periodKey: "2026-W39",
    now: NOW,
    force: null,
  });
  assert.equal(out.candidates.length, 10);
  assert.deepEqual(
    out.candidates.map((c) => c.name),
    CARDS.slice(0, 10).map((c) => c.name),
  );
  // The merged row's battles, not the per-form row's.
  assert.equal(out.candidates[0].battles, 20000);
  assert.equal(out.candidates[0].usage_share, 0.2);
  assert.equal(out.reason, "usage");
  assert.ok(out.candidates.some((c) => c.card_id === out.card.card_id));
});

test("the draw is fixed within a week and moves between them", async () => {
  const a = await selectCard(db, {
    periodKey: "2026-W39",
    now: NOW,
    force: null,
  });
  const b = await selectCard(db, {
    periodKey: "2026-W39",
    now: NOW,
    force: null,
  });
  assert.equal(a.card.card_id, b.card.card_id, "a re-run picks the same card");
  const weeks = new Set();
  for (let w = 30; w < 45; w++) weeks.add(drawIndex(`2026-W${w}`, 10));
  assert.ok(weeks.size > 3, `the seed moves between weeks: ${[...weeks]}`);
});

test("a card is consumed by a SEND, not by a selection", async () => {
  const first = await selectCard(db, {
    periodKey: "2026-W40",
    now: NOW,
    force: null,
  });
  await recordFeatured(db, { periodKey: "2026-W40", ...first });
  // Chosen but never sent: a failed issue or a dry run. Still eligible.
  const again = await selectCard(db, {
    periodKey: "2026-W41",
    now: NOW,
    force: null,
  });
  assert.ok(
    again.candidates.some((c) => c.card_id === first.card.card_id),
    "an unsent pick stays in the field",
  );
  await recordFeaturedSent(db, { periodKey: "2026-W40", at: NOW });
  const after = await selectCard(db, {
    periodKey: "2026-W41",
    now: NOW,
    force: null,
  });
  assert.ok(
    !after.candidates.some((c) => c.card_id === first.card.card_id),
    "a sent card leaves the field",
  );
  // And the eleventh card is pulled up to keep the field at ten.
  assert.equal(after.candidates.length, 10);
});

test("past a year, the card returns to the field", async () => {
  const {
    rows: [sent],
  } = await db.query(
    `select card_id from email_featured_card where sent_at is not null`,
  );
  // Age the send rather than the season: the calendar forbids
  // overlapping ranges, and it is the send's age the rule reads.
  await db.query(
    `update email_featured_card set sent_at = $1 where sent_at is not null`,
    [new Date(NOW.getTime() - 366 * 86_400_000)],
  );
  const out = await selectCard(db, {
    periodKey: "2026-W41",
    now: NOW,
    force: null,
  });
  assert.ok(
    out.candidates.some((c) => c.card_id === sent.card_id),
    "past the year, it returns to the field",
  );
});

test("an override names a card by id, is logged as one, and skips the year rule", async () => {
  const out = await selectCard(db, {
    periodKey: "2026-W42",
    now: NOW,
    force: String(CARDS[14].id),
  });
  assert.equal(out.card.card_id, CARDS[14].id, "a card outside the ten");
  assert.equal(out.reason, "override");
  assert.equal(out.candidates.length, 10, "the field is still logged");
  const missing = await selectCard(db, {
    periodKey: "2026-W42",
    now: NOW,
    force: "99999999",
  });
  assert.equal(missing.card, null);
  assert.match(missing.why, /not in the catalog/);
});
