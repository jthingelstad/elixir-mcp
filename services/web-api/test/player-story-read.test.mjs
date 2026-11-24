/**
 * The stored read on the player page (stage 3 of the stored Timeline,
 * 2026-11-24): with TimelineStoryRead on and a fresh write, the page, its
 * games' read and its session read answer exactly what they compute, and
 * each logs one `timeline_story_read` line of counts naming its door;
 * every refusal and any error computes; with the switch off nothing reads
 * the rows; the shadow still compares a computed build and says which was
 * served. On a scratch database (golden rule 9).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createSession } from "@elixir-mcp/auth";
import { recordDropGame } from "@elixir-mcp/record/attested-facts";
import {
  readSubjectStories,
  storySpan,
  writeSubjectStories,
} from "@elixir-mcp/tools/activity/story-store";
import { itemVisibility } from "@elixir-mcp/tools/activity/entries";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { emitEvent } from "../../../packages/ingest/src/events.mjs";
import {
  seedDeck,
  seedPlayedDeck,
} from "../../../packages/tools/test/deck-rows.mjs";
import { makeHandler } from "../src/handler.mjs";
import { readSitting, shadowStories } from "../src/routes/player.mjs";

// Invented tags (docs/invented-tags.json): this repository is public.
const P = "#0RQ8L9"; // the player, verified by OWNER, followed by READER
const NEVER = "#0RQ8LC"; // recorded, never written
const OPEN = "#0RQ8LG"; // written while a sitting was open
const CLAN = "#0RQ8PL";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const CARDS = [
  26000021, 26000010, 26000030, 28000000, 26000038, 27000000, 26000014,
  28000011,
].map((id, i) => ({ id, name: `Card ${i}` }));

let scratch, db, token, OWNER, READER, deckHash;
const lines = [];
const reads = () => lines.filter((l) => l.at === "timeline_story_read");
const log = (line) => lines.push(JSON.parse(line));

async function battle(tag, id, ms, { created = ms + MIN, deck = null } = {}) {
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ($1, $2, 'PvP', 'pvp', $3)`,
    [id, iso(ms), iso(created)],
  );
  await db.query(
    `insert into battle_participant
       (battle_id, player_tag, battle_time, side, type, type_class, crowns, trophy_change, outcome, deck_hash)
     values ($1, $2, $3, 0, 'PvP', 'pvp', 3, 30, 'win', $4)`,
    [id, tag, iso(ms), deck],
  );
  if (deck)
    await seedPlayedDeck(db, { battle_id: id, player_tag: tag, cards: CARDS });
}

const handlers = new Map();
const handlerFor = (key, options) => {
  if (!handlers.has(key))
    handlers.set(
      key,
      makeHandler({ databaseUrl: scratch.url, secret: "test", ...options }),
    );
  return handlers.get(key);
};
const on = () => handlerFor("on", { storyRead: { log } });
const off = () => handlerFor("off", {});
async function get(handler, path, query) {
  const r = await handler({
    path,
    method: "GET",
    queryStringParameters: query,
    headers: {
      cookie: `__Host-elixir_session=${token}`,
      "x-elixir-client": "web",
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
  });
  assert.equal(r.statusCode, 200, r.body);
  return JSON.parse(r.body);
}
const page = (handler, tag = P) => get(handler, "/api/player", { tag });
/** The page from both handlers: what it computes, and what the stored
 *  read serves, with the one line the stored read logged. */
async function both(path, query) {
  const computed = await get(off(), path, query);
  const from = lines.length;
  const stored = await get(on(), path, query);
  const logged = lines
    .slice(from)
    .filter((l) => l.at === "timeline_story_read");
  assert.equal(logged.length, 1, JSON.stringify(logged));
  return { computed, stored, line: logged[0] };
}
const write = (tag, now = Date.now()) =>
  writeSubjectStories(db, "player", tag, storySpan(now));
const setWritten = (tag, ms) =>
  db.query(
    `update timeline_story_subject set written_at = $2
      where subject_kind = 'player' and subject_tag = $1`,
    [tag, iso(ms)],
  );

