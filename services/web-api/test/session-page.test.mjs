/**
 * A session's public page (2026-11-17, DECISIONS "A session's public
 * page"): /session/<tag>/<id>/<start>, its picture and its JSON, against a
 * real PostgreSQL database. The gate: the player is recorded, the item is a
 * sitting on the player's public timeline, and the start is the sitting's
 * to the second inside 30 days; anything else is a 404. Read as nobody:
 * game names only, never a nickname, a cheer, a comment or the reader's
 * own marks, and every name escaped where it is written.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createSession } from "@elixir-mcp/auth";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import {
  seedDeck,
  seedPlayedDeck,
} from "../../../packages/tools/test/deck-rows.mjs";
import { makeHandler } from "../src/handler.mjs";
import { drawItem, makeShareImage } from "../src/share-image.mjs";
import { fontMetrics } from "../src/font-metrics.mjs";
import { shareSources } from "../src/share-files.mjs";
import { buildTimeline } from "@elixir-mcp/tools/activity/entries";
import { createItemShare } from "../src/timeline-sharing.mjs";

// Made-up tags: this repository is public.
const A = "#0JQ8PL2V"; // the player whose session is shared
const O = "#0RY2GQ9C"; // the opponent
const B = "#0VLQ2P8Y"; // a player still playing
const HOSTILE = `<b>Al&der</b>" onload="x`;
const FOE = `<img src=x onerror=alert(1)>`;
const NICK = "Pet Name Nobody Else Sees";
const FOE_NICK = "What X Calls The Foe";
const SHELL = `<!doctype html><html><head>
    <title>Elixir</title>
    <meta name="description" content="The app" />
    <meta property="og:title" content="Elixir" />
  </head><body><div id="root"></div></body></html>`;
const CARDS = [
  26000021, 26000010, 26000030, 28000000, 26000038, 27000000, 26000014,
  28000011,
].map((id, i) => ({ id, name: `Card ${i}` }));

let scratch, handler, X, token;
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const data = (r) => JSON.parse(r.body);
const get = (path, { signedIn = false } = {}) =>
  handler({
    path: path.split("?")[0],
    method: "GET",
    queryStringParameters: Object.fromEntries(
      new URLSearchParams(path.split("?")[1] ?? ""),
    ),
    headers: {
      ...(signedIn ? { cookie: `__Host-elixir_session=${token}` } : {}),
      "x-elixir-client": "web",
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
  });

async function battles(tag, minutesAgo, deckHash = null) {
  for (const [i, [minutes, outcome, crowns, against]] of minutesAgo.entries()) {
    const id = createHash("sha256").update(`${tag}-${i}`).digest("hex");
    const t = iso(now - minutes * 60_000);
    await scratch.db.query(
      `insert into battle(battle_id,battle_time,type,type_class,created_at)
       values ($1,$2,'PvP','pvp',$2)`,
      [id, t],
    );
    await scratch.db.query(
      `insert into battle_participant(battle_id,player_tag,battle_time,side,type,type_class,crowns,trophy_change,outcome,deck_hash)
       values ($1,$2,$3,0,'PvP','pvp',$4,$5,$6,$7)`,
      [id, tag, t, crowns, outcome === "win" ? 30 : -30, outcome, deckHash],
    );
    if (deckHash)
      await seedPlayedDeck(scratch.db, {
        battle_id: id,
        player_tag: tag,
        cards: CARDS,
      });
    await scratch.db.query(
      `insert into battle_participant(battle_id,player_tag,battle_time,side,type,type_class,crowns,outcome)
       values ($1,$2,$3,1,'PvP','pvp',$4,$5)`,
      [id, O, t, against, outcome === "win" ? "loss" : "win"],
    );
  }
}

before(async () => {
  scratch = await scratchDb("session_page");
  const { db } = scratch;
  for (const [tag, name] of [
    [A, HOSTILE],
    [O, FOE],
    [B, "Birch"],
  ])
    await db.query("insert into player(player_tag,name) values ($1,$2)", [
      tag,
      name,
    ]);
  X = (
    await db.query(
      "insert into account(email_hash,status,timezone) values ('session-x','approved','America/Chicago') returning account_id",
    )
  ).rows[0].account_id;
  ({ token } = await createSession(db, {
    secret: "test",
    accountId: X,
    emailHash: "session-x",
  }));
  // X verified A, follows B, and named A and the foe privately: none of
  // it may reach the public page.
  await db.query(
    `insert into claim(account_id,player_tag,status,is_primary,relationship,verified_at,close)
     values ($1,$2,'verified',true,'primary',now(),false),
            ($1,$3,'unverified',false,'friend',null,true)`,
    [X, A, B],
  );
  await db.query(
    "insert into player_nickname(account_id,player_tag,nickname) values ($1,$2,$3), ($1,$4,$5)",
    [X, A, NICK, O, FOE_NICK],
  );
  const hash = await seedDeck(db, {
    battle_time: iso(now - 60 * 60_000),
    cards: CARDS,
  });
  // A's session: three battles, the last 40 minutes ago, so it has ended.
  await battles(
    A,
    [
      [50, "win", 3, 0],
      [45, "loss", 0, 1],
      [40, "win", 1, 0],
    ],
    hash,
  );
  // B's: still going, the last battle five minutes ago.
  await battles(B, [
    [10, "win", 2, 1],
    [5, "win", 1, 0],
  ]);
  const sources = shareSources();
  handler = makeHandler({
    databaseUrl: scratch.url,
    secret: "test",
    siteShell: async () => SHELL,
    shareImage: makeShareImage({
      assets: async () =>
        Object.fromEntries(
          await Promise.all(
            Object.entries(sources).map(async ([k, f]) => [
              k,
              await readFile(f),
            ]),
          ),
        ),
    }),
  });
});
after(() => scratch.drop());

/** The sitting as the signed-in page reads it, and its public address. */
async function sitting(tag) {
  const page = data(
    await get(`/api/player?tag=${encodeURIComponent(tag)}`, { signedIn: true }),
  );
  const item = page.timeline.find((it) => it.kind === "battle_session");
  assert.ok(item?.facts?.started_at, JSON.stringify(page.timeline));
  const start = Math.floor(Date.parse(item.facts.started_at) / 1000);
  return { item, start, rest: `${tag.slice(1)}/${item.id}/${start}` };
}

