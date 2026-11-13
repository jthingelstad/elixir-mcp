/**
 * Clan is features inside Elixir (Jamie, 2026-11-12): the morning run
 * writes its facts and sends its mail as Elixir itself, no longer as the
 * `elixir-clan` integration. What it stores and sends must not change by
 * a byte: each test runs the old integration path and the new system path
 * on the same input and compares every stored row and every enqueued mail.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import {
  writeClanFactAsApp,
  removeClanFactAsApp,
  writeClanFactBySystem,
  removeClanFactBySystem,
} from "@elixir-mcp/record/attested-facts";
import { sendClanMail, sendActionsMail } from "@elixir-mcp/mail/clan-mail";

const CLAN = "#2QJ8PLUV";
const MEMBER = "#8YVQ2LRC";
const OTHER = "#9CJU0GPR";
let scratch, db, attester;

before(async () => {
  scratch = await scratchDb("clan_inside");
  db = scratch.db;
  const owner = (
    await db.query(
      "insert into account(email_hash,status,role) values ('owner','approved','admin') returning account_id",
    )
  ).rows[0].account_id;
  attester = (
    await db.query(
      "insert into account(email_hash,status,role,kind,owned_by_account_id) values ('clan-attester','approved','member','integration',$1) returning account_id",
      [owner],
    )
  ).rows[0].account_id;
  // A hostile clan name: the mail escapes it the same way on both paths.
  await db.query("insert into clan(clan_tag,name) values ($1,$2)", [
    CLAN,
    `<img src=x onerror=alert(1)> & "Co"`,
  ]);
  for (const [i, tag] of [MEMBER, OTHER].entries()) {
    const id = (
      await db.query(
        "insert into account(email_hash,email,status,role) values ($1,$2,'approved','member') returning account_id",
        [`p${i}`, `p${i}@example.org`],
      )
    ).rows[0].account_id;
    await db.query("insert into player(player_tag,name) values ($1,$2)", [
      tag,
      `<b>Player ${i}</b>`,
    ]);
    await db.query(
      "insert into claim(account_id,player_tag,status,is_primary,relationship) values ($1,$2,'verified',true,'primary')",
      [id, tag],
    );
    await db.query(
      "insert into clan_membership(clan_tag,player_tag,joined_observed_at,role) values ($1,$2,now() - interval '9 days','member')",
      [CLAN, tag],
    );
  }
});
after(async () => scratch?.drop());

/** The integration the run used to act as. */
const integration = () => ({
  accountId: attester,
  name: "elixir-clan",
  kind: "integration",
  role: "member",
  firstParty: true,
});

const standing = {
  type: "award_standing",
  ref: "award:war-champ:S140:1",
  player_tag: MEMBER,
  occurred_at: "2026-11-10T10:00:00Z",
  detail: {
    award: "War Champ",
    award_id: "war-champ",
    season_id: 140,
    place: 1,
    value: 3200,
    unit: "points",
    as_of: "2026-11-10T10:00:00Z",
  },
};

/** Every stored column but the row id and the write time. */
async function storedFacts() {
  const { rows } = await db.query(
    "select * from attested_fact where clan_tag = $1 order by source_ref",
    [CLAN],
  );
  return rows.map(({ fact_id: _id, recorded_at: _at, ...rest }) => rest);
}
const unstamped = ({ id: _id, recorded_at: _at, ...rest }) => rest;

