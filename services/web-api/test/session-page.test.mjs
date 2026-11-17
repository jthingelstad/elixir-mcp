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
import { sessionPostText } from "@elixir-mcp/ui/session-story";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import {
  seedDeck,
  seedPlayedDeck,
} from "../../../packages/tools/test/deck-rows.mjs";
import { makeHandler } from "../src/handler.mjs";
import { drawSession, makeShareImage } from "../src/share-image.mjs";
import { fontMetrics } from "../src/font-metrics.mjs";
import { shareSources } from "../src/share-files.mjs";
import { parseSessionRef, sessionPreview } from "../src/session-page.mjs";

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

test("the JSON: the sitting read as nobody, cached an hour once it ended", async () => {
  const { item, rest } = await sitting(A);
  const res = await get(`/api/public/sessions/${rest}`);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.headers["cache-control"], "public, max-age=3600");
  const body = data(res);
  assert.deepEqual(Object.keys(body).sort(), [
    "games",
    "image",
    "item",
    "marks",
    "open",
    "player",
    "url",
  ]);
  assert.deepEqual(body.player, { tag: A, name: HOSTILE });
  assert.equal(body.item.id, item.id);
  assert.equal(body.open, false);
  assert.equal(body.url, `https://elixir.poapkings.com/session/${rest}`);
  assert.equal(body.image, `${body.url}.png`);
  assert.deepEqual(
    body.games.battles.map((b) => b.outcome),
    ["win", "loss", "win"],
  );
  assert.deepEqual(
    body.games.battles[0].opponents.map((o) => o.name),
    [FOE],
  );
  // Each battle links its own public page.
  assert.ok(
    body.games.battles.every((b) => /\/battle\/[0-9a-f]{12}/.test(b.url)),
  );
  // The deck, its count across the whole sitting.
  assert.equal(body.games.decks[0].battles, 3);
  // Nothing of the reader, and nothing account-linked.
  for (const absent of [
    NICK,
    FOE_NICK,
    "cheer",
    "comment",
    "close",
    "verified",
    '"you"',
  ])
    assert.ok(!res.body.includes(absent), absent);
});

test("an open session: a minute at the edge, page, JSON and picture", async () => {
  const { rest } = await sitting(B);
  const json = await get(`/api/public/sessions/${rest}`);
  assert.equal(json.statusCode, 200, json.body);
  assert.equal(data(json).open, true);
  assert.equal(json.headers["cache-control"], "public, max-age=60");
  const page = await get(`/session/${rest}`);
  assert.equal(page.headers["cache-control"], "public, max-age=60");
  const png = await get(`/session/${rest}.png`);
  assert.equal(png.headers["cache-control"], "public, max-age=60");
});

test("a wrong start, id or tag is a 404, and so is any other shape", async () => {
  const { item, start } = await sitting(A);
  const tag = A.slice(1);
  for (const rest of [
    `${tag}/${item.id}/${start + 1}`,
    `${tag}/${item.id}/${start - 1}`,
    `${tag}/tl_${"0".repeat(20)}/${start}`,
    `${B.slice(1)}/${item.id}/${start}`,
    `0PYLQ2/${item.id}/${start}`,
    // Older than the page's 30 days, and in the future.
    `${tag}/${item.id}/${start - 40 * 86400}`,
    `${tag}/${item.id}/${Math.floor(now / 1000) + 86400}`,
    `${tag}/${item.id}`,
    `${tag}/${item.id}/${start}/extra`,
    `${tag}/${item.id}/not-a-time`,
    `nope/${item.id}/${start}`,
  ]) {
    const json = await get(`/api/public/sessions/${rest}`);
    assert.equal(json.statusCode, 404, rest);
    assert.equal(json.headers["cache-control"], "public, max-age=60", rest);
    const page = await get(`/session/${rest}`);
    assert.equal(page.statusCode, 404, rest);
    const png = await get(`/session/${rest}.png`);
    assert.equal(png.statusCode, 404, rest);
  }
});

test("an older page of battles names its version; a stale one is a 409", async () => {
  const { rest, item } = await sitting(A);
  const ok = await get(
    `/api/public/sessions/${rest}/0/${item.evidence.version}`,
  );
  assert.equal(ok.statusCode, 200, ok.body);
  const stale = await get(`/api/public/sessions/${rest}/1/ev_stale`);
  assert.equal(stale.statusCode, 409);
  assert.equal(
    parseSessionRef(`${rest}/1/bad version`, { paging: true }),
    null,
  );
  assert.equal(parseSessionRef(`${rest}/1/ev_x`), null, "paging is the JSON's");
});