async function share(item, accountId = X, input = {}) {
  return createItemShare(scratch.db, accountId, {
    item_id: item.id,
    kind: item.kind,
    source: "game",
    subject: { kind: "player", tag: item.subject_tag },
    at: item.facts.started_at,
    ...input,
  });
}

test("one opaque link opens the canonical update, no history, aliases or social fields", async () => {
  const { item } = await sitting(A);
  const shared = await share(item);
  assert.match(
    shared.url,
    /^https:\/\/elixir.poapkings.com\/share\/[a-z2-7]{24}$/,
  );
  assert.deepEqual(
    await share(item),
    shared,
    "sharing twice is one stable link",
  );
  const res = await get(`/api/public/shared-items/${shared.id}`);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.match(res.headers["x-robots-tag"], /noindex, nofollow/);
  const body = data(res);
  assert.equal(body.item.id, item.id);
  assert.equal(body.item.facts.battles, 3);
  assert.equal(body.item.subjects.find((s) => s.tag === A).name, HOSTILE);
  assert.ok(body.item.deck.cards.length);
  for (const absent of [
    NICK,
    FOE_NICK,
    X,
    "account_id",
    "nickname",
    "cheers",
    "comments",
    "my_cheer",
    "offer_follow",
    "games",
    'url":"https://elixir.poapkings.com/battle',
  ])
    assert.ok(!res.body.includes(absent), absent);
});

test("client kind/time/facts cannot turn another update or private Clan state into a share", async () => {
  const { item } = await sitting(A);
  assert.equal(
    await share(item, X, { item_id: "tl_00000000000000000000" }),
    null,
  );
  assert.equal(
    await share(item, X, { subject: { kind: "player", tag: O } }),
    null,
  );
  assert.equal(await share(item, X, { at: "not-a-time" }), null);
  assert.equal(await share(item, X, { source: "attested" }), null);
  const canonical = await share(item, X, {
    facts: { nickname: "private", text: "fake" },
  });
  assert.ok(canonical);
  assert.ok(
    !(await get(`/api/public/shared-items/${canonical.id}`)).body.includes(
      "fake",
    ),
  );
});

test("the HTML preview escapes hostile names and is only this item", async () => {
  const { item } = await sitting(A);
  const { id, url } = await share(item);
  const res = await get(`/share/${id}`);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.ok(
    res.body.includes("&lt;b&gt;Al&amp;der&lt;/b&gt;&quot; onload=&quot;x"),
  );
  assert.doesNotMatch(res.body, /<b>Al|<img src=x|Pet Name/);
  assert.ok(res.body.includes(`content="${url}.png"`));
  assert.ok(res.body.includes('content="noindex, nofollow, noarchive"'));
});

test("the picture is PNG and contains only unaltered card art", async () => {
  const { item } = await sitting(A);
  const shared = await share(item);
  const body = data(await get(`/api/public/shared-items/${shared.id}`));
  const png = await get(`/share/${shared.id}.png`);
  assert.equal(png.statusCode, 200, png.body);
  const bytes = Buffer.from(png.body, "base64");
  assert.equal(bytes.readUInt32BE(16), 1200);
  assert.equal(bytes.readUInt32BE(20), 630);
  const files = shareSources();
  const metrics = Object.fromEntries(
    await Promise.all(
      ["interRegular", "interBold", "clash"].map(async (k) => [
        k,
        fontMetrics(await readFile(files[k])),
      ]),
    ),
  );
  const art = new Map(
    body.item.deck.cards.map((c) => [`${c.id}:${c.form ?? "base"}`, "AAAA"]),
  );
  const svg = drawItem(
    { ...body, shared: true },
    {
      regular: metrics.interRegular,
      bold: metrics.interBold,
      clash: metrics.clash,
      art,
    },
  );
  assert.ok(svg.includes("Won 2 of 3 on Trophy Road"));
  assert.equal(svg.match(/<image /g)?.length, 8);
  for (const tag of svg.match(/<image [^>]*>/g))
    assert.doesNotMatch(tag, /filter|mask|clip-path|opacity|transform/);
  assert.doesNotMatch(svg, /<filter|<mask|<clipPath|Pet Name/);
});

