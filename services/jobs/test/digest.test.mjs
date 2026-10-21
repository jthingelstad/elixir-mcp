/** #536: milestone composes through the one "items in a window"
 *  composer with no change to what it says (stage 1), and so does the
 *  feedback-answer mail, from its timeline item (stage 2's first move,
 *  docs/notes/2026-10-13-w3-feedback-item.md): the stage-1 gap pinned
 *  here is closed, and the mail says what it said from its own SQL. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTimeline } from "@elixir-mcp/tools/activity/entries";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { answerFeedback } from "../../../packages/feedback/src/feedback.mjs";
import {
  buildMilestone,
  momentKey,
  MILESTONE_MAIL_KINDS,
} from "../src/email/build-milestone.mjs";
import { digest, toldKey, windowItems } from "../src/email/digest.mjs";
import { runFeedbackAnswers } from "../src/email/feedback-answers.mjs";
import { myPlayers } from "../src/email/shared.mjs";
import {
  ALT,
  ANSWERED,
  FEEDBACK,
  PRIMARY,
  WINDOW,
  feedbackFixture,
  milestoneFixture,
} from "./digest-fixture.mjs";

/** buildMilestone's facts for the fixture, captured from the builder
 *  before it moved onto the composer (50e96135). */
const GOLDEN = {
  account: {
    name: "Primary One",
  },
  milestones: [
    {
      kind: "ranked_promotion",
      subject: {
        tag: "#2QYQ9V0P",
        name: "Primary One",
        relationship: "primary",
      },
      at: "Wed 13:30",
      instant: "2026-10-07T18:30:00.000Z",
      headline: "You advanced to Champion",
      big: "Champion",
      big_label: "Path of Legends, up from Master III",
      lines: [],
      battle: null,
    },
    {
      kind: "arena_changed",
      subject: {
        tag: "#2QYQ9V0P",
        name: "Primary One",
        relationship: "primary",
      },
      at: "Wed 12:00",
      instant: "2026-10-07T17:00:00.000Z",
      headline: "You reached Electro Valley",
      big: "Electro Valley",
      big_label: "A new arena, at 5,010 trophies",
      lines: [],
      battle: {
        battle_id:
          "d16e570000000000000000000000000000000000000000000000000000000000",
        won: true,
        crowns: 2,
        crowns_against: 1,
        opponent: {
          tag: "#2PGQ8Y0L",
          name: "SparkSanji",
          starting_trophies: 5012,
        },
        trophy_change: 30,
        url: "https://elixir.poapkings.com/battle/d16e57000000",
      },
    },
    {
      kind: "legendary_badge_earned",
      subject: {
        tag: "#2QYQ9V0P",
        name: "Primary One",
        relationship: "primary",
      },
      at: "Wed 04:10",
      instant: "2026-10-07T09:10:00.000Z",
      headline: "You earned Beating Death",
      big: null,
      lines: ["A legendary badge."],
    },
  ],
  also: [
    {
      tag: "#8LQ2PJ0C",
      name: "Alt Two",
      text: "passed 1,000 career wins",
    },
    {
      tag: "#2QYQ9V0P",
      name: "Primary One",
      text: "passed 3,000 career wins",
    },
    {
      tag: "#2QYQ9V0P",
      name: "Primary One",
      text: "unlocked Evolution Hog Rider",
      card: {
        id: 26000021,
        name: "Hog Rider",
        form: "evolution",
      },
    },
  ],
  _moments: [
    {
      subject_tag: "#2QYQ9V0P",
      kind: "ranked_promotion",
      key: "league:4",
    },
    {
      subject_tag: "#2QYQ9V0P",
      kind: "arena_changed",
      key: "arena:15",
    },
    {
      subject_tag: "#2QYQ9V0P",
      kind: "legendary_badge_earned",
      key: "badge:BeatingDeathBadge",
    },
    {
      subject_tag: "#8LQ2PJ0C",
      kind: "career_wins_step",
      key: "wins:1000",
    },
    {
      subject_tag: "#2QYQ9V0P",
      kind: "career_wins_step",
      key: "wins:3000",
    },
    {
      subject_tag: "#2QYQ9V0P",
      kind: "card_form_unlocked",
      key: "form:26000021:evolution",
    },
  ],
};

