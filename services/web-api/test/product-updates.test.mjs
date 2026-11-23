/**
 * Product updates in Home's Timeline (2026-11-23): a What's new entry marked
 * for everyone is a story from Elixir in every signed-in person's feed, by
 * its own time, for the feed's week; never stored, under no chip but
 * Everyone and no mode, with no cheers or comments. Real PostgreSQL for the
 * feed; invented tags and names.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { createSession } from "@elixir-mcp/auth";
import { timelineUpdates } from "@elixir-mcp/docs/src/timeline.mjs";
import { makeHandler } from "../src/handler.mjs";
import {
  besideProductUpdates,
  isProductUpdate,
  productUpdatesIn,
  readProductUpdates,
} from "../src/product-updates.mjs";

const FRIEND = "#0QYV2LRC";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let scratch, handler, plain;
const sessions = new Map();
const data = (r) => JSON.parse(r.body);
const iso = (ms) => new Date(ms).toISOString();

/** Entries as packages/docs writes them (dist/timeline-updates.json). */
const entry = (slug, ms) => ({
  id: `product_update:${slug}`,
  at: iso(ms),
  title: `Title of ${slug}`,
  lede: `The first paragraph of ${slug}.`,
  path: `/updates/${slug}`,
});
const now = Date.now();
const ENTRIES = [
  entry("2026-01-01-in-the-week", now - HOUR),
  entry("2026-01-01-last-month", now - 30 * DAY),
  entry("2026-01-01-not-yet", now + DAY),
];