test("a fact Clan computes is stored and answered byte for byte as the integration path stored it", async () => {
  const before = await writeClanFactAsApp(db, integration(), CLAN, standing);
  const storedBefore = await storedFacts();
  await db.query("delete from attested_fact where clan_tag = $1", [CLAN]);
  const after = await writeClanFactBySystem(db, attester, CLAN, standing);
  const storedAfter = await storedFacts();
  assert.equal(storedAfter.length, 1);
  assert.deepEqual(storedAfter, storedBefore);
  assert.equal(storedAfter[0].source, "elixir-clan");
  assert.equal(storedAfter[0].attester_account_id, attester);
  assert.deepEqual(unstamped(after), unstamped(before));
  assert.equal(after.attested_by.app, before.attested_by.app);

  // A correction lands on the same row, as the integration's did.
  const corrected = {
    ...standing,
    detail: { ...standing.detail, value: 3300 },
  };
  const again = await writeClanFactBySystem(db, attester, CLAN, corrected);
  assert.equal(again.id, after.id);
  assert.equal(again.created, false);

  // Removing answers the same shape, and only Clan's own source's row.
  const removed = await removeClanFactBySystem(
    db,
    attester,
    CLAN,
    standing.ref,
  );
  assert.deepEqual(Object.keys(removed), ["removed", "id", "ref"]);
  assert.equal(removed.ref, standing.ref);
  assert.deepEqual(await storedFacts(), []);
  await writeClanFactBySystem(db, attester, CLAN, standing);
  const removedOld = await removeClanFactAsApp(
    db,
    integration(),
    CLAN,
    standing.ref,
  );
  assert.deepEqual(Object.keys(removedOld), Object.keys(removed));
  assert.deepEqual(await storedFacts(), []);

  // A person's kind of fact is refused on the system path too.
  await assert.rejects(
    writeClanFactBySystem(db, attester, CLAN, {
      ...standing,
      type: "clan_message",
    }),
    { code: "unknown_fact_type" },
  );
});

const morningMail = {
  kind: "clan_actions_waiting",
  messages: [MEMBER, OTHER].map((player_tag) => ({
    player_tag,
    subject: "2 actions waiting for you in <Clan>",
    lines: [
      {
        title: "Promote <b>Ada</b> to Elder",
        reason: "a & b",
        number: 7,
        new: true,
      },
      { title: "Check on Quiet", number: 8, new: false },
      "And 3 more.",
    ],
    link: "https://elixir.poapkings.com/clan/2QJ8PLUV/actions",
  })),
};
const NOW = new Date("2026-11-12T11:00:00Z");

/** One send through `send`, everything it stored and enqueued, with each
 *  send's random id replaced by its order so two runs compare. */
async function captured(send) {
  const sent = [];
  // The unsubscribe link is signed with the wall clock's second.
  const realNow = Date.now;
  Date.now = () => NOW.getTime();
  const result = await send({
    enqueue: async (m) => sent.push(m),
    secret: "test",
    archive: null,
    now: () => NOW,
  }).finally(() => {
    Date.now = realNow;
  });
  const ids = [...new Set(sent.map((m) => m.send_id))];
  // The footer names a send by its id and by its first six characters.
  const plain = (v) =>
    ids.reduce(
      (s, id, i) =>
        s.replaceAll(id, `send-${i}`).replaceAll(id.slice(0, 6), `short-${i}`),
      JSON.stringify(v),
    );
  const issues = (
    await db.query(
      "select kind, period_key, subject_key, status, facts, subject_line, note from email_issue order by issue_id",
    )
  ).rows;
  const sends = (
    await db.query(
      "select account_id, subject, archived from email_send order by account_id",
    )
  ).rows;
  await db.query("delete from email_issue");
  return { result: plain(result), sent: plain(sent), issues, sends };
}

test("Clan's morning mail is stored, rendered and enqueued byte for byte as the integration path sent it", async () => {
  const before = await captured((deps) =>
    sendClanMail(db, integration(), CLAN, morningMail, deps),
  );
  const after = await captured((deps) =>
    sendActionsMail(db, CLAN, morningMail, deps),
  );
  assert.equal(JSON.parse(after.sent).length, 2);
  assert.deepEqual(after, before);
  assert.equal(after.issues[0].facts.source, "elixir-clan");
  // The words are escaped on the way out, as they were.
  const html = JSON.parse(after.sent)[0].html;
  assert.doesNotMatch(html, /<b>Ada<\/b>|<img src=x/);
  assert.match(html, /&lt;b&gt;Ada&lt;\/b&gt;/);
});

test("the system path keeps every refusal the door makes", async () => {
  const deps = { enqueue: async () => {}, secret: "test" };
  await assert.rejects(
    sendActionsMail(db, CLAN, { ...morningMail, kind: "weekly" }, deps),
    { code: "unknown_mail_kind" },
  );
  await assert.rejects(
    sendActionsMail(
      db,
      CLAN,
      {
        ...morningMail,
        messages: [
          { ...morningMail.messages[0], link: "https://example.org/" },
        ],
      },
      deps,
    ),
    { code: "invalid_mail" },
  );
  await assert.rejects(sendActionsMail(db, "#0RRRRRRR", morningMail, deps), {
    code: "not_recorded",
  });
});
