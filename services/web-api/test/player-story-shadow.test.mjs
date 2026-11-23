/**
 * The stored-story shadow on the player page (stage 1 of the stored
 * Timeline, 2026-11-23): the page logs one line comparing its computed
 * timeline with the player's timeline_story rows, sees no difference
 * right after a write and the right kind after a change, and is served
 * whatever the comparison does. On a scratch database (golden rule 9).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { createSession } from "@elixir-mcp/auth";
import {
  storySpan,
  writeSubjectStories,
} from "@elixir-mcp/tools/activity/story-store";
import { makeHandler } from "../src/handler.mjs";
import { shadowStories } from "../src/routes/player.mjs";

// Made-up tags: this repository is public.
const P = "#0GRJCUV";
const MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();

let scratch, token;
const lines = [];
let failCompare = false;
const NOW = Date.now();

const shadow = (db, tag, built, window) =>
  shadowStories(db, tag, built, window, {
    log: (line) => lines.push(JSON.parse(line)),
    ...(failCompare
      ? {
          compare: () => {
            throw Object.assign(new Error(`no row for ${P}`), {
              code: "57014",
            });
          },
        }
      : {}),
  });

async function battle(id, ms) {
  const { db } = scratch;
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ($1, $2, 'PvP', 'pvp', $3)`,
    [id, iso(ms), iso(ms + MIN)],
  );
  await db.query(
    `insert into battle_participant
       (battle_id, player_tag, battle_time, side, type, type_class, crowns, trophy_change, outcome)
     values ($1, $2, $3, 0, 'PvP', 'pvp', 3, 30, 'win')`,
    [id, P, iso(ms)],
  );
}

let handler;
const page = async () => {
  const r = await handler({
    path: "/api/player",
    method: "GET",
    queryStringParameters: { tag: P },
    headers: {
      cookie: `__Host-elixir_session=${token}`,
      "x-elixir-client": "web",
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
  });
  assert.equal(r.statusCode, 200, r.body);
  return lines.at(-1);
};

before(async () => {
  scratch = await scratchDb("player_story_shadow");
  const { db } = scratch;
  await db.query("insert into player(player_tag,name) values ($1,'Rowan')", [
    P,
  ]);
  const id = (
    await db.query(
      "insert into account(email_hash,status) values ('shadow-reader','approved') returning account_id",
    )
  ).rows[0].account_id;
  ({ token } = await createSession(db, {
    secret: "test",
    accountId: id,
    emailHash: "shadow-reader",
  }));
  // Two sittings (a sitting is a story from its second battle).
  await battle("shadow-0", NOW - 3 * 86_400_000);
  await battle("shadow-0b", NOW - 3 * 86_400_000 + 5 * MIN);
  await battle("shadow-1", NOW - 120 * MIN);
  await battle("shadow-2", NOW - 115 * MIN);
  handler = makeHandler({
    databaseUrl: scratch.url,
    secret: "test",
    storyShadow: shadow,
  });
});

after(async () => {
  await scratch?.drop();
});

test("the switch is off by default: no shadow line", async () => {
  const off = makeHandler({ databaseUrl: scratch.url, secret: "test" });
  const before = lines.length;
  const r = await off({
    path: "/api/player",
    method: "GET",
    queryStringParameters: { tag: P },
    headers: {
      cookie: `__Host-elixir_session=${token}`,
      "x-elixir-client": "web",
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
  });
  assert.equal(r.statusCode, 200);
  assert.equal(lines.length, before);
});

test("right after a write the page and the rows agree", async () => {
  await writeSubjectStories(scratch.db, "player", P, storySpan(Date.now()));
  const line = await page();
  assert.equal(line.at, "timeline_story_shadow", JSON.stringify(line));
  assert.equal(line.computed, 2, JSON.stringify(line));
  assert.equal(line.computed, 2);
  assert.equal(line.stored, 2);
  for (const k of ["only_computed", "only_stored", "revision", "content"])
    assert.equal(line[k], 0, `${k}: ${JSON.stringify(line)}`);
  assert.equal(typeof line.ms, "number");
  // One compact line: counts and ids, never the tag or an item.
  assert.ok(!JSON.stringify(line).includes(P));
  assert.ok(!JSON.stringify(line).includes("Rowan"));
});

test("after a change the line names the buckets", async () => {
  await battle("shadow-3", NOW - 110 * MIN); // the sitting grows
  await battle("shadow-4", NOW - 40 * MIN); // a sitting no write saw
  const line = await page();
  assert.equal(line.revision, 1, JSON.stringify(line));
  assert.equal(line.only_computed, 1);
  assert.equal(line.only_stored, 0);
  assert.equal(line.content, 0);
  await scratch.db.query(
    `update player set name = 'Rowan Ash' where player_tag = $1`,
    [P],
  );
  await scratch.db.query(
    `delete from timeline_story where subject_tag = $1 and kind = 'battle_session'
        and sort_at < now() - interval '1 day'`,
    [P],
  );
  const after = await page();
  assert.equal(after.only_computed, 2, JSON.stringify(after));
  assert.equal(after.revision, 1);
  assert.equal(after.content, 0);
  await writeSubjectStories(scratch.db, "player", P, storySpan(Date.now()));
  const healed = await page();
  for (const k of ["only_computed", "only_stored", "revision", "content"])
    assert.equal(healed[k], 0, `${k}: ${JSON.stringify(healed)}`);
});

test("a failing comparison never fails the page, and logs only the error's class", async () => {
  failCompare = true;
  try {
    const line = await page();
    assert.equal(line.at, "timeline_story_shadow_failed");
    assert.equal(line.error, "57014");
    assert.ok(!JSON.stringify(line).includes(P));
  } finally {
    failCompare = false;
  }
  // The connection is clean after the rollback: the next page still reads.
  assert.equal((await page()).at, "timeline_story_shadow");
});
