/**
 * Clan is features inside Elixir (Jamie, 2026-11-12): the morning run
 * writes its facts and sends its mail as Elixir itself, never as the
 * `elixir-clan` integration, whose JSON API doors went in 4.0.0. What it
 * stores and sends is what the integration path stored and sent (proved
 * side by side before that path went, #879): the same source, attester,
 * labels and escaping, pinned here.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import {
  writeClanFactBySystem,
  removeClanFactBySystem,
} from "@elixir-mcp/record/attested-facts";
import { sendActionsMail } from "@elixir-mcp/mail/clan-mail";

const CLAN = "#0PLYLQYQ";
const MEMBER = "#09GY9RQ2";
const OTHER = "#0PLQJ8UL";
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

test("a fact Clan computes is stored under Clan's old source and attester, labelled as Clan", async () => {
  const after = await writeClanFactBySystem(db, attester, CLAN, standing);
  const storedAfter = await storedFacts();
  assert.equal(storedAfter.length, 1);
  assert.deepEqual(storedAfter, [
    {
      subject_kind: "clan",
      clan_tag: CLAN,
      player_tag: MEMBER,
      fact_type: "award_standing",
      detail: storedAfter[0].detail,
      visibility: "clan",
      source: "elixir-clan",
      source_ref: standing.ref,
      attester_account_id: attester,
      attester_tag: null,
      attester_role: null,
      occurred_at: new Date(standing.occurred_at),
    },
  ]);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(storedAfter[0].detail).filter(([, v]) => v !== null),
    ),
    { ...standing.detail, as_of: "2026-11-10T10:00:00.000Z" },
  );
  assert.equal(after.created, true);
  assert.equal(after.attested_by.app, "Clan");

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
    link: "https://elixir.poapkings.com/clan/0PLYLQYQ/actions",
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

test("Clan's morning mail is stored, rendered and enqueued under Clan's old source and label", async () => {
  const after = await captured((deps) =>
    sendActionsMail(db, CLAN, morningMail, deps),
  );
  assert.equal(JSON.parse(after.sent).length, 2);
  assert.equal(after.issues.length, 1);
  assert.equal(after.issues[0].kind, "clan_actions_waiting");
  assert.equal(after.issues[0].subject_key, CLAN);
  assert.equal(after.issues[0].facts.source, "elixir-clan");
  assert.equal(after.sends.length, 2);
  assert.deepEqual(
    JSON.parse(after.result).results.map((r) => r.status),
    ["sent", "sent"],
  );
  // The words are escaped on the way out, as they were.
  const html = JSON.parse(after.sent)[0].html;
  assert.doesNotMatch(html, /<b>Ada<\/b>|<img src=x/);
  assert.match(html, /&lt;b&gt;Ada&lt;\/b&gt;/);
});

test("Clan's mail keeps every refusal", async () => {
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
  await assert.rejects(sendActionsMail(db, "#009V8VV0", morningMail, deps), {
    code: "not_recorded",
  });
});
