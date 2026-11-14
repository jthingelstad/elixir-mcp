/**
 * No bell flood at launch (#1015, 0272). An account made before Stamps
 * went live, with a verified player, a picture, a follow and cheers all
 * from before, opens Elixir after the deploy with no backfill run: its
 * first reconciliation files what it had already done as "Earned before",
 * the bell has no "New Stamp" line for any of it and one "Your passport
 * is ready" line, and the first thing it does after launch is one
 * ordinary "New Stamp" line. Invented names and tags only.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { emailHash } from "../../../packages/auth/src/index.mjs";
import { makeHandler } from "../src/handler.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_passport_launch_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);

const OWNER = "launch-owner@example.com";
const OWN = "#0YRQJGCJL";
const ALT = "#0990UQVG";
const FRIEND = "#0GC9P98LQ";
const DAY = 86_400_000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

let db, handler, cookie, owner;
const sent = [];

const call = async (method, p, body) => {
  const res = await handler({
    path: p,
    method,
    headers: {
      cookie,
      "cloudfront-viewer-address": "8.8.4.4:443",
      "x-elixir-client": "web",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.statusCode, body: JSON.parse(res.body || "null") };
};

async function signIn(email) {
  await handler({
    path: "/api/auth",
    method: "POST",
    headers: { "cloudfront-viewer-address": "8.8.4.4:443" },
    body: JSON.stringify({ age_13: true, email }),
  });
  const { code } = sent.at(-1);
  const res = await handler({
    path: "/api/auth/code",
    method: "POST",
    headers: { "cloudfront-viewer-address": "8.8.4.4:443" },
    body: JSON.stringify({ email, code }),
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.headers["set-cookie"].split(";")[0];
}

const bellStamps = (bell) =>
  bell.account.items.filter((i) => i.kind === "stamp_earned");

before(async () => {
  await createScratch(name);
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  // The deploy that applied 0272 went live a day ago.
  await db.query(`update passport_launch set launched_at = $1`, [ago(1)]);
  for (const [tag, player] of [
    [OWN, "Invented Launcher"],
    [ALT, "Invented Second"],
    [FRIEND, "Invented Friend"],
  ])
    await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
      tag,
      player,
    ]);
  await db.query(
    `insert into card (card_id, name, kind, icon_medium, in_catalog)
     values (26000000, 'Invented Card', 'card', 'https://example.invalid/a.png', true)
     on conflict (card_id) do update set kind = 'card', in_catalog = true,
       icon_medium = excluded.icon_medium`,
  );
  // Everything below was done before launch.
  const {
    rows: [a],
  } = await db.query(
    `insert into account (email_hash, status, role, timezone, created_at,
                          avatar_card_id, avatar_set_at)
     values ($1, 'approved', 'member', 'UTC', $2, 26000000, $3)
     returning account_id`,
    [emailHash(OWNER), ago(90), ago(40)],
  );
  owner = a.account_id;
  await db.query(
    `insert into claim (account_id, player_tag, is_primary, relationship,
                        status, verified_at, created_at)
     values ($1, $2, true, 'primary', 'verified', $3, $4),
            ($1, $5, false, 'friend', 'unverified', null, $6)`,
    [owner, OWN, ago(80), ago(85), FRIEND, ago(60)],
  );
  await db.query(
    `insert into timeline_cheer (account_id, item_id, cheer, created_at)
     values ($1, 'tl_000000000000000000a1', 'on_fire', $2),
            ($1, 'tl_000000000000000000a2', 'well_played', $3)`,
    [owner, ago(5), ago(4)],
  );
  handler = makeHandler({
    databaseUrl,
    secret: "launch-secret",
    sendLoginEmail: async (m) => sent.push(m),
    notifyOwner: async () => {},
    sendWelcomeEmail: async () => {},
  });
  cookie = await signIn(OWNER);
});

after(async () => {
  await db.end();
  await dropScratch(name);
});

test("a pre-launch account opens Elixir after the deploy: no New Stamp lines for old things, one passport line", async () => {
  // What the app does on open: the passport, its reconciliation, the bell.
  const read = await call("GET", "/api/me/passport");
  assert.equal(read.status, 200, JSON.stringify(read.body));
  const rec = await call("POST", "/api/me/passport/reconcile", {});
  assert.equal(rec.status, 200, JSON.stringify(rec.body));
  assert.deepEqual(rec.body.granted ?? [], []);
  const { rows: earned } = await db.query(
    `select stamp_id, earned_on, legacy_before from account_stamp_earned
      where account_id = $1 order by stamp_id`,
    [owner],
  );
  assert.deepEqual(
    earned.map((r) => r.stamp_id),
    ["looking_good", "player_verified"],
  );
  for (const r of earned) {
    assert.equal(r.earned_on, null);
    assert.ok(r.legacy_before);
  }
  const bell = await call("GET", "/api/me/bell");
  assert.equal(bell.status, 200, JSON.stringify(bell.body));
  assert.deepEqual(bellStamps(bell.body), []);
  const ready = bell.body.account.items.filter(
    (i) => i.kind === "passport_ready",
  );
  assert.equal(ready.length, 1);
  assert.equal(ready[0].stamps, 2);
  assert.equal(ready[0].new, true);
  // The passport says when: earned before the launch day.
  const after = await call("GET", "/api/me/passport");
  const shown = after.body.passport.earned;
  assert.equal(shown.length, 2);
  for (const e of shown) assert.ok(e.earned_before, JSON.stringify(e));
});

test("the first thing done after launch is one New Stamp line", async () => {
  const added = await call("POST", "/api/me/players", {
    player_tag: ALT,
    relationship: "alt",
  });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  const bell = await call("GET", "/api/me/bell");
  const stamps = bellStamps(bell.body);
  assert.deepEqual(
    stamps.map((i) => [i.stamp_id, i.level]),
    [["full_roster", 1]],
  );
  // Still one passport line, however many settles ran.
  await call("POST", "/api/me/passport/reconcile", {});
  const again = await call("GET", "/api/me/bell");
  assert.equal(
    again.body.account.items.filter((i) => i.kind === "passport_ready").length,
    1,
  );
  assert.equal(bellStamps(again.body).length, 1);
});
