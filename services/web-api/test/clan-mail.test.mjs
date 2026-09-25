/**
 * A family app's own mail (JSON API 2.4.0) over a scratch database: Elixir
 * Clan names who each email is for by player tag; Elixir sends only to the
 * account that verified the player, in the clan today, with the kind on,
 * once per clan per account per day, renders the app's lines escaped, and
 * refuses a link outside the family. Permissions that act on people are
 * never granted unnamed.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { createSession } from "@elixir-mcp/auth";
import { makeHandler } from "../src/handler.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_clan_mail_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
const CLAN = "#2PQRJ8LV";
const sent = [];
let db, handler, cookie, key, readOnlyKey;

const admin = (body) =>
  handler({
    rawPath: "/api/admin/integrations",
    requestContext: { http: { method: "POST" } },
    headers: { cookie, "x-elixir-client": "web" },
    body: JSON.stringify(body),
  });
const mail = (body, token = key) =>
  handler({
    rawPath: `/api/v1/clans/${encodeURIComponent(CLAN)}/mail`,
    requestContext: { http: { method: "POST" } },
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
const data = (r) => JSON.parse(r.body);

async function person(
  label,
  tag,
  { verified = true, inClan = true, email = `${label}@example.org` } = {},
) {
  const id = (
    await db.query(
      "insert into account(email_hash,email,status,role) values ($1,$2,'approved','member') returning account_id",
      [label, email],
    )
  ).rows[0].account_id;
  await db.query("insert into player(player_tag,name) values ($1,$2)", [
    tag,
    label,
  ]);
  await db.query(
    "insert into claim(account_id,player_tag,status,is_primary,relationship) values ($1,$2,$3,true,'primary')",
    [id, tag, verified ? "verified" : "unverified"],
  );
  await db.query(
    "insert into clan_membership(clan_tag,player_tag,joined_observed_at,left_observed_at,role) values ($1,$2,now() - interval '9 days',$3,'member')",
    [CLAN, tag, inClan ? null : new Date()],
  );
  return id;
}

before(async () => {
  const a = new pg.Client({ connectionString: adminUrl });
  await a.connect();
  await a.query(`create database ${name}`);
  await a.end();
  await migrate({
    databaseUrl,
    migrationsDir: new URL("../../../db/migrations", import.meta.url).pathname,
  });
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  handler = makeHandler({
    databaseUrl,
    secret: "test",
    mail: { enqueue: async (msg) => sent.push(msg), archive: null },
  });
  const owner = (
    await db.query(
      "insert into account(email_hash,status,role) values ('admin','approved','admin') returning account_id",
    )
  ).rows[0].account_id;
  const session = await createSession(db, {
    secret: "test",
    accountId: owner,
    emailHash: "admin",
  });
  cookie = `__Host-elixir_session=${session.token}`;
  await db.query("insert into clan(clan_tag,name) values ($1,'Example Clan')", [
    CLAN,
  ]);
  key = data(
    await admin({ name: "elixir-clan", scopes: ["clans:read", "mail:send"] }),
  ).token;
  readOnlyKey = data(await admin({ name: "clan-reader" })).token;
});
after(async () => {
  await db?.end();
  const a = new pg.Client({ connectionString: adminUrl });
  await a.connect();
  await a.query(`drop database ${name} with (force)`);
  await a.end();
});

const message = (player_tag, extra = {}) => ({
  player_tag,
  subject: "2 actions waiting for you in Example Clan",
  lines: ["Promote to Elder: <b>Ada</b> (new)", "Remove from the clan: Quiet"],
  link: "https://clan.poapkings.com/clan/2PQRJ8LV/actions",
  ...extra,
});

test("only the account that verified a player in the clan, with the kind on, is sent the app's words, escaped and recorded", async () => {
  const lead = await person("lead", "#20QQL8CC");
  const off = await person("off", "#8QQ8QQ8Q");
  await db.query(
    "insert into account_email_pref(account_id,kind,enabled,via) values ($1,'clan_actions_waiting',false,'profile')",
    [off],
  );
  await person("unproven", "#9RRYR9RR", { verified: false });
  await person("gone", "#2PPGY0Q8", { inClan: false });
  await person("mute", "#UUYY22VV", { email: null });
  const r = await mail({
    kind: "clan_actions_waiting",
    messages: [
      "#20QQL8CC",
      "#8QQ8QQ8Q",
      "#9RRYR9RR",
      "#2PPGY0Q8",
      "#UUYY22VV",
      "#YYVV0022",
    ].map((t) => message(t)),
  });
  assert.equal(r.statusCode, 200, r.body);
  const by = Object.fromEntries(
    data(r).data.results.map((x) => [x.player_tag, x.status]),
  );
  assert.deepEqual(by, {
    "#20QQL8CC": "sent",
    "#8QQ8QQ8Q": "switched_off",
    "#9RRYR9RR": "no_account",
    "#2PPGY0Q8": "not_in_clan",
    "#UUYY22VV": "no_address",
    "#YYVV0022": "no_account",
  });
  assert.equal(sent.length, 1);
  const [msg] = sent;
  assert.equal(msg.kind, "clan_actions_waiting");
  assert.equal(msg.to, "lead@example.org");
  assert.equal(msg.subject, "2 actions waiting for you in Example Clan");
  assert.match(msg.unsubscribe.url, /\/api\/email\/unsubscribe\?t=/);
  assert.ok(
    msg.html.includes("&lt;b&gt;Ada&lt;/b&gt;"),
    "the app's words are escaped",
  );
  assert.ok(!msg.html.includes("<b>Ada</b>"));
  assert.match(
    msg.html,
    /clan\.poapkings\.com\/clan\/2PQRJ8LV\/actions\?utm_source=email/,
  );
  const { rows } = await db.query(
    "select s.account_id, i.kind, i.subject_key from email_send s join email_issue i using(issue_id)",
  );
  assert.deepEqual(rows, [
    { account_id: lead, kind: "clan_actions_waiting", subject_key: CLAN },
  ]);
  // Once per clan per account per day.
  const again = await mail({
    kind: "clan_actions_waiting",
    messages: [message("#20QQL8CC")],
  });
  assert.equal(data(again).data.results[0].status, "already_sent_today");
  assert.equal(sent.length, 1);
});

test("refusals: a link outside the family, an unknown kind, a bad message, a key without mail:send", async () => {
  const evil = await mail({
    kind: "clan_actions_waiting",
    messages: [message("#20QQL8CC", { link: "https://example.org/phish" })],
  });
  assert.equal(evil.statusCode, 400);
  assert.equal(data(evil).code, "invalid_mail");
  const kind = await mail({
    kind: "anything",
    messages: [message("#20QQL8CC")],
  });
  assert.equal(data(kind).code, "unknown_mail_kind");
  const empty = await mail({
    kind: "clan_actions_waiting",
    messages: [message("#20QQL8CC", { lines: [] })],
  });
  assert.equal(data(empty).code, "invalid_mail");
  const refused = await mail(
    { kind: "clan_actions_waiting", messages: [message("#20QQL8CC")] },
    readOnlyKey,
  );
  assert.equal(refused.statusCode, 403);
  assert.equal(data(refused).code, "insufficient_scope");
});

test("an integration made without a permission list gets none that act on people", async () => {
  const { rows } = await db.query(
    "select scopes from integration where name = 'clan-reader'",
  );
  assert.ok(rows[0].scopes.includes("clans:read"));
  assert.ok(!rows[0].scopes.includes("mail:send"));
  assert.ok(!rows[0].scopes.includes("facts:write"));
});
