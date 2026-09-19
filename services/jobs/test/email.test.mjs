import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lastGameWeek,
  lastCollectorWeek,
  isoWeekKey,
  rangeLabel,
  whenLabel,
} from "../src/email/week.mjs";
import { momentKey } from "../src/email/build-milestone.mjs";
import { modeLabel } from "../src/email/shared.mjs";

test("the game week is Monday 10:00Z to Monday 10:00Z, the last completed one", () => {
  // Friday 2026-09-18 22:00Z: the week that closed Monday 09-14 10:00Z.
  const w = lastGameWeek(new Date("2026-09-18T22:00:00Z"));
  assert.equal(w.from.toISOString(), "2026-09-07T10:00:00.000Z");
  assert.equal(w.to.toISOString(), "2026-09-14T10:00:00.000Z");
  assert.equal(w.key, "2026-W37");
  assert.equal(w.label, "Sep 7 – 14");
  // Monday 09:59Z still belongs to the previous week's close.
  const early = lastGameWeek(new Date("2026-09-14T09:59:00Z"));
  assert.equal(early.to.toISOString(), "2026-09-07T10:00:00.000Z");
  // Monday 14:00Z, the Clan Report's slot: the week that just closed.
  const send = lastGameWeek(new Date("2026-09-14T14:00:00Z"));
  assert.equal(send.to.toISOString(), "2026-09-14T10:00:00.000Z");
});

test("the collector week is Sunday 14:00Z to Sunday 14:00Z", () => {
  const w = lastCollectorWeek(new Date("2026-09-20T14:00:00Z"));
  assert.equal(w.from.toISOString(), "2026-09-13T14:00:00.000Z");
  assert.equal(w.to.toISOString(), "2026-09-20T14:00:00.000Z");
  assert.ok(w.key.endsWith("c"));
});

test("labels cross a month boundary and iso weeks are numbered", () => {
  assert.equal(
    rangeLabel(
      new Date("2026-09-28T10:00:00Z"),
      new Date("2026-10-05T10:00:00Z"),
    ),
    "Sep 28 – Oct 5",
  );
  assert.equal(isoWeekKey(new Date("2026-01-01T00:00:00Z")), "2026-W01");
  assert.equal(
    whenLabel("2026-09-12T02:10:00Z", "America/Chicago"),
    "Fri 21:10",
  );
});

test("milestone keys are firsts: up only, by the moment's own identity", () => {
  assert.equal(
    momentKey("arena_changed", { from: 54000021, to: 54000022 }),
    "arena:54000022",
  );
  assert.equal(
    momentKey("arena_changed", { from: 54000022, to: 54000021 }),
    null,
  );
  assert.equal(momentKey("ranked_promotion", { from: 3, to: 4 }), "league:4");
  assert.equal(momentKey("ranked_promotion", { from: 5, to: 4 }), null);
  assert.equal(
    momentKey("best_trophies_band", { best: 12510, band: 12000 }),
    "band:12000",
  );
  assert.equal(
    momentKey("badge_earned", { badge: "MasteryMiner", level: 3 }),
    "badge:MasteryMiner:3",
  );
  assert.equal(
    momentKey("card_unlocked", { card: "Witch", evolution: 1 }),
    "card:Witch:1",
  );
  assert.equal(momentKey("battle_session", {}), null);
});

test("mode labels say what a player calls the mode", () => {
  assert.equal(modeLabel("Ladder", "PvP"), "Trophy Road");
  assert.equal(modeLabel("CW_Duel_1v1", "riverRaceDuel"), "War · Duel");
  assert.equal(modeLabel("CW_Battle_1v1", "riverRacePvP"), "War · 1v1");
  assert.equal(modeLabel("Showdown_Friendly", "trail"), "Friendly");
  assert.equal(modeLabel("ranked", ""), "Ranked");
  assert.equal(modeLabel("war", ""), "War");
});

test("deliver: the send has its own id, in the footer, in the queue message, in the archive and on the row (0139); the campaign period reaches the render", async () => {
  const { deliver } = await import("../src/email/deliver.mjs");
  const queries = [];
  const db = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };
  const enqueued = [];
  const put = [];
  const archive = {
    bucket: "b",
    s3: { send: async (cmd) => void put.push(cmd.input) },
  };
  const r = await deliver({
    db,
    enqueue: async (m) => void enqueued.push(m),
    secret: "s",
    kind: "milestone",
    issueId: 7,
    issueKey: "milestone/2026-09-19/acct",
    period: "2026-09-19",
    account: { accountId: "acct", email: "a@example.com", timezone: "UTC" },
    facts: {
      account: { name: "Jamie" },
      milestones: [
        {
          kind: "badge_earned",
          subject: { tag: "#1", name: "King Thing", relationship: "primary" },
          at: "Thu 20:02",
          headline: "You took Guards Mastery to level 5",
          big: "5",
          big_label: "Guards Mastery, level",
          lines: [],
          next: null,
        },
      ],
      also: [],
    },
    archive,
    now: new Date("2026-09-19T10:00:00Z"),
  });
  assert.equal(r.sent, true);
  assert.match(r.send_id, /^[0-9a-f-]{36}$/);
  const msg = enqueued[0];
  assert.equal(msg.send_id, r.send_id);
  assert.equal(msg.issue_key, "milestone/2026-09-19/acct");
  // The footer carries the id and its console link; the pixel names
  // the mail by period, which is what was throwing before (period was
  // not defined: every product send failed from the 09-18 pixel deploy
  // until this test existed).
  assert.ok(msg.html.includes(`/account/activity/e/${r.send_id}?report=1`));
  assert.ok(msg.html.includes("/account/activity/emails?utm_source=email"));
  assert.ok(msg.html.includes("path=%2Fmail%2Fmilestone%2F2026-09-19"));
  assert.ok(msg.html.includes("Guards Mastery"));
  assert.equal(
    put[0].Key,
    `mail/sent/dt=2026-09-19/send_id=${r.send_id}.json.gz`,
  );
  const row = queries.find((q) => q.sql.includes("insert into email_send"));
  assert.deepEqual(row.params.slice(0, 5), [
    r.send_id,
    7,
    "acct",
    msg.subject,
    true,
  ]);
});

test("deliver: a failed archive write still sends, and the row says so", async () => {
  const { deliver } = await import("../src/email/deliver.mjs");
  const queries = [];
  const db = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };
  const enqueued = [];
  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a);
  try {
    const r = await deliver({
      db,
      enqueue: async (m) => void enqueued.push(m),
      secret: "s",
      kind: "milestone",
      issueId: 7,
      issueKey: "k",
      period: "2026-09-19",
      account: { accountId: "acct", email: "a@example.com", timezone: "UTC" },
      facts: {
        account: { name: "J" },
        milestones: [
          {
            kind: "card_unlocked",
            subject: { tag: "#1", name: "J", relationship: "primary" },
            at: "Thu 23:17",
            headline: "You unlocked Goblin Hut",
            big: null,
            lines: [],
            next: null,
          },
        ],
        also: [],
      },
      archive: {
        bucket: "b",
        s3: {
          send: async () => {
            throw new Error("boom");
          },
        },
      },
    });
    assert.equal(r.sent, true);
    assert.equal(enqueued.length, 1);
    assert.equal(errors[0][0], "mail_archive_failed");
    const row = queries.find((q) => q.sql.includes("insert into email_send"));
    assert.equal(row.params[4], false);
  } finally {
    console.error = origError;
  }
});
