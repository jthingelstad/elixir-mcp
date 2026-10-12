/** #536 stage 1: milestone composes through the one "items in a window"
 *  composer with no change to what it says, and the feedback-answer mail
 *  cannot yet: what its timeline item lacks is pinned here, so stage 2
 *  knows when it is closed (docs/notes/2026-10-12-w3-spine.md). */
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
import { ALT, PRIMARY, WINDOW, milestoneFixture } from "./digest-fixture.mjs";

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
      big_label: "Path of Legends, up from Master 3",
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

test("stage-1 gap: the feedback answer item cannot carry the mail yet", async () => {
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
    // One item for two answers (the account burst rule, #376), naming
    // the first answer only, without the words the mail is made of.
    assert.equal(answered.length, 1, JSON.stringify(timeline));
    assert.equal(answered[0].facts.count, 2);
    assert.equal(String(answered[0].facts.feedback_id), String(first));
    for (const field of ["response", "message", "area", "shipped_in"])
      assert.ok(!(field in answered[0].facts), field);
    // The mail today: one per answer, from the feedback rows.
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