async function person(hash) {
  const id = (
    await scratch.db.query(
      "insert into account(email_hash,status) values ($1,'approved') returning account_id",
      [hash],
    )
  ).rows[0].account_id;
  const { token } = await createSession(scratch.db, {
    secret: "test",
    accountId: id,
    emailHash: hash,
  });
  sessions.set(id, token);
  return id;
}
const feed = (door, id, query = {}) =>
  door({
    path: "/api/me/home/feed",
    method: "GET",
    headers: {
      cookie: `__Host-elixir_session=${sessions.get(id)}`,
      "x-elixir-client": "web",
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
    queryStringParameters: query,
  });

before(async () => {
  scratch = await scratchDb("product_updates");
  handler = makeHandler({
    databaseUrl: scratch.url,
    secret: "test",
    productUpdates: async (window) => productUpdatesIn(ENTRIES, window),
  });
  plain = makeHandler({ databaseUrl: scratch.url, secret: "test" });
});
after(async () => scratch.drop());

test("only entries inside the window, as items from Elixir, newest first", () => {
  const items = productUpdatesIn(
    [entry("a-older", now - 2 * DAY), ...ENTRIES],
    { fromMs: now - 7 * DAY, toMs: now },
  );
  assert.deepEqual(
    items.map((it) => it.id),
    ["product_update:2026-01-01-in-the-week", "product_update:a-older"],
  );
  assert.deepEqual(items[0], {
    id: "product_update:2026-01-01-in-the-week",
    kind: "product_update",
    section: "product",
    at: iso(now - HOUR),
    sort_at: iso(now - HOUR),
    observed_at: iso(now - HOUR),
    subject_tag: null,
    subjects: [],
    groups: [],
    text: "Title of 2026-01-01-in-the-week",
    product_update: {
      title: "Title of 2026-01-01-in-the-week",
      lede: "The first paragraph of 2026-01-01-in-the-week.",
      path: "/updates/2026-01-01-in-the-week",
    },
  });
  assert.deepEqual(productUpdatesIn(null, { fromMs: 0, toMs: now }), []);
});

test("Home's additions run over the other items only, and the updates keep their places", async () => {
  const update = productUpdatesIn(ENTRIES, { fromMs: 0, toMs: now })[0];
  const items = [{ id: "a" }, update, { id: "b" }];
  const seen = [];
  const out = await besideProductUpdates(items, async (rest) => {
    seen.push(rest.map((it) => it.id));
    return rest.map((it) => ({ ...it, decorated: true }));
  });
  assert.deepEqual(seen, [["a", "b"]]);
  assert.deepEqual(out, [
    { id: "a", decorated: true },
    update,
    { id: "b", decorated: true },
  ]);
  // A page of updates alone never calls the additions.
  assert.deepEqual(
    await besideProductUpdates([update], () => assert.fail("called")),
    [update],
  );
});

test("the build carries the marked entries, each with what the Timeline shows", async () => {
  const built = await timelineUpdates();
  assert.ok(Array.isArray(built));
  assert.ok(built.length >= 1, "at least the entry that announced this");
  for (const u of built) {
    assert.deepEqual(Object.keys(u), ["id", "at", "title", "lede", "path"]);
    assert.match(u.id, /^product_update:\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/);
    assert.equal(u.id, `product_update:${u.path.slice("/updates/".length)}`);
    assert.match(u.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
    assert.ok(u.lede.length > 0 && u.lede.length <= 400);
    assert.ok(!u.lede.includes("<!--"));
  }
  const at = built.map((u) => u.at);
  assert.deepEqual(at, [...at].sort().reverse(), "newest first");
  const all = await readProductUpdates({ fromMs: 0, toMs: Infinity });
  assert.equal(all.length, built.length);
  assert.ok(all.every(isProductUpdate));
});

test("the web API's own handler is given the build's entries", () => {
  const source = readFileSync(
    new URL("../src/index.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /productUpdates: readProductUpdates,/);
});

test("every signed-in person's feed holds the update, by its time, under Everyone only", async () => {
  const { db } = scratch;
  const id = await person("product-updates-reader");
  await db.query(
    "insert into player(player_tag,name) values ($1,'Friendly') on conflict do nothing",
    [FRIEND],
  );
  await db.query(
    `insert into claim(account_id,player_tag,relationship,is_primary)
     values ($1,$2,'friend',false)`,
    [id, FRIEND],
  );
  // One item from the friend on each side of the update.
  for (const [ref, ms, score] of [
    ["product-updates-1", now - 2 * HOUR, 10],
    ["product-updates-2", now - 30 * 60_000, 20],
  ])
    await db.query(
      `insert into attested_fact
         (subject_kind,player_tag,fact_type,detail,visibility,source,source_ref,occurred_at,recorded_at)
       values ('player',$1,'personal_record',$4,'player',
               'drop.poapkings.com',$2,$3,$3)`,
      [FRIEND, ref, iso(ms), { game: "drop", score }],
    );

  const r = await feed(handler, id);
  assert.equal(r.statusCode, 200, r.body);
  const page = data(r);
  assert.equal(page.total, 3);
  assert.deepEqual(
    page.timeline.map((it) => it.kind),
    ["personal_record", "product_update", "personal_record"],
    "in its place by time",
  );
  const update = page.timeline[1];
  assert.deepEqual(
    update,
    productUpdatesIn(ENTRIES, { fromMs: 0, toMs: now })[0],
    "as it is: no chips, cheers, comments or links added",
  );
  assert.equal(page.counts.everyone, 3);
  assert.equal(page.counts.friends, 2);
  assert.equal(page.counts.you, 0);
  // The "N new" pill's mark never moves to an update's time.
  assert.equal(page.watermark, page.window.from);

  // A mode filter leaves it out.
  const ladder = data(await feed(handler, id, { mode: "ladder" }));
  assert.ok(!ladder.timeline.some(isProductUpdate));
  assert.equal(ladder.week_total, 3);

  // Never stored in the account's week.
  const { rows } = await db.query(
    `select count(*)::int as n from home_feed f,
            jsonb_array_elements(f.items) it
      where f.account_id = $1 and it->>'kind' = 'product_update'`,
    [id],
  );
  assert.equal(rows[0].n, 0);

  // A handler given no source shows none.
  assert.equal(data(await feed(plain, id)).total, 2);
});

test("a person who follows nobody, made after the update, still sees it", async () => {
  const id = await person("product-updates-newcomer");
  const r = await feed(handler, id);
  assert.equal(r.statusCode, 200, r.body);
  const page = data(r);
  assert.deepEqual(
    page.timeline.map((it) => it.id),
    ["product_update:2026-01-01-in-the-week"],
  );
});