before(async () => {
  scratch = await scratchDb("player_story_read");
  db = scratch.db;
  const person = async (hash) =>
    (
      await db.query(
        "insert into account(email_hash,status,timezone) values ($1,'approved','America/Chicago') returning account_id",
        [hash],
      )
    ).rows[0].account_id;
  OWNER = await person("story-read-owner");
  READER = await person("story-read-reader");
  ({ token } = await createSession(db, {
    secret: "test",
    accountId: READER,
    emailHash: "story-read-reader",
  }));
  for (const tag of [P, NEVER, OPEN])
    await db.query("insert into player(player_tag,name) values ($1,'Hazel')", [
      tag,
    ]);
  for (const tag of [P, NEVER, OPEN])
    await db.query(
      `insert into recording (subject_type, subject_tag, requested_by, origin)
       values ('player', $1, $2, 'claim')`,
      [tag, OWNER],
    );
  // Verified by its owner three days ago (a member item); followed by the
  // reader, who may see its Drop games.
  await db.query(
    `insert into claim(account_id,player_tag,status,is_primary,relationship,verified_at)
     values ($1,$2,'verified',true,'primary',$3)`,
    [OWNER, P, iso(NOW - 3 * DAY)],
  );
  await db.query(
    "insert into account_passport(account_id,passport_id) values ($1,$2)",
    [OWNER, "bcdefghjkmnp"],
  );
  await db.query(
    "insert into claim(account_id,player_tag,relationship,notify) values($1,$2,'friend',true)",
    [READER, P],
  );
  // A clan joined two days ago, which a roster read saw.
  await db.query("insert into clan(clan_tag,name) values ($1,'Copse')", [CLAN]);
  await db.query(
    `insert into clan_membership(clan_tag,player_tag,role,joined_observed_at,baseline)
     values ($1,$2,'member',$3,false)`,
    [CLAN, P, iso(NOW - 2 * DAY)],
  );
  // Two sittings with their deck (a spark and a deck row each).
  deckHash = await seedDeck(db, {
    battle_time: iso(NOW - 4 * DAY),
    cards: CARDS,
  });
  // Costs give the deck its shape, and so its label (a sitting's decks).
  const costs = [4, 1, 1, 4, 2, 3, 4, 2];
  for (const [i, c] of CARDS.entries())
    await db.query("update card set elixir_cost = $2 where card_id = $1", [
      c.id,
      costs[i],
    ]);
  for (const [i, m] of [0, 5, 10].entries()) {
    await battle(P, `story-read-a${i}`, NOW - 3 * DAY + m * MIN, {
      deck: deckHash,
    });
    await battle(P, `story-read-b${i}`, NOW - 3 * HOUR + m * MIN, {
      deck: deckHash,
    });
  }
  // A promotion proved by a battle of the later sitting.
  await emitEvent(db, "ranked_promotion", {
    tag: P,
    payload: { from: 2, to: 3, promoted_by: { battle_id: "story-read-b1" } },
    windowStart: iso(NOW - 3 * HOUR),
    windowEnd: iso(NOW - 2 * HOUR),
    occurredAt: iso(NOW - 3 * HOUR + 5 * MIN),
  });
  // A deck switch to the sittings' deck, at the clan move's instant: two
  // stories at one instant are served in one order, built or stored (the
  // stage 3 note, "Order").
  await emitEvent(db, "deck_switched", {
    tag: P,
    windowStart: iso(NOW - 2 * DAY - HOUR),
    windowEnd: iso(NOW - 2 * DAY),
    occurredAt: iso(NOW - 2 * DAY),
    payload: {
      mode_group: "ladder",
      deck_hash: deckHash,
      prior_deck_hash: "story-read-prior",
      battles: 5,
      wins: 3,
    },
  });
  // A Drop game the reader may see: never stored, read live.
  const started = NOW - HOUR;
  await recordDropGame(db, {
    version: 1,
    type: "drop.game.completed",
    accountId: OWNER,
    playerTag: P,
    gameId: randomUUID(),
    mode: "exact-ten",
    startedAt: iso(started),
    completedAt: iso(started + 10_000),
    score: 10,
    answers: 1,
    cards: [
      { id: 26000000, name: "Knight", cost: 3, reason: "solution" },
      { id: 26000020, name: "Giant Skeleton", cost: 6, reason: "solution" },
      { id: 26000010, name: "Skeletons", cost: 1, reason: "solution" },
    ],
  });
  // OPEN's sitting: written while it was open, forty minutes ago.
  await battle(OPEN, "story-read-open-a", NOW - 45 * MIN);
  await battle(OPEN, "story-read-open-b", NOW - 40 * MIN);
  await write(P);
});

