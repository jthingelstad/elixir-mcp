/**
 * The written-issue spine (review 2026-09-27 §6.7): the Top 100 runs on
 * it with its own facts, an answer the editor gave up on is refused the
 * way a failing lint is, an operator's regenerate never mails the owner,
 * and an issue accepted after its send slot is sent at once, only for
 * the period that slot was for.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acceptIssue } from "../src/email/issue-pipeline.mjs";
import { top100Facts } from "../src/email/top100.mjs";
import { writtenSendDue, WRITTEN_SEND_SLOT } from "../src/email/index.mjs";
import { lastGameWeek } from "../src/email/week.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const fixture = JSON.parse(
  readFileSync(
    path.join(repoRoot, "services/editor/fixtures/sample-brief.json"),
    "utf8",
  ),
);
// The fixture predates the brief's issue date; today's briefs carry it.
const brief = {
  ...fixture,
  kind: "top_100",
  window: { ...fixture.window, issue_date: "2026-09-18", label: "Sep 12-18" },
};
const DATE = brief.window.issue_date;

function fakeDb() {
  const rows = [];
  return {
    rows,
    query: async (_sql, params) => {
      rows.push({
        kind: params[0],
        period_key: params[1],
        facts: params[3] ? JSON.parse(params[3]) : null,
        status: params[5],
        note: params[6],
      });
      return { rows: [{ issue_id: rows.length }] };
    },
  };
}

function sink() {
  const out = [];
  return { out, enqueue: async (m) => void out.push(m) };
}

const reader =
  (issue, b = brief) =>
  async (_bucket, key) =>
    structuredClone(key.endsWith("brief.json") ? b : issue);

const KEY = `mail/top_100/${DATE}/issue.json`;
const good = {
  subject: "The podium",
  preheader: "Three at the top",
  body_markdown: `**1. ${brief.podium[0].name} - ${brief.podium[0].rating}.**`,
  numbers_used: [],
  subjects: ["Another"],
};

test("the Top 100 accepts through the spine, with its own facts", async () => {
  const db = fakeDb();
  const { enqueue, out } = sink();
  const r = await acceptIssue({
    db,
    bucket: "b",
    key: KEY,
    kind: "top_100",
    factsOf: top100Facts,
    enqueue,
    read: reader(good),
  });
  assert.deepEqual(r, {
    accepted: true,
    period: DATE,
    ops: false,
    subject: "The podium",
  });
  assert.equal(out.length, 0);
  const [row] = db.rows;
  assert.equal(row.kind, "top_100");
  assert.equal(row.period_key, DATE);
  assert.equal(row.status, "composed");
  assert.equal(row.facts.issue.date, DATE);
  assert.deepEqual(row.facts.players_index, [
    { name: brief.podium[0].name, tag: brief.podium[0].tag },
  ]);
  assert.deepEqual(row.facts.alternates, ["Another"]);
});

test("an answer the editor gave up on is refused, and the owner hears it was not written", async () => {
  const db = fakeDb();
  const { enqueue, out } = sink();
  const r = await acceptIssue({
    db,
    bucket: "b",
    key: KEY,
    kind: "top_100",
    factsOf: top100Facts,
    enqueue,
    read: reader({
      _pipeline: {
        error: { kind: "refusal", message: "writer: model refused: cyber" },
      },
    }),
  });
  assert.equal(r.accepted, false);
  assert.deepEqual(r.problems, [
    "editor refusal: writer: model refused: cyber",
  ]);
  assert.equal(db.rows[0].status, "failed");
  assert.equal(db.rows[0].facts, null);
  assert.equal(out.length, 1);
  assert.match(out[0].note, /top_100 issue .* was not written: editor refusal/);
});

test("an operator's regenerate that fails is recorded as ops and mails nobody", async () => {
  const db = fakeDb();
  const { enqueue, out } = sink();
  const r = await acceptIssue({
    db,
    bucket: "b",
    key: KEY,
    kind: "top_100",
    factsOf: top100Facts,
    enqueue,
    read: reader(
      { ...good, body_markdown: "Up 123456 places!" },
      { ...brief, ops: true },
    ),
  });
  assert.equal(r.accepted, false);
  assert.equal(r.ops, true);
  assert.match(db.rows[0].note, /^\[ops\] /);
  assert.equal(out.length, 0);
});

test("a late accept is due only after its slot, and only for the period that slot sent", () => {
  // Thursday 2026-10-01: the Top 100's send is at 14:00Z.
  const period = "2026-10-01";
  assert.equal(
    writtenSendDue("top_100", period, new Date("2026-10-01T13:59:00Z")),
    false,
  );
  assert.equal(
    writtenSendDue("top_100", period, new Date("2026-10-01T15:10:00Z")),
    true,
  );
  // After midnight UTC a send would be for Friday, not this issue.
  assert.equal(
    writtenSendDue("top_100", period, new Date("2026-10-02T00:10:00Z")),
    false,
  );
  // An older issue accepted late never sends on its own.
  assert.equal(
    writtenSendDue("top_100", "2026-09-24", new Date("2026-10-01T15:10:00Z")),
    false,
  );
  // Card of the Week: Friday 14:00Z, for the game week before it.
  const fri = new Date("2026-10-02T15:00:00Z");
  const week = lastGameWeek(fri).key;
  assert.equal(writtenSendDue("card_of_week", week, fri), true);
  assert.equal(
    writtenSendDue("card_of_week", week, new Date("2026-10-02T13:00:00Z")),
    false,
  );
  assert.equal(
    writtenSendDue("card_of_week", week, new Date("2026-10-03T09:00:00Z")),
    true,
  );
  // Once the game week rolls (Monday 10:00Z) it is last week's issue.
  assert.equal(
    writtenSendDue("card_of_week", week, new Date("2026-10-05T11:00:00Z")),
    false,
  );
  assert.equal(
    writtenSendDue(
      "card_of_week",
      lastGameWeek(new Date("2026-09-25T15:00:00Z")).key,
      fri,
    ),
    false,
  );
  assert.equal(writtenSendDue("arena_week", "x", fri), false);
});

test("the send slots are the EventBridge crons", () => {
  const template = readFileSync(
    path.join(repoRoot, "infra/template.yaml"),
    "utf8",
  );
  const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  for (const [kind, rule] of [
    ["top_100", "EmailTop100Rule"],
    ["card_of_week", "EmailCardOfWeekRule"],
  ]) {
    const block = template.split(`\n  ${rule}:\n`)[1];
    const m = block.match(
      /ScheduleExpression: cron\((\d+) (\d+) \? \* (\w+) \*\)/,
    );
    assert.ok(m, rule);
    const slot = WRITTEN_SEND_SLOT[kind];
    assert.deepEqual(
      { minute: Number(m[1]), hour: Number(m[2]), day: DAYS.indexOf(m[3]) },
      { minute: 0, hour: slot.hour, day: slot.day },
    );
  }
});