test("the page: the shell named for the session, every name escaped", async () => {
  const { rest } = await sitting(A);
  const res = await get(`/session/${rest}`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "public, max-age=3600");
  assert.equal(res.body.match(/<title>/g).length, 1);
  assert.equal(res.body.match(/property="og:title"/g).length, 1);
  assert.ok(!res.body.includes("<b>"), "no raw markup from a name");
  assert.ok(!res.body.includes('" onload="'), "no attribute breakout");
  assert.ok(
    res.body.includes(
      `<meta property="og:title" content="&lt;b&gt;Al&amp;der&lt;/b&gt;&quot; onload=&quot;x: Won 2 of 3 on Trophy Road" />`,
    ),
    res.body,
  );
  assert.ok(
    res.body.includes(
      `<meta property="og:image" content="https://elixir.poapkings.com/session/${rest}.png" />`,
    ),
  );
  assert.ok(
    res.body.includes(
      `<link rel="canonical" href="https://elixir.poapkings.com/session/${rest}" />`,
    ),
  );
  assert.ok(res.body.includes('<meta name="robots" content="noindex" />'));
  assert.ok(
    res.body.includes(
      '<meta name="twitter:card" content="summary_large_image" />',
    ),
  );
  assert.match(
    res.body,
    /<meta property="og:description" content="3 battles: 2 won, 1 lost, \+30 trophies\. [^"]*UTC\." \/>/,
  );
  assert.ok(!res.body.includes(NICK));
});

test("the picture: a 1200 by 630 PNG, cached a day once ended", async () => {
  const { rest } = await sitting(A);
  const res = await get(`/session/${rest}.png`);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.headers["content-type"], "image/png");
  assert.equal(res.headers["cache-control"], "public, max-age=86400");
  const png = Buffer.from(res.body, "base64");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

test("the picture's SVG: the name escaped, the art drawn with nothing over it", async () => {
  const { rest } = await sitting(A);
  const read = {
    session: true,
    ...data(await get(`/api/public/sessions/${rest}`)),
  };
  const f = shareSources();
  const metrics = {
    regular: fontMetrics(await readFile(f.interRegular)),
    bold: fontMetrics(await readFile(f.interBold)),
    clash: fontMetrics(await readFile(f.clash)),
  };
  const deck = read.item.deck ?? read.games.decks[0];
  const art = new Map(
    deck.cards.map((c) => [`${c.id}:${c.form ?? "base"}`, "AAAA"]),
  );
  const svg = drawSession(read, { ...metrics, art });
  assert.ok(!svg.includes("<b>"));
  assert.ok(svg.includes("&lt;b&gt;Al&amp;der&lt;/b&gt;&quot; onload=&quot;x"));
  assert.ok(svg.includes("Won 2 of 3 on Trophy Road"));
  assert.ok(svg.includes("supercell.com/fan-content-policy"));
  assert.equal(svg.match(/<image /g).length, 8);
  // Nothing drawn over a card: no form ribbon, no level pill, no filter,
  // mask, clip or opacity on the art.
  for (const tag of svg.match(/<image [^>]*>/g))
    assert.doesNotMatch(tag, /filter|mask|clip-path|opacity|transform/);
  assert.doesNotMatch(svg, /<filter|<mask|<clipPath/);
  const last = svg.lastIndexOf("<image ");
  const after = svg.slice(last).split("\n").slice(1).join("\n");
  assert.doesNotMatch(after, /Evo|Hero/);
});

test("the post text and the preview: plain text, no line or markup a name could add", () => {
  const f = {
    battles: 12,
    won: 8,
    lost: 4,
    by_mode: { ladder: 12 },
    won_in_a_row: 5,
  };
  assert.equal(
    sessionPostText("Ki\nng\u202eThing\u0007", f, "https://e.x/session/1"),
    "Ki ng Thing: Won 8 of 12 on Trophy Road, 5 in a row\nhttps://e.x/session/1",
  );
  const preview = sessionPreview({
    player: { tag: A, name: FOE },
    item: {
      facts: { ...f, trophy_net: -12, started_at: "2026-11-16T14:05:00Z" },
    },
  });
  assert.equal(preview.title, `${FOE}: Won 8 of 12 on Trophy Road, 5 in a row`);
  assert.equal(
    preview.description,
    "12 battles: 8 won, 4 lost, −12 trophies. Mon Nov 16 2026, 2:05 pm UTC.",
  );
});

test("the signed-in session page names its public page and picture", async () => {
  const { item, rest } = await sitting(A);
  const res = await get(
    `/api/player/session?${new URLSearchParams({ tag: A, id: item.id, at: item.facts.started_at })}`,
    { signedIn: true },
  );
  assert.equal(res.statusCode, 200, res.body);
  const body = data(res);
  assert.equal(body.url, `https://elixir.poapkings.com/session/${rest}`);
  assert.equal(body.image, `${body.url}.png`);
  assert.deepEqual(body.you, { own: true, can_highlight: true });
});