test("bare public links and all their former data and paging doors return404", async () => {
  const { item, rest } = await sitting(A);
  for (const path of [
    `/session/${rest}`,
    `/session/${rest}.png`,
    `/api/public/sessions/${rest}`,
    `/api/public/sessions/${rest}/1/version`,
    "/h/aaaaaaaaaaaaaaa",
    "/api/public/posts/aaaaaaaaaaaaaaa",
    `/api/public/shared-items/${item.id}`,
    "/api/public/shared-items/",
    "/share/aaaaaaaaaaaaaaaaaaaaaaaa/next",
  ])
    assert.equal((await get(path)).statusCode, 404, path);
});

test("capabilities do not open an anonymous source read or an arbitrary battle history", async () => {
  const {
    rows: [battle],
  } = await scratch.db.query("select battle_id from battle limit 1");
  const shared = await createItemShare(scratch.db, X, {
    source: "battle",
    battle_ref: battle.battle_id,
  });
  assert.ok(shared);
  const res = await get(`/api/public/shared-items/${shared.id}`);
  assert.equal(res.statusCode, 200, res.body);
  const body = data(res);
  assert.equal(body.item.kind, "battle");
  assert.equal(body.item.sides.length, 2);
  for (const absent of [
    "meetings",
    "sitting",
    "nickname",
    "comments",
    "url",
    "image",
  ])
    assert.ok(!(absent in body.item.battle), absent);
  for (const path of [
    `/battle/${battle.battle_id}`,
    `/battle/${battle.battle_id}.png`,
    `/api/public/battles/${battle.battle_id}`,
    `/api/me/battles/${battle.battle_id}`,
  ])
    assert.equal((await get(path)).statusCode, 404, path);
  const inside = await get(`/api/me/battles/${battle.battle_id}`, {
    signedIn: true,
  });
  assert.equal(inside.statusCode, 200, inside.body);
  assert.equal(data(inside).battle.id, battle.battle_id);
});

test("the member session page remains signed in and no longer emits an anonymous path", async () => {
  const { item } = await sitting(A);
  const path = `/api/player/session?tag=${A.slice(1)}&id=${item.id}&at=${encodeURIComponent(item.facts.started_at)}`;
  const denied = await get(path);
  assert.equal(denied.statusCode, 401);
  const inside = await get(path, { signedIn: true });
  assert.equal(inside.statusCode, 200, inside.body);
  assert.equal(data(inside).item.id, item.id);
  assert.equal(data(inside).url, undefined);
  assert.equal(data(inside).image, undefined);
});

test("a clan-owned arrival shares its canonical news without opening the clan history", async () => {
  const clan = "#0VGJQ28P";
  await scratch.db.query(
    "insert into clan(clan_tag,name) values($1,'<b>Clan & more</b>')",
    [clan],
  );
  await scratch.db.query(
    "insert into clan_membership(clan_tag,player_tag,role,joined_observed_at,baseline) values($1,$2,'member',$3,false)",
    [clan, A, new Date(now - 20 * 60000)],
  );
  await scratch.db.query(
    "insert into clan_event(clan_tag,event_type,timing,window_start,window_end,player_tag,role_after) values($1,'member_joined','estimated',$2,$3,$4,'member')",
    [clan, new Date(now - 21 * 60000), new Date(now - 20 * 60000), A],
  );
  const built = await buildTimeline(
    scratch.db,
    [{ kind: "clan", tag: clan, scope: "comprehensive" }],
    {
      fromMs: now - 86400_000,
      toMs: now,
      timezone: "UTC",
      basis: "occurred",
      accountLines: false,
    },
  );
  const item = built.timeline.find((it) => it.kind === "member_joined");
  assert.ok(
    item,
    JSON.stringify(built.timeline.map((it) => [it.kind, it.subject_tag])),
  );
  const shared = await createItemShare(scratch.db, X, {
    source: "game",
    item_id: item.id,
    kind: item.kind,
    subject: { kind: "clan", tag: clan },
    at: item.at,
  });
  assert.ok(shared);
  const res = await get(`/api/public/shared-items/${shared.id}`);
  assert.equal(res.statusCode, 200, res.body);
  const body = data(res);
  assert.equal(body.item.id, item.id);
  assert.ok(
    body.item.subjects.some((s) => s.kind === "clan" && s.tag === clan),
  );
  for (const absent of [
    "attested_by",
    "clan_policy",
    "decision",
    "hold",
    "nickname",
    "leader_note",
  ])
    assert.ok(!res.body.includes(absent), absent);
});
