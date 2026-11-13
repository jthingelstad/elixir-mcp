/**
 * A shared highlight posted in its player's clan's Discord (social slice
 * 9, #767). Pinned here: only the highlight's owner, only once it is
 * shared, only while the owner holds a verified claim and the player is
 * a member of a clan whose activity channel is on with "Shared
 * highlights" turned on by a leader (off by default); once only; the post
 * goes through the outbox's timeline-discord/ lane as a clan_activity
 * message with the channel's webhook still sealed, with a quality ledger
 * row; its words make a hostile name and hostile words literal (no
 * mention, markdown, timestamp or live link) and carry no clan name or
 * tag; and the relay, over a fake Discord, sends it with no mentions
 * allowed and embeds suppressed, and never again when its outcome was
 * unknown. No real webhook is ever called.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import pg from "pg";
import {
  validateTimelineDiscordMessage,
  webhookFingerprint,
} from "@elixir-mcp/contracts";
import { migrate } from "../../migrate/src/migrate.mjs";
import { processResult } from "../../../packages/ingest/src/pipeline.mjs";
import { emailHash } from "../../../packages/auth/src/index.mjs";
import { createPostgresLedger } from "../../../packages/clan-state/src/postgres.mjs";
import { createBox } from "../../../packages/clan/src/sealed.mjs";
import { createDiscordWebhook } from "../../../packages/clan/src/discord-webhook.mjs";
import { createTimelineDiscordWorker } from "../../../packages/syndication/src/relay.mjs";
import {
  clanActivitySeal,
  CLAN_ACTIVITY_PURPOSE,
} from "../../../packages/syndication/src/seal.mjs";
import {
  highlightPostContent,
  highlightPostKey,
} from "../../../packages/syndication/src/highlight-share.mjs";
import { makeHandler } from "../src/handler.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_hl_discord_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);

// The fixture's own player (fixtures/player_battlelog), in an invented clan.
const PLAYER = "#0QRVVG22J";
const CLAN = "#0UGC99RG";
const CLAN_NAME = "Invented Crowns";
const CHANNEL = "6f1d3c2a-4b5e-4f60-8a71-92b3c4d5e6f7";
const HOOK = `https://discord.com/api/webhooks/123456789012345678/${"w".repeat(68)}`;
const OWNER = "hl-discord-owner@example.com";
const OTHER = "hl-discord-other@example.com";
const HOSTILE_NAME = "@everyone **Boss** <@&4242>";
const HOSTILE_WORDS =
  "gg @here <@123456789012345678> <t:1700000000:R>\n# big\n[click](https://evil.example) ||spoiler|| `code`";

const box = clanActivitySeal(
  createBox("hl-discord-secret", CLAN_ACTIVITY_PURPOSE),
);

let db, handler, battleId, otherBattleId, ownerId;
const sent = [];
const cookies = {};
// Every outbox object the routes write.
const outbox = [];

const request = (method, p, { body, who } = {}) =>
  handler({
    path: p.split("?")[0],
    method,
    queryStringParameters: p.includes("?")
      ? Object.fromEntries(new URLSearchParams(p.split("?")[1]))
      : undefined,
    headers: {
      ...(who ? { cookie: cookies[who] } : {}),
      "cloudfront-viewer-address": "8.8.4.4:443",
      "x-elixir-client": "web",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const call = async (method, p, opts) => {
  const res = await request(method, p, opts);
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

async function signIn(email) {
  await request("POST", "/api/auth", { body: { age_13: true, email } });
  const { code } = sent.at(-1);
  const res = await request("POST", "/api/auth/code", {
    body: { email, code },
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.headers["set-cookie"].split(";")[0];
}

async function account(email, claim) {
  const {
    rows: [a],
  } = await db.query(
    `insert into account (email_hash, status, role, timezone)
     values ($1, 'approved', 'member', 'UTC') returning account_id`,
    [emailHash(email)],
  );
  if (claim)
    await db.query(
      `insert into claim (account_id, player_tag, is_primary, relationship,
                          notify, status)
       values ($1, $2, true, 'primary', true, 'verified')`,
      [a.account_id, PLAYER],
    );
  return a.account_id;
}

const discordLane = () => outbox.filter((o) => o.lane === "timeline-discord");
const highlightOn = async (battle) =>
  (await call("GET", `/api/me/highlights?battle=${battle}`, { who: "owner" }))
    .body.highlights[0];

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
  const {
    rows: [operator],
  } = await db.query(
    `insert into account (email_hash, status) values ('hl-discord-op', 'approved')
     returning account_id`,
  );
  await db.query(`insert into player (player_tag) values ($1)`, [PLAYER]);
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by) values ('player', $1, $2)`,
    [PLAYER, operator.account_id],
  );
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'hl-discord-gw', '127.0.0.1', 'active') returning gateway_id`,
    [operator.account_id],
  );
  const send = async (endpoint, entityKey, rel, fetchedAt) => {
    const payload = JSON.parse(
      await readFile(path.join(repoRoot, "fixtures", rel), "utf8"),
    );
    const result = await processResult(db, {
      v: 1,
      job: { endpoint, entity_key: entityKey, lane: "bulk" },
      gateway_id: gw.gateway_id,
      fetched_at: fetchedAt,
      status: "ok",
      body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
        "base64",
      ),
    });
    assert.equal(result.outcome, "admitted", JSON.stringify(result));
  };
  await send("cards", "GLOBAL", "cards/catalog.json", "2026-09-03T13:00:00Z");
  await send(
    "player_battlelog",
    PLAYER,
    "player_battlelog/with_colosseum_duel.json",
    "2026-09-03T14:30:34Z",
  );
  await db.query(`update player set name = $2 where player_tag = $1`, [
    PLAYER,
    HOSTILE_NAME,
  ]);
  const { rows } = await db.query(
    `select bp.battle_id from battle_participant bp join battle b using (battle_id)
      where bp.player_tag = $1 and b.type = 'PvP'
      order by b.battle_time desc limit 2`,
    [PLAYER],
  );
  [battleId, otherBattleId] = rows.map((r) => r.battle_id);

  // The player is a member of a clan whose leaders connected its
  // activity channel, with a saved policy.
  await db.query(
    `insert into clan (clan_tag, name) values ($1, $2)
     on conflict (clan_tag) do update set name = excluded.name`,
    [CLAN, CLAN_NAME],
  );
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at)
     values ($1, $2, now() - interval '30 days')`,
    [CLAN, PLAYER],
  );
  await db.query(
    `insert into clan_activity_discord
            (clan_tag, channel_id, webhook_sealed, webhook_fp, webhook_display,
             enabled, enabled_at, synced_to, categories, set_by)
     values ($1, $2, $3, $4, 'discord.com/api/webhooks/…', true, now(), now(), '{}', '#LEADER')`,
    [CLAN, CHANNEL, box.seal(HOOK, CHANNEL), webhookFingerprint(HOOK)],
  );
  await createPostgresLedger(db).savePolicy(CLAN, {
    values: { war_intent: "participating" },
    by: "#LEADER",
  });

  handler = makeHandler({
    databaseUrl,
    secret: "hl-discord-secret",
    sendLoginEmail: async (m) => sent.push(m),
    notifyOwner: async () => {},
    sendWelcomeEmail: async () => {},
    siteShell: async () => "<!doctype html><title>Elixir</title>",
    discord: {
      outbox: async (lane, message, opts) =>
        outbox.push({ lane, message, opts }),
    },
  });
  ownerId = await account(OWNER, true);
  await account(OTHER, false);
  cookies.owner = await signIn(OWNER);
  cookies.other = await signIn(OTHER);
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
});

test("the post's words: a hostile name and words are literal, no clan name, no tag, one unpreviewed link", () => {
  const content = highlightPostContent({
    name: HOSTILE_NAME,
    playerTag: PLAYER,
    words: HOSTILE_WORDS,
    battle: { outcome: "win", crowns: 3, crowns_against: 1 },
    url: "https://elixir.poapkings.com/h/abcdefghijklmno",
  });
  const lines = content.split("\n");
  assert.equal(lines.length, 3, content);
  assert.match(lines[0], /^\*\*.*\*\* shared a highlight: a 3-1 win$/);
  assert.match(lines[1], /^> “.*”$/);
  assert.equal(
    lines[2],
    "[Open in Elixir](<https://elixir.poapkings.com/h/abcdefghijklmno>)",
  );
  const body = lines.slice(0, 2).join("\n");
  // Every @, <, :, [, *, `, | and # a person typed is escaped or folded.
  assert.doesNotMatch(body, /(^|[^\\])[@<[`|]/);
  assert.doesNotMatch(body, /(^|[^\\])https?:\/\//);
  assert.ok(!body.slice(2, -2).includes("**Boss"), "no markdown from the name");
  assert.ok(!content.includes(PLAYER), "no tag beside a name");
  assert.ok(!content.includes(CLAN_NAME));
  // No words: just the line and the link; no record: "a battle".
  assert.equal(
    highlightPostContent({
      name: "Ana",
      playerTag: PLAYER,
      words: "  ",
      battle: {},
      url: "https://elixir.poapkings.com/h/x",
    }),
    "**Ana** shared a highlight: a battle\n[Open in Elixir](<https://elixir.poapkings.com/h/x>)",
  );
});

test("only the owner, only shared, only where the leaders turned it on, once", async () => {
  const made = await call("POST", "/api/me/highlights", {
    who: "owner",
    body: { battle: battleId, words: HOSTILE_WORDS },
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const id = made.body.highlight.highlight_id;
  const ask = (who = "owner", body = { highlight_id: id }) =>
    call("POST", "/api/me/highlights/discord", { who, body });

  // Signed out, and someone else's highlight.
  assert.equal(
    (
      await call("POST", "/api/me/highlights/discord", {
        body: { highlight_id: id },
      })
    ).status,
    401,
  );
  assert.equal((await ask("other")).status, 404);
  // Not shared yet: nothing becomes public by this.
  const unshared = await ask();
  assert.equal(unshared.status, 409);
  assert.equal(unshared.body.error, "not_shared");
  await call("POST", "/api/me/highlights/share", {
    who: "owner",
    body: { highlight_id: id },
  });
  // Shared, but the leaders have not turned shared highlights on: off by
  // default, whatever the policy says.
  assert.deepEqual((await highlightOn(battleId)).clan_discord, {
    available: false,
    posted_at: null,
  });
  const closed = await ask();
  assert.equal(closed.status, 409);
  assert.equal(closed.body.error, "not_open");
  assert.equal(discordLane().length, 0);

  // A leader turns them on.
  await db.query(
    `update clan_activity_discord set categories = '{"highlights": true}'
      where clan_tag = $1`,
    [CLAN],
  );
  assert.deepEqual((await highlightOn(battleId)).clan_discord, {
    available: true,
    posted_at: null,
  });
  const posted = await ask();
  assert.equal(posted.status, 200, JSON.stringify(posted.body));
  assert.equal(posted.body.already, false);
  const out = discordLane();
  assert.equal(out.length, 1);
  const { message, opts } = out[0];
  assert.ok(validateTimelineDiscordMessage(message).ok);
  assert.equal(message.kind, "clan_activity");
  assert.equal(message.account_id, CHANNEL);
  // The webhook as the row keeps it, still sealed; never the address.
  assert.equal(box.open(message.webhook, CHANNEL), HOOK);
  assert.ok(!JSON.stringify(message).includes("webhooks/"));
  assert.equal(message.posts.length, 1);
  const [p] = message.posts;
  assert.equal(p.key, highlightPostKey(id));
  assert.equal(p.revision, 1);
  assert.match(p.content, /shared a highlight/);
  assert.match(
    p.content,
    /\[Open in Elixir\]\(<https:\/\/.+\/h\/[a-z2-7]{15}>\)$/,
  );
  assert.equal(opts.once, true);
  const {
    rows: [ledger],
  } = await db.query(
    `select feature, action, mode, destination, post_key, account_id, clan_tag
       from discord_post where post_id = $1`,
    [p.ledger_id],
  );
  assert.deepEqual(ledger, {
    feature: "clan_activity",
    action: "post",
    mode: "code",
    destination: CHANNEL,
    post_key: p.key,
    account_id: ownerId,
    clan_tag: CLAN,
  });
  assert.equal((await highlightOn(battleId)).clan_discord.available, false);
  assert.ok((await highlightOn(battleId)).clan_discord.posted_at);

  // Once: a second ask sends nothing.
  const again = await ask();
  assert.equal(again.status, 200);
  assert.equal(again.body.already, true);
  assert.equal(discordLane().length, 1);

  // The relay, over a fake Discord: no mentions, no previews; and an
  // unknown outcome is never sent again.
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (calls.length === 1) throw new Error("connect ECONNRESET");
    return new Response(JSON.stringify({ id: "998877665544332211" }), {
      status: 200,
    });
  };
  const objects = new Map();
  let n = 0;
  const put = (k, b) => {
    objects.set(k, { body: structuredClone(b), etag: `"${(n += 1)}"` });
    return objects.get(k).etag;
  };
  const store = {
    read: async (k) => objects.get(k) ?? null,
    create: async (k, b) => (objects.has(k) ? null : put(k, b)),
    replace: async (k, b, e) => (objects.get(k)?.etag === e ? put(k, b) : null),
    put: async (k, b) => void put(k, b),
    remove: async (k) => void objects.delete(k),
    readObject: async (o) => JSON.stringify(objects.get(o.key)?.body ?? null),
    deleteObject: async (o) => void objects.delete(o.key),
  };
  let t = Date.parse("2026-11-12T12:00:00Z");
  const work = createTimelineDiscordWorker({
    discord: createDiscordWebhook({
      fetch,
      pause: async () => {},
      clock: () => 0,
    }),
    store,
    open: (sealed, cid) => box.open(sealed, cid),
    now: () => t,
    pause: async (ms) => {
      t += ms;
    },
    log: { log: () => {}, error: () => {} },
  });
  const deliver = async () => {
    const key = `timeline-discord/highlight-${id}.json`;
    objects.set(key, { body: message, etag: '"o"' });
    try {
      await work({ bucket: "outbox", key }, { final: false });
    } catch {
      // A retry is the queue's; the test reads what reached Discord.
    }
  };
  await deliver();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${HOOK}?wait=true`);
  assert.deepEqual(calls[0].body, {
    content: p.content,
    allowed_mentions: { parse: [] },
    flags: 4,
  });
  t += 10 * 60_000;
  await deliver();
  assert.equal(calls.length, 1, "an unknown outcome is never posted again");
});

test("not your player any more, or not in a clan: refused", async () => {
  const made = await call("POST", "/api/me/highlights", {
    who: "owner",
    body: { battle: otherBattleId, words: "" },
  });
  const id = made.body.highlight.highlight_id;
  await call("POST", "/api/me/highlights/share", {
    who: "owner",
    body: { highlight_id: id },
  });
  await db.query(
    `update clan_membership set left_observed_at = now() where player_tag = $1`,
    [PLAYER],
  );
  const noClan = await call("POST", "/api/me/highlights/discord", {
    who: "owner",
    body: { highlight_id: id },
  });
  assert.equal(noClan.status, 409);
  assert.equal(noClan.body.error, "no_clan");
  await db.query(
    `update claim set status = 'unverified' where account_id = $1`,
    [ownerId],
  );
  const notYours = await call("POST", "/api/me/highlights/discord", {
    who: "owner",
    body: { highlight_id: id },
  });
  assert.equal(notYours.status, 403);
  assert.equal(notYours.body.error, "not_your_player");
  assert.equal(discordLane().length, 1);
});