test("milestone through the composer says exactly what it said before", async () => {
  const s = await scratchDb("digest_milestone");
  try {
    const account = await milestoneFixture(s.db);
    const facts = await buildMilestone({ db: s.db, account, ...WINDOW });
    assert.deepEqual(JSON.parse(JSON.stringify(facts)), GOLDEN);
  } finally {
    await s.drop();
  }
});

test("the composer is milestone's one path from the timeline's items", async () => {
  const src = readFileSync(
    new URL("../src/email/build-milestone.mjs", import.meta.url),
    "utf8",
  );
  assert.match(src, /from "\.\/digest\.mjs"/);
  assert.doesNotMatch(src, /buildPlayerEntry/, "no second read of the items");
  const s = await scratchDb("digest_window");
  try {
    const account = await milestoneFixture(s.db);
    const subjects = await myPlayers(s.db, account.accountId);
    const found = await windowItems(s.db, {
      subjects,
      ...WINDOW,
      timezone: account.timezone,
      kinds: MILESTONE_MAIL_KINDS,
      keyOf: momentKey,
    });
    // Every first in the window, the told one included; a badge level is
    // not a milestone kind and never arrives.
    assert.deepEqual(
      found.map(toldKey).sort(),
      [
        `${ALT}|career_wins_step|wins:1000`,
        `${ALT}|career_wins_step|wins:2000`,
        `${PRIMARY}|arena_changed|arena:15`,
        `${PRIMARY}|card_form_unlocked|form:26000021:evolution`,
        `${PRIMARY}|career_wins_step|wins:3000`,
        `${PRIMARY}|legendary_badge_earned|badge:BeatingDeathBadge`,
        `${PRIMARY}|ranked_promotion|league:4`,
      ].sort(),
    );
    // What the journal holds is not news; the fold leads, the rest ride.
    const { news, shown, rest } = digest(found, {
      told: new Set([`${ALT}|career_wins_step|wins:2000`]),
      order: (a, b) => b.at.localeCompare(a.at),
      fold: (n) => n.slice(0, 2),
    });
    assert.equal(news.length, 6);
    assert.deepEqual(shown, news.slice(0, 2));
    assert.deepEqual(rest, news.slice(2));
    assert.ok(news.every((m, i) => i === 0 || news[i - 1].at >= m.at));
  } finally {
    await s.drop();
  }
});

test("stage-1 gap closed: two answers inside a minute are two items, each carrying its mail", async () => {
  const s = await scratchDb("digest_feedback_gap");
  const { db } = s;
  try {
    const accountId = (
      await db.query(
        `insert into account (email_hash, email, status)
         values ('gap', 'gap@example.com', 'approved') returning account_id`,
      )
    ).rows[0].account_id;
    const filed = async (message) =>
      (
        await db.query(
          `insert into feedback (account_id, surface, area, category, message, status)
           values ($1, 'web', 'ladder', 'bug', $2, 'new') returning feedback_id`,
          [accountId, message],
        )
      ).rows[0].feedback_id;
    const first = await filed("The rank looked off");
    const second = await filed("The deck name is wrong");
    const fromMs = Date.now() - 60_000;
    // Two answers inside a minute, the way the maintainer answers a queue.
    for (const [feedbackId, response] of [
      [first, "Fixed: it reads the live board now."],
      [second, "Renamed in 11.10.1."],
    ])
      await answerFeedback(db, { feedbackId, status: "done", response });
    const { timeline } = await buildTimeline(db, [], {
      fromMs,
      toMs: Date.now() + 60_000,
      accountId,
    });
    const answered = timeline.filter(
      (it) => it.kind === "account_feedback_responded",
    );
    // One item per answer, never the account burst (#376), each naming
    // its own feedback item with the words the mail is made of.
    assert.equal(answered.length, 2, JSON.stringify(timeline));
    assert.deepEqual(
      answered.map((it) => String(it.facts.feedback_id)).sort(),
      [String(first), String(second)].sort(),
    );
    for (const it of answered) {
      assert.equal(it.facts.count, 1);
      for (const field of [
        "response",
        "message",
        "area",
        "category",
        "filed_at",
        "answered_at",
        "shipped_in",
        "status",
      ])
        assert.ok(field in it.facts, field);
    }
    // The mail: one per answer, each from its item.
    const sent = [];
    const r = await runFeedbackAnswers({
      db,
      secret: "s",
      enqueue: async (m) => void sent.push(m),
      settleMinutes: 0,
    });
    assert.equal(r.sent, 2, JSON.stringify(r));
    assert.deepEqual(sent.map((m) => m.subject).sort(), [
      "Answered: “The deck name is wrong”",
      "Answered: “The rank looked off”",
    ]);
  } finally {
    await s.drop();
  }
});