after(async () => {
  await scratch?.drop();
});

test("the page served from the rows is the page computed", async () => {
  const { computed, stored, line } = await both("/api/player", { tag: P });
  assert.deepEqual(line, {
    at: "timeline_story_read",
    door: "page",
    source: "stored",
    reason: null,
    stories: line.stories,
    ms: line.ms,
  });
  assert.ok(line.stories > 0);
  assert.equal(typeof line.ms, "number");
  assert.ok(!JSON.stringify(line).includes(P));
  // The fixture reaches every kind the decision names.
  const kinds = new Set(stored.timeline.map((it) => it.kind));
  for (const k of [
    "battle_session",
    "ranked_promotion",
    "clan_joined",
    "player_verified",
    "deck_switched",
    "drop_game",
  ])
    assert.ok(kinds.has(k), `${k}: ${[...kinds]}`);
  const sitting = stored.timeline.find((it) => it.kind === "battle_session");
  assert.ok(sitting.spark, JSON.stringify(sitting));
  assert.ok(sitting.deck, JSON.stringify(sitting));
  // Two stories at one instant: the same order from the rows as built.
  const at = (kind) => stored.timeline.find((it) => it.kind === kind).at;
  assert.equal(at("clan_joined"), at("deck_switched"));
  assert.deepEqual(stored, computed);
});

test("a sitting's games and its session read the same from the rows", async () => {
  const { timeline } = await page(off());
  const sitting = timeline.find((it) => it.kind === "battle_session");
  const games = await both("/api/player/evidence", {
    tag: P,
    evidence_item_id: sitting.id,
    expected_evidence_version: sitting.evidence.version,
  });
  assert.equal(games.line.door, "evidence");
  assert.equal(games.line.source, "stored");
  assert.ok(games.stored.battles.length > 0, JSON.stringify(games.stored));
  assert.deepEqual(games.stored, games.computed);
  const session = await both("/api/player/session", {
    tag: P,
    id: sitting.id,
    at: sitting.facts.started_at,
    expected_evidence_version: sitting.evidence.version,
  });
  assert.equal(session.line.door, "session");
  assert.equal(session.line.source, "stored");
  assert.equal(session.stored.item.id, sitting.id);
  assert.equal(session.stored.item.evidence.version, sitting.evidence.version);
  assert.deepEqual(session.stored, session.computed);
});

test("signed out, the session read serves public rows only", async () => {
  const { timeline } = await page(off());
  const sitting = timeline.find((it) => it.kind === "battle_session");
  const asked = [];
  const storyRead = {
    log,
    read: async (d, kind, tag, opts) => {
      const out = await readSubjectStories(d, kind, tag, opts);
      asked.push({ visibilities: opts.visibilities, out });
      return out;
    },
  };
  const from = lines.length;
  const args = { id: sitting.id, at: sitting.facts.started_at };
  const stored = await readSitting(db, P, {
    ...args,
    publicOnly: true,
    storyRead,
  });
  const computed = await readSitting(db, P, { ...args, publicOnly: true });
  assert.deepEqual(
    asked.map((a) => a.visibilities),
    [["public"]],
  );
  assert.equal(asked[0].out.ok, true);
  assert.ok(asked[0].out.items.length > 0);
  for (const it of asked[0].out.items)
    assert.equal(itemVisibility(it), "public");
  assert.ok(!asked[0].out.items.some((it) => it.kind === "player_verified"));
  assert.deepEqual(
    lines.slice(from).map((l) => [l.door, l.source]),
    [["session", "stored"]],
  );
  assert.deepEqual(stored, computed);
});

test("each refusal computes, and says why", async () => {
  const reasonOf = async (tag) => {
    const from = lines.length;
    const served = await page(on(), tag);
    const [line] = lines.slice(from);
    assert.equal(line.at, "timeline_story_read");
    assert.equal(line.source, "computed");
    assert.equal(line.stories, 0);
    assert.deepEqual(served, await page(off(), tag));
    return line.reason;
  };
  assert.equal(await reasonOf(NEVER), "unwritten");
  // OPEN was written while its sitting was open; the clock has closed it.
  await writeSubjectStories(db, "player", OPEN, storySpan(NOW - 35 * MIN));
  assert.equal(await reasonOf(OPEN), "open");
  // P written seven hours ago: stale.
  const { rows } = await db.query(
    `select written_at from timeline_story_subject where subject_tag = $1`,
    [P],
  );
  await setWritten(P, Date.now() - 7 * HOUR);
  assert.equal(await reasonOf(P), "stale");
  await setWritten(P, rows[0].written_at.getTime());
  assert.equal((await page(on())) && reads().at(-1).source, "stored");
  // A battle learned after the write (another player's log, say): news,
  // until a write holds it.
  await battle(P, "story-read-news", NOW - 20 * DAY, { created: Date.now() });
  assert.equal(await reasonOf(P), "news");
  await write(P);
  assert.equal((await page(on())) && reads().at(-1).source, "stored");
});

