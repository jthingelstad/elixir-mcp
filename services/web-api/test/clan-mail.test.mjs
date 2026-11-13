/**
 * Clan's "actions waiting for you" mail over a scratch database: Clan
 * names who each email is for by player tag; Elixir sends only to the
 * account that verified the player, in the clan today, with the kind on,
 * once per clan per account per day, renders Clan's lines escaped, and
 * refuses a link outside the family. The JSON API's mail door is gone
 * (4.0.0), and permissions that act on people are never granted unnamed.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { createSession } from "@elixir-mcp/auth";
import { makeHandler } from "../src/handler.mjs";
import { sendActionsMail } from "@elixir-mcp/mail/clan-mail";
import { actionsWaitingMail } from "../../../packages/clan-engine/src/mail.mjs";
import { actionLabel } from "../../../packages/clan-engine/src/actions.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_clan_mail_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
const CLAN = "#0QC8RCGY";
const sent = [];
let db, handler, cookie, readOnlyKey;

const admin = (body) =>
  handler({
    path: "/api/admin/integrations",
    method: "POST",
    headers: { cookie, "x-elixir-client": "web" },
    body: JSON.stringify(body),
  });
/** Clan's morning run's send, answered as status and body. */
async function mail(body) {
  try {
    const result = await sendActionsMail(db, CLAN, body, {
      enqueue: async (msg) => sent.push(msg),
      secret: "test",
      archive: null,
    });
    return { statusCode: 200, body: JSON.stringify({ data: result }) };
  } catch (e) {
    if (!e.status) throw e;
    return { statusCode: e.status, body: JSON.stringify({ code: e.code }) };
  }
}
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
  handler = makeHandler({ databaseUrl, secret: "test" });
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
  link: "https://elixir.poapkings.com/clan/0QC8RCGY/actions",
  ...extra,
});

test("only the account that verified a player in the clan, with the kind on, is sent the app's words, escaped and recorded", async () => {
  const lead = await person("lead", "#0LCLRCPQ");
  const off = await person("off", "#0J8CVLL8");
  await db.query(
    "insert into account_email_pref(account_id,kind,enabled,via) values ($1,'clan_actions_waiting',false,'profile')",
    [off],
  );
  await person("unproven", "#0Q0L80CC", { verified: false });
  await person("gone", "#0UY8VUR9", { inClan: false });
  await person("mute", "#0LUCVCJV", { email: null });
  const r = await mail({
    kind: "clan_actions_waiting",
    messages: [
      "#0LCLRCPQ",
      "#0J8CVLL8",
      "#0Q0L80CC",
      "#0UY8VUR9",
      "#0LUCVCJV",
      "#00UQL2U9",
    ].map((t) => message(t)),
  });
  assert.equal(r.statusCode, 200, r.body);
  const by = Object.fromEntries(
    data(r).data.results.map((x) => [x.player_tag, x.status]),
  );
  assert.deepEqual(by, {
    "#0LCLRCPQ": "sent",
    "#0J8CVLL8": "switched_off",
    "#0Q0L80CC": "no_account",
    "#0UY8VUR9": "not_in_clan",
    "#0LUCVCJV": "no_address",
    "#00UQL2U9": "no_account",
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
    /elixir\.poapkings\.com\/clan\/0QC8RCGY\/actions\?utm_source=email/,
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
    messages: [message("#0LCLRCPQ")],
  });
  assert.equal(data(again).data.results[0].status, "already_sent_today");
  assert.equal(sent.length, 1);
});

test("award scope with twelve maximum-length names still passes the real mail check", async () => {
  const tag = "#0LLV8GU9";
  await person("award-scope", tag);
  const card = {
    card_id: "award-scope",
    number: 9999999,
    type: "awards_announcement",
    status: "proposed",
    raised_at: "2026-10-06T11:00:00.000Z",
    evidence: {
      season_id: 136,
      awards: Array.from({ length: 12 }, (_, i) => ({
        name: `${String(i).padStart(2, "0")}${"A".repeat(38)}`,
      })),
    },
  };
  const [generated] = actionsWaitingMail({
    clanTag: CLAN,
    clanName: "Example Clan",
    appUrl: "https://elixir.poapkings.com/clan",
    cards: [card],
    people: [{ player_tag: tag, role: "leader" }],
  });
  const r = await mail({ kind: "clan_actions_waiting", messages: [generated] });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(data(r).data.results[0].status, "sent");
  assert.equal(
    generated.lines[0].title,
    actionLabel({ ...card, number: null }),
  );
  assert.equal(generated.lines[0].number, 9999999);
  assert.match(generated.lines[0].title, /and 10 more awards/);
  assert.equal(
    card.evidence.awards.length,
    12,
    "saved evidence stays complete",
  );
});

test("refusals: a link outside the family, an unknown kind, a bad message", async () => {
  const evil = await mail({
    kind: "clan_actions_waiting",
    messages: [message("#0LCLRCPQ", { link: "https://example.org/phish" })],
  });
  assert.equal(evil.statusCode, 400);
  assert.equal(data(evil).code, "invalid_mail");
  const kind = await mail({
    kind: "anything",
    messages: [message("#0LCLRCPQ")],
  });
  assert.equal(data(kind).code, "unknown_mail_kind");
  const empty = await mail({
    kind: "clan_actions_waiting",
    messages: [message("#0LCLRCPQ", { lines: [] })],
  });
  assert.equal(data(empty).code, "invalid_mail");
});

test("the JSON API has no mail door: a key gets the unknown operation's 404", async () => {
  const r = await handler({
    path: `/api/v1/clans/${encodeURIComponent(CLAN)}/mail`,
    method: "POST",
    headers: { authorization: `Bearer ${readOnlyKey}` },
    body: JSON.stringify({
      kind: "clan_actions_waiting",
      messages: [message("#0LCLRCPQ")],
    }),
  });
  assert.equal(r.statusCode, 404);
  assert.equal(data(r).code, "not_found");
  assert.match(data(r).detail, /No \/api\/v1 operation answers/);
});

test("an integration made without a permission list gets none that act on people, and no mail permission exists", async () => {
  const { rows } = await db.query(
    "select scopes from integration where name = 'clan-reader'",
  );
  assert.ok(rows[0].scopes.includes("clans:read"));
  assert.ok(!rows[0].scopes.includes("mail:send"));
  assert.ok(!rows[0].scopes.includes("facts:write"));
  const refused = await admin({ name: "mailer", scopes: ["mail:send"] });
  assert.equal(refused.statusCode, 400, refused.body);
});