/** The answer mail's facts for the feedback fixture, captured from the
 *  old SQL path before the mail moved onto the item (e73e3093). */
const GOLDEN_ANSWERS = {
  [FEEDBACK.done]: {
    period_key: "feedback-answer/9001/2026-10-07T16:30:00.123Z",
    subject:
      "Answered: “The rank looked off on Ladder. It said Master 2 while the g…”",
    facts: {
      area: "ladder",
      link: "https://elixir.poapkings.com/console/account/feedback/9001",
      status: "done",
      message:
        "The rank looked off on Ladder. It said Master 2 while the game said Master 3. It said Master 2 while the game said Master 3. It said Master 2 while the game said Master 3. It said Master 2 while the game said Master 3. It said Master 2 while the game said Master 3. It said Master 2 while the game said Master 3. It said Master 2 while the game said Master 3. It said Master 2 while the game said Master 3. It said Master 2 while the game said Master 3. It said Master 2 while the game said Master 3. It said Master 2 while the game said Master 3. It said Master 2 while the game said Master 3. It sa",
      category: "bug",
      filed_at: "2026-10-06T21:15:00.000Z",
      response:
        "Fixed: Ladder reads the live board now.\n\nThanks for the report.",
      shipped_in: "11.10.1",
      answered_at: "2026-10-07T16:30:00.123Z",
      feedback_id: "9001",
    },
  },
  [FEEDBACK.question]: {
    period_key: "feedback-answer/9002/2026-10-07T16:31:00.654Z",
    subject: "A question about: “Could elixir_timeline say which deck won?”",
    facts: {
      area: "mcp",
      link: "https://elixir.poapkings.com/console/account/feedback/9002",
      status: "needs_info",
      message: "Could elixir_timeline say which deck won?",
      category: "general",
      filed_at: "2026-10-07T09:00:00.000Z",
      response: "Which deck do you mean: yours or the opponent's?",
      shipped_in: null,
      answered_at: "2026-10-07T16:31:00.654Z",
      feedback_id: "9002",
    },
  },
};

test("the answer mail is composed from its item and says what the old path said", async () => {
  const s = await scratchDb("digest_feedback_golden");
  const { db } = s;
  try {
    const { accountId } = await feedbackFixture(db);
    // The item the mail is made from, as the timeline serves it.
    const { timeline } = await buildTimeline(db, [], {
      fromMs: Date.parse(ANSWERED.done) - 1000,
      toMs: Date.parse(ANSWERED.question) + 1000,
      accountId,
    });
    const done = timeline.find(
      (it) => String(it.facts.feedback_id) === FEEDBACK.done,
    );
    assert.equal(done.kind, "account_feedback_responded");
    assert.equal(done.revision, 1);
    const sent = [];
    const r = await runFeedbackAnswers({
      db,
      secret: "s",
      enqueue: async (m) => void sent.push(m),
    });
    assert.equal(r.sent, 2, JSON.stringify(r));
    const { rows } = await db.query(
      `select subject_key, period_key, facts from email_issue
        where kind = 'feedback_answer' order by subject_key`,
    );
    assert.equal(rows.length, 2);
    for (const row of rows) {
      const golden = GOLDEN_ANSWERS[row.subject_key];
      assert.equal(row.period_key, golden.period_key);
      assert.deepEqual(row.facts, golden.facts);
    }
    assert.deepEqual(
      sent.map((m) => m.subject),
      [FEEDBACK.done, FEEDBACK.question].map(
        (id) => GOLDEN_ANSWERS[id].subject,
      ),
    );
    // The item's facts are the mail's, key for key.
    for (const key of [
      "area",
      "category",
      "status",
      "message",
      "filed_at",
      "response",
      "answered_at",
      "shipped_in",
    ])
      assert.deepEqual(
        done.facts[key],
        GOLDEN_ANSWERS[FEEDBACK.done].facts[key],
        key,
      );
  } finally {
    await s.drop();
  }
});