test("an error or a slow read computes, and logs the error's class only", async () => {
  const failing = handlerFor("failing", {
    storyRead: {
      log,
      read: () => {
        throw Object.assign(new Error(`no row for ${P}`), { code: "XX000" });
      },
    },
  });
  const slow = handlerFor("slow", {
    storyRead: {
      log,
      read: (d) => d.query("select pg_sleep(2)"),
    },
  });
  const computed = await page(off());
  for (const [handler, error] of [
    [failing, "XX000"],
    [slow, "57014"],
  ]) {
    const from = lines.length;
    const started = Date.now();
    assert.deepEqual(await page(handler), computed);
    const [line] = lines.slice(from);
    assert.equal(line.source, "computed");
    assert.equal(line.reason, "error");
    assert.equal(line.error, error);
    assert.ok(!JSON.stringify(line).includes(P));
    if (error === "57014") assert.ok(Date.now() - started < 1500);
  }
  // The connection is clean after the rollback.
  assert.equal((await page(on())) && reads().at(-1).source, "stored");
});

test("with the switch off nothing reads the rows", async () => {
  const from = lines.length;
  await page(handlerFor("off-explicit", { storyRead: false }));
  await page(off());
  const { timeline } = await page(off());
  const sitting = timeline.find((it) => it.kind === "battle_session");
  await get(off(), "/api/player/evidence", {
    tag: P,
    evidence_item_id: sitting.id,
  });
  await get(off(), "/api/player/session", {
    tag: P,
    id: sitting.id,
    at: sitting.facts.started_at,
  });
  assert.deepEqual(lines.slice(from), []);
});

test("the shadow beside a stored page compares a computed build and says which was served", async () => {
  const shadow = (d, tag, built, window, opts) =>
    shadowStories(d, tag, built, window, { ...opts, log });
  const both = handlerFor("both", { storyRead: { log }, storyShadow: shadow });
  const from = lines.length;
  await page(both);
  const got = lines.slice(from);
  const read = got.find((l) => l.at === "timeline_story_read");
  const summary = got.find((l) => l.at === "timeline_story_shadow");
  assert.equal(read.source, "stored");
  assert.equal(summary.served, "stored", JSON.stringify(summary));
  assert.ok(summary.computed > 0);
  for (const k of ["only_computed", "only_stored", "revision", "content"])
    assert.equal(summary[k], 0, `${k}: ${JSON.stringify(summary)}`);
  // Computed (the stored read refused), the shadow says so.
  await setWritten(P, Date.now() - 7 * HOUR);
  const again = lines.length;
  await page(both);
  const computed = lines
    .slice(again)
    .find((l) => l.at === "timeline_story_shadow");
  assert.equal(computed.served, "computed");
});

test("a verification is read live: no row holds it, and a claim removed leaves a stored page at once", async () => {
  await write(P);
  const verified = (out) =>
    out.timeline.filter((it) => it.kind === "player_verified").length;
  const held = await both("/api/player", { tag: P });
  assert.equal(held.line.source, "stored");
  assert.equal(verified(held.stored), 1);
  const { rows } = await db.query(
    `select kind from timeline_story
      where subject_tag = $1
        and (kind = 'player_verified' or section = 'people')`,
    [P],
  );
  assert.deepEqual(rows, []);
  // The owner removes the claim. Nothing is written and no probe sees
  // it, so the rows are still served, and the verification is gone.
  await db.query(
    "delete from claim where account_id = $1 and player_tag = $2",
    [OWNER, P],
  );
  const gone = await both("/api/player", { tag: P });
  assert.equal(gone.line.source, "stored");
  assert.equal(verified(gone.stored), 0);
  assert.deepEqual(gone.stored, gone.computed);
});
