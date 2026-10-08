import { test } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { runFeedbackAnswers } from "../src/email/feedback-answers.mjs";

test("feedback answers: one mail per settled, unread answer to a person; a revision is owed again; nothing twice", async () => {
  const s = await scratchDb("feedback_answers");
  const { db } = s;
  try {
    const account = async (hash, extra = "") =>
      (
        await db.query(
          `insert into account (email_hash, email, status${extra ? ", kind" : ""})
           values ($1, $2, 'approved'${extra ? ", $3" : ""}) returning account_id`,
          extra
            ? [hash, `${hash}@example.com`, extra]
            : [hash, `${hash}@example.com`],
        )
      ).rows[0].account_id;
    const person = await account("person");
    const switchedOff = await account("off");
    const owner = (
      await db.query(
        `insert into account (email_hash, email, status, is_owner, role)
         values ('owner', 'owner@example.com', 'approved', true, 'owner') returning account_id`,
      )
    ).rows[0].account_id;
    await db.query(
      `insert into account_email_pref (account_id, kind, enabled, via) values ($1, 'feedback_answer', false, 'profile')`,
      [switchedOff],
    );
    const item = async (
      accountId,
      { ago = 20, seen = false, area = "ladder" } = {},
    ) =>
      (
        await db.query(
          `insert into feedback (account_id, surface, area, category, message, status,
                                 response, responded_at, response_seen_at)
           values ($1, 'web', $2, 'bug', 'The rank looked off', 'done',
                   'Fixed: it reads the live board now.',
                   now() - make_interval(mins => $3),
                   case when $4 then now() end)
           returning feedback_id`,
          [accountId, area, ago, seen],
        )
      ).rows[0].feedback_id;
    const due = await item(person);
    const read = await item(person, { seen: true });
    const fresh = await item(person, { ago: 1 });
    const off = await item(switchedOff);
    const own = await item(owner);
    // An item answered before 0204 was marked mailed by the migration;
    // one answered with no words is never mail.
    const sent = [];
    const opts = {
      db,
      secret: "test-secret",
      enqueue: async (m) => sent.push(m),
    };
    const r = await runFeedbackAnswers(opts);
    assert.equal(r.sent, 1, JSON.stringify(r));
    assert.equal(r.skipped, 3);
    assert.equal(sent[0].to, "person@example.com");
    assert.equal(sent[0].kind, "feedback_answer");
    assert.match(sent[0].subject, /^Answered: “The rank looked off”$/);
    assert.match(sent[0].text, /Fixed: it reads the live board now\./);
    assert.match(sent[0].html, new RegExp(`/console/account/feedback/${due}`));
    assert.ok(sent[0].unsubscribe.url, "a bulk kind, one-click off");
    const { rows } = await db.query(
      `select feedback_id, response_mailed_at is not distinct from responded_at as handled
         from feedback order by feedback_id`,
    );
    const handled = Object.fromEntries(
      rows.map((x) => [x.feedback_id, x.handled]),
    );
    assert.equal(handled[due], true);
    assert.equal(handled[read], true, "read where filed: handled, not mailed");
    assert.equal(handled[off], true);
    assert.equal(handled[own], true);
    assert.equal(handled[fresh], false, "not settled yet");
    const { rows: sends } = await db.query(
      `select s.account_id from email_send s join email_issue i using (issue_id)
        where i.kind = 'feedback_answer'`,
    );
    assert.equal(sends.length, 1);

    // Nothing twice.
    assert.equal((await runFeedbackAnswers(opts)).sent, 0);
    // A revised answer is news again: a new mail with its own send id.
    await db.query(
      `update feedback set response = 'Fixed, and backfilled.',
              responded_at = now() - interval '15 minutes', response_seen_at = null
        where feedback_id = $1`,
      [due],
    );
    const again = await runFeedbackAnswers(opts);
    assert.equal(again.sent, 1);
    assert.notEqual(sent[1].send_id, sent[0].send_id);
    assert.match(sent[1].text, /Fixed, and backfilled\./);
    // Settled later, the fresh one goes too.
    await db.query(
      `update feedback set responded_at = now() - interval '11 minutes' where feedback_id = $1`,
      [fresh],
    );
    assert.equal((await runFeedbackAnswers(opts)).sent, 1);
  } finally {
    await s.drop();
  }
});
