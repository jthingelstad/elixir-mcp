/**
 * Deleting an account from the web (2026-11-23), against a real
 * PostgreSQL database: a person's own from Settings › Profile
 * (POST /api/me/account/delete) and any account from Admin › Accounts
 * (POST /api/admin/accounts/remove). Both run the one removal ops runs
 * (@elixir-mcp/auth/account-remove); what it deletes is pinned in
 * services/migrate's ops-account-remove tests and the census in
 * packages/auth. These pin the doors: who may, what is refused, the
 * mailing list's hand-over and the sent mail's bodies.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { createSession } from "@elixir-mcp/auth";
import { makeHandler } from "../src/handler.mjs";

let scratch, handler, OWNER, STAFF, OTHER_STAFF;
const sessions = new Map();
const newsletter = [];
const deleted = [];
let newsletterDown = false;
const data = (r) => JSON.parse(r.body);

async function person(
  hash,
  { role = "member", email = null, owner = false } = {},
) {
  const id = (
    await scratch.db.query(
      `insert into account(email_hash,email,status,role,is_owner)
       values ($1,$2,'approved',$3,$4) returning account_id`,
      [hash, email, role, owner],
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
const call = (id, method, path, { body, contractHeader = true } = {}) =>
  handler({
    path,
    method,
    queryStringParameters: {},
    headers: {
      ...(id ? { cookie: `__Host-elixir_session=${sessions.get(id)}` } : {}),
      ...(contractHeader ? { "x-elixir-client": "web" } : {}),
      "cloudfront-viewer-address": "8.8.4.4:443",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const del = (id, body = { confirm: "DELETE" }, opts = {}) =>
  call(id, "POST", "/api/me/account/delete", { body, ...opts });
const adminRemove = (id, body, opts = {}) =>
  call(id, "POST", "/api/admin/accounts/remove", { body, ...opts });
const row = async (id) =>
  (
    await scratch.db.query(
      `select email, email_hash, status, role, test_name from account where account_id = $1`,
      [id],
    )
  ).rows[0];
let issues = 0;
const sentMail = async (id, sendId) => {
  const { rows } = await scratch.db.query(
    `insert into email_issue (kind, period_key) values ('weekly_report', $1)
     returning issue_id`,
    [`2026-W${10 + issues++}`],
  );
  await scratch.db.query(
    `insert into email_send(issue_id, send_id, account_id, archived)
     values ($1, $2, $3, true)`,
    [rows[0].issue_id, sendId, id],
  );
};

before(async () => {
  scratch = await scratchDb("account_delete");
  handler = makeHandler({
    databaseUrl: scratch.url,
    secret: "test",
    removeFromNewsletter: async (email) => {
      if (newsletterDown) throw new Error("outbox down");
      newsletter.push(email);
    },
    capture: {
      bucket: "archive",
      s3: {
        send: async (cmd) => {
          for (const { Key } of cmd.input.Delete.Objects) deleted.push(Key);
          return {};
        },
      },
    },
  });
  OWNER = await person("d-owner", { role: "owner", owner: true });
  STAFF = await person("d-staff", { role: "admin" });
  OTHER_STAFF = await person("d-staff-2", { role: "admin" });
});

after(async () => {
  await scratch?.drop();
});

test("a person deletes their own account: the list hears, the mail goes, the cookie clears", async () => {
  const me = await person("d-self", { email: "self@example.com" });
  await sentMail(me, "11111111-1111-4111-8111-111111111111");
  const before = newsletter.length;
  const res = await del(me);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(data(res), { ok: true });
  assert.match(res.headers["set-cookie"], /^__Host-elixir_session=;/);
  assert.match(res.headers["set-cookie"], /Max-Age=0/);
  assert.deepEqual(newsletter.slice(before), ["self@example.com"]);
  assert.equal(deleted.length, 1, "the one archived body is deleted");
  assert.match(
    deleted[0],
    /^mail\/sent\/.*11111111-1111-4111-8111-111111111111/,
  );
  const after = await row(me);
  assert.equal(after.email, null);
  assert.match(after.email_hash, /^removed:/);
  const { rows: events } = await scratch.db.query(
    `select detail from account_event where account_id = $1 and kind = 'account_removed'`,
    [me],
  );
  assert.deepEqual(
    events.map((e) => e.detail),
    [{ via: "self" }],
  );
  // The session went with the account.
  const again = await call(me, "GET", "/api/me");
  assert.equal(data(again).authenticated, false);
});

test("no address, nothing for the mailing list", async () => {
  const me = await person("d-noaddr");
  const before = newsletter.length;
  assert.equal((await del(me)).statusCode, 200);
  assert.equal(newsletter.length, before);
});

test("the confirmation must be typed, and the contract header sent", async () => {
  const me = await person("d-confirm", { email: "confirm@example.com" });
  for (const body of [{}, { confirm: "DELET" }, { confirm: "yes" }]) {
    const res = await del(me, body);
    assert.equal(res.statusCode, 400);
    assert.equal(data(res).error, "confirm_required");
  }
  const noHeader = await del(
    me,
    { confirm: "DELETE" },
    { contractHeader: false },
  );
  assert.equal(noHeader.statusCode, 401);
  assert.equal((await row(me)).email, "confirm@example.com", "nothing went");
  assert.equal((await del(null)).statusCode, 401);
});

test("an account with a main player or a handle confirms with one of them, not DELETE", async () => {
  const me = await person("d-named", { email: "named@example.com" });
  await scratch.db.query(
    "insert into player(player_tag,name) values ($1,$2) on conflict do nothing",
    ["#0PLUG2V9", "Ｂlue Knight"],
  );
  await scratch.db.query(
    `insert into claim(account_id,player_tag,status,is_primary,relationship)
     values ($1,$2,'unverified',true,'primary')`,
    [me, "#0PLUG2V9"],
  );
  await scratch.db.query(
    "update account set handle = 'blueknight', handle_set_at = now() where account_id = $1",
    [me],
  );
  for (const confirm of ["DELETE", "Blue", "@someone", ""]) {
    const res = await del(me, { confirm });
    assert.equal(res.statusCode, 400, confirm);
    assert.equal(data(res).error, "confirm_required");
    assert.match(data(res).message, /main player's name or your @handle/);
  }
  assert.equal((await row(me)).email, "named@example.com", "nothing went");
  // The handle, @ or not, and the name in any case and width, confirm.
  const other = await person("d-named-2", { email: "named2@example.com" });
  await scratch.db.query(
    "update account set handle = 'redknight', handle_set_at = now() where account_id = $1",
    [other],
  );
  assert.equal((await del(other, { confirm: "@RedKnight" })).statusCode, 200);
  assert.equal((await del(me, { confirm: "  blue knight " })).statusCode, 200);
  assert.match((await row(me)).email_hash, /^removed:/);
});

test("the owner's account and a live collector are refused, with a reason", async () => {
  const owner = await del(OWNER);
  assert.equal(owner.statusCode, 409);
  assert.equal(data(owner).code, "owner_account");
  assert.ok(data(owner).message);

  const operator = await person("d-operator", { email: "op@example.com" });
  await scratch.db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'home', '192.0.2.10', 'active')`,
    [operator],
  );
  const before = newsletter.length;
  const live = await del(operator);
  assert.equal(live.statusCode, 409);
  assert.equal(data(live).code, "collectors_live");
  assert.match(data(live).message, /Settings › Collectors/);
  assert.equal(newsletter.length, before, "a refusal hands nothing over");
  assert.equal((await row(operator)).email, "op@example.com");
});

test("a mailing list that cannot be told leaves the account as it was", async () => {
  const me = await person("d-listdown", { email: "down@example.com" });
  newsletterDown = true;
  try {
    const res = await del(me);
    assert.equal(res.statusCode, 503);
    assert.equal(res.headers["retry-after"], "60");
  } finally {
    newsletterDown = false;
  }
  const kept = await row(me);
  assert.equal(kept.email, "down@example.com");
  assert.equal(kept.email_hash, "d-listdown");
});

test("Admin's dry run counts and writes nothing", async () => {
  const target = await person("d-target", { email: "target@example.com" });
  await sentMail(target, "22222222-2222-4222-8222-222222222222");
  const before = { list: newsletter.length, mail: deleted.length };
  const res = await adminRemove(STAFF, { account_id: target });
  assert.equal(res.statusCode, 200, res.body);
  const body = data(res);
  assert.equal(body.dry_run, true);
  assert.equal(body.mail_archived, 1);
  assert.ok(body.removed.session >= 1, "its session would go");
  assert.ok(!("email" in body) && !("account_ref" in body), "nothing personal");
  assert.equal(newsletter.length, before.list);
  assert.equal(deleted.length, before.mail);
  assert.equal((await row(target)).email, "target@example.com");
  const { rows } = await scratch.db.query(
    `select 1 from session where account_id = $1`,
    [target],
  );
  assert.equal(rows.length, 1);
});

test("Admin deletes an account for real, a test identity included", async () => {
  const target = await person("d-real", { email: "real@example.com" });
  const res = await adminRemove(STAFF, { account_id: target, dry_run: false });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(data(res).dry_run, false);
  assert.match((await row(target)).email_hash, /^removed:/);
  const { rows: events } = await scratch.db.query(
    `select detail from account_event where account_id = $1 and kind = 'account_removed'`,
    [target],
  );
  assert.deepEqual(
    events.map((e) => e.detail),
    [{ via: "admin", by: STAFF }],
  );

  const gym = (
    await scratch.db.query(
      `insert into account(email_hash,status,test_name) values ('test:gym','approved','gym')
       returning account_id`,
    )
  ).rows[0].account_id;
  const t = await adminRemove(STAFF, { account_id: gym, dry_run: false });
  assert.equal(t.statusCode, 200, t.body);
  const gone = await row(gym);
  assert.equal(gone.test_name, null);
  assert.match(gone.email_hash, /^removed:/);

  // A second removal is refused, not repeated.
  const twice = await adminRemove(STAFF, {
    account_id: target,
    dry_run: false,
  });
  assert.equal(twice.statusCode, 409);
  assert.equal(data(twice).code, "already_removed");
});

test("Admin's list labels test identities, flags tombstones and says when each was last active", async () => {
  const res = await call(STAFF, "GET", "/api/admin/accounts");
  assert.equal(res.statusCode, 200);
  const rows = data(res).accounts;
  const staff = rows.find((r) => r.account_id === STAFF);
  assert.equal(staff.removed, false);
  assert.equal(staff.test_name, null);
  assert.ok(staff.last_active_at, "a session counts as activity");
  assert.ok(rows.some((r) => r.removed === true));
});

test("only staff, and the hierarchy holds", async () => {
  const member = await person("d-member");
  const target = await person("d-target-2");
  const notStaff = await adminRemove(member, { account_id: target });
  assert.equal(notStaff.statusCode, 403);

  const noHeader = await adminRemove(
    STAFF,
    { account_id: target },
    { contractHeader: false },
  );
  assert.equal(noHeader.statusCode, 403);

  const owner = await adminRemove(STAFF, { account_id: OWNER, dry_run: false });
  assert.equal(owner.statusCode, 409);
  assert.equal(data(owner).code, "owner_account");
  const ownerByOwner = await adminRemove(OWNER, { account_id: OWNER });
  assert.equal(ownerByOwner.statusCode, 409);
  assert.equal(data(ownerByOwner).code, "self");

  const self = await adminRemove(STAFF, { account_id: STAFF, dry_run: false });
  assert.equal(self.statusCode, 409);
  assert.equal(data(self).code, "self");

  const peer = await adminRemove(STAFF, {
    account_id: OTHER_STAFF,
    dry_run: false,
  });
  assert.equal(peer.statusCode, 403);
  assert.equal(data(peer).code, "above_grant");
  assert.equal((await row(OTHER_STAFF)).role, "admin", "the admin stays");

  const byOwner = await adminRemove(OWNER, { account_id: OTHER_STAFF });
  assert.equal(byOwner.statusCode, 200, byOwner.body);
  assert.equal(data(byOwner).dry_run, true);

  const bad = await adminRemove(STAFF, { account_id: "not-a-uuid" });
  assert.equal(bad.statusCode, 404);
});