test("each delivery gate holds the answer mail; no once-a-day gate; a mail marks nothing seen", async () => {
  const s = await scratchDb("digest_feedback_gates");
  const { db } = s;
  try {
    const account = async (hash, { status = "approved", owner = false } = {}) =>
      (
        await db.query(
          `insert into account (email_hash, email, status, is_owner)
           values ($1, $2, $3, $4) returning account_id`,
          [hash, `${hash}@example.com`, status, owner],
        )
      ).rows[0].account_id;
    const person = await account("gate-person");
    const off = await account("gate-off");
    const pending = await account("gate-disabled", { status: "disabled" });
    const owner = await account("gate-owner", { owner: true });
    const agent = (
      await db.query(
        `insert into account (email_hash, status, kind, owned_by_account_id, public_id)
         values ('gate-agent', 'approved', 'agent', $1, 'gateagent01') returning account_id`,
        [person],
      )
    ).rows[0].account_id;
    await db.query(
      `insert into account_email_pref (account_id, kind, enabled, via)
       values ($1, 'feedback_answer', false, 'profile')`,
      [off],
    );
    // An answer as answerFeedback writes it, `ago` minutes back.
    const answered = async (
      accountId,
      { ago = 20, response = "An answer.", seen = false, event = true } = {},
    ) =>
      (
        await db.query(
          `with f as (
             insert into feedback (account_id, surface, area, category, message, status,
                                   response, responded_at, response_seen_at)
             values ($1, 'web', 'ladder', 'bug', 'A message', 'done', $2,
                     now() - make_interval(mins => $3), case when $4 then now() end)
             returning feedback_id, account_id, status, response, responded_at),
           e as (
             insert into account_event (account_id, kind, detail, created_at)
             select account_id, 'feedback_responded',
                    jsonb_build_object('feedback_id', feedback_id, 'status', status,
                                       'response', response, 'shipped_in', null),
                    responded_at
               from f where $5)
           select feedback_id from f`,
          [accountId, response, ago, seen, event],
        )
      ).rows[0].feedback_id;
    const ok = await answered(person);
    // Event-based mail: a second answer for the same person the same day
    // goes too (no once-a-day gate).
    const sameDay = await answered(person, { ago: 15 });
    const held = {
      unsettled: await answered(person, { ago: 1 }),
      read: await answered(person, { seen: true }),
      switchedOff: await answered(off),
      notApproved: await answered(pending),
      owner: await answered(owner),
      agent: await answered(agent),
      noWords: await answered(person, { response: "  " }),
      noItem: await answered(person, { event: false }),
    };
    const sent = [];
    const r = await runFeedbackAnswers({
      db,
      secret: "s",
      enqueue: async (m) => void sent.push(m),
    });
    assert.equal(r.sent, 2, JSON.stringify(r));
    assert.deepEqual(
      r.details
        .filter((d) => d.send_id)
        .map((d) => d.feedback_id)
        .sort(),
      [String(ok), String(sameDay)].sort(),
    );
    assert.ok(sent.every((m) => m.to === "gate-person@example.com"));
    assert.deepEqual(
      r.details.filter((d) => d.skipped).map((d) => d.feedback_id),
      [String(held.noItem)],
      "an answer with no item is skipped, never composed from the row",
    );
    const { rows } = await db.query(
      `select feedback_id, response_mailed_at is not distinct from responded_at as handled,
              response_seen_at
         from feedback`,
    );
    const by = Object.fromEntries(rows.map((x) => [x.feedback_id, x]));
    assert.equal(by[held.unsettled].handled, false, "not settled yet");
    for (const [gate, id] of Object.entries(held))
      if (gate !== "unsettled")
        assert.equal(by[id].handled, true, `${gate}: handled, not mailed`);
    // Sending is not reading: the answer stays unread where it was filed.
    assert.equal(by[ok].response_seen_at, null);
    assert.equal(by[sameDay].response_seen_at, null);
  } finally {
    await s.drop();
  }
});
