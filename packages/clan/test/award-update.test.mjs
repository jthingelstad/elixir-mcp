import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryLedger } from "@elixir-mcp/clan-state";
import { createAwardsService } from "../src/manage/awards.mjs";
import { createManageService } from "../src/manage/service.mjs";
import { factsOfAction } from "../src/manage/sharing.mjs";
import {
  timelyAwardWeek,
  currentAwardUpdate,
} from "../src/manage/award-week.mjs";
import {
  member,
  participation,
  NOW,
  EXAMPLE_AWARDS,
  EXAMPLE_POLICY,
} from "@elixir-mcp/clan-engine/fixtures";
import { seedVersion, fakeMcp } from "./fakes.mjs";
const tag = "#TEST";
const who = {
  player_tag: "#Q0",
  name: "Example",
  role: "leader",
  verified: true,
};
const first = "00000000-0000-0000-0000-000000000001";
const second = "00000000-0000-0000-0000-000000000002";
function harness() {
  const ledger = createMemoryLedger();
  const record = participation(
    Array.from({ length: 10 }, (_, i) => member(`#Q${i}`)),
  );
  seedVersion(ledger, "policy", tag, EXAMPLE_POLICY);
  seedVersion(ledger, "awards", tag, EXAMPLE_AWARDS);
  let reads = 0;
  const service = createAwardsService({
    ledger,
    now: () => NOW.getTime(),
    participationFor: async () => {
      reads++;
      return structuredClone(record);
    },
  });
  const mcp = fakeMcp();
  const manage = createManageService({
    ledger,
    mcp,
    now: () => NOW.getTime(),
  });
  return { ledger, record, service, manage, mcp, reads: () => reads };
}
test("current update freezes one Action without granting, recovers the same request and permits a deliberate later request", async () => {
  const h = harness();
  const a = (await h.service.currentUpdate(tag, who, "fixture", first)).action;
  assert.ok(a.evidence.messages.length > 1);
  assert.equal(a.evidence.scope, "current");
  assert.ok(a.evidence.as_of);
  assert.equal((await h.ledger.grants(tag)).length, 0);
  assert.equal((await h.ledger.awardPlans(tag)).length, 0);
  assert.equal((await h.ledger.weeklyAwardPlans(tag)).length, 0);
  h.record.members[0].war_points[5] = 99999;
  assert.deepEqual(
    (await h.service.currentUpdate(tag, who, "fixture", first)).action,
    a,
  );
  assert.equal(h.reads(), 1);
  await h.service.currentUpdate(tag, who, "fixture", second);
  assert.equal((await h.ledger.cards(tag)).length, 2);
  await h.ledger.putCard(tag, { ...a, status: "declined" });
  assert.equal(
    (await h.service.currentUpdate(tag, who, "fixture", first)).action.status,
    "declined",
  );
  assert.equal((await h.ledger.cards(tag)).length, 2);
  for (const reader of [
    { ...who, role: "elder" },
    { ...who, role: "member" },
    { ...who, verified: false },
  ])
    await assert.rejects(
      h.service.currentUpdate(tag, reader, "fixture", first),
      (e) => e.status === 403,
    );
});
test("message delivery is explicit, durable, idempotent, preserves actual edited words and is required before completing", async () => {
  const h = harness();
  const a = (await h.service.currentUpdate(tag, who, "fixture", first)).action;
  await assert.rejects(
    h.manage.decide(tag, who, a.card_id, { status: "done" }),
    (e) => e.code === "messages_not_sent",
  );
  assert.equal((await h.ledger.card(tag, a.card_id)).messages_sent, undefined);
  const edited = {
    title: "Reviewed update",
    body: "Reviewed provisional results.",
  };
  const partial = await h.manage.messageSent(tag, who, a.card_id, 1, edited);
  assert.equal(partial.status, "proposed");
  assert.equal(partial.messages_sent[0].body, edited.body);
  assert.deepEqual(
    await h.manage.messageSent(tag, who, a.card_id, 1, {
      title: "Different",
      body: "Different",
    }),
    partial,
  );
  const facts = factsOfAction(a, partial, { message_part: 1 });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].type, "clan_message");
  assert.equal(facts[0].ref, `action:${a.card_id}:message:1`);
  assert.equal(facts[0].detail.body, edited.body);
  assert.deepEqual(factsOfAction(a, { ...partial, status: "done" }), []);
  await assert.rejects(
    h.manage.messageSent(
      tag,
      { ...who, verified: false },
      a.card_id,
      2,
      edited,
    ),
    (e) => e.status === 403,
  );
  for (const message of a.evidence.messages.slice(1))
    await h.manage.messageSent(
      tag,
      who,
      a.card_id,
      message.part,
      message.message,
    );
  const done = await h.manage.decide(tag, who, a.card_id, { status: "done" });
  assert.equal(done.messages_sent.length, a.evidence.messages.length);
  assert.equal(done.status, "done");
});
test("skipping remaining messages keeps previous delivery receipts and cannot raise a replacement", async () => {
  const h = harness();
  const a = (await h.service.currentUpdate(tag, who, "fixture", first)).action;
  await h.manage.messageSent(
    tag,
    who,
    a.card_id,
    1,
    a.evidence.messages[0].message,
  );
  const skipped = await h.manage.decide(tag, who, a.card_id, {
    status: "declined",
  });
  assert.equal(skipped.messages_sent.length, 1);
  await assert.rejects(
    h.manage.messageSent(
      tag,
      who,
      a.card_id,
      2,
      a.evidence.messages[1].message,
    ),
    (e) => e.code === "action_closed",
  );
  assert.equal(
    (await h.service.currentUpdate(tag, who, "fixture", first)).action.card_id,
    a.card_id,
  );
  assert.equal((await h.ledger.cards(tag)).length, 1);
});
test("weekly selection uses newest observed closure only, excludes closed seasons and respects the seven-day boundary", () => {
  const h = harness();
  const week = h.record.war_weeks.at(-1);
  week.finished_observed_at = new Date(
    NOW.getTime() - 7 * 86400000,
  ).toISOString();
  week.is_colosseum = false;
  assert.equal(
    timelyAwardWeek(h.record, NOW).section_index,
    week.section_index,
  );
  assert.equal(timelyAwardWeek(h.record, new Date(NOW.getTime() + 1)), null);
  week.finished_observed_at = NOW.toISOString();
  week.is_colosseum = true;
  assert.equal(timelyAwardWeek(h.record, NOW), null);
  week.is_colosseum = false;
  week.finished_observed_at = new Date(NOW.getTime() + 1).toISOString();
  assert.equal(timelyAwardWeek(h.record, NOW), null);
});
test("Actions list reads logs only for visible returned cards and detail reads only its own log", async () => {
  const h = harness();
  await h.ledger.saveVerdicts(tag, {
    evaluated_at: NOW.toISOString(),
    as_of: NOW.toISOString(),
    policy_version: 1,
  });
  for (let i = 0; i < 1000; i++) {
    const card = {
      card_id: `c${i}`,
      number: i + 1,
      type: "welcome",
      player_tag: `#Q${i}`,
      status: i < 10 ? "proposed" : "done",
      raised_at: i < 10 ? NOW.toISOString() : "2020-01-01T00:00:00Z",
    };
    await h.ledger.putCard(tag, card);
    await h.ledger.appendActionLog(tag, {
      card_id: card.card_id,
      kind: "comment",
      at: card.raised_at,
      text: "Synthetic comment",
    });
  }
  h.ledger.actionLogs = async () => assert.fail("must not read every log");
  const bounded = h.ledger.actionLogsFor.bind(h.ledger);
  let ids;
  h.ledger.actionLogsFor = async (clan, wanted) => {
    ids = wanted;
    return bounded(clan, wanted);
  };
  const list = await h.manage.actionsView(tag, who, "fixture");
  assert.equal(list.open.length, 10);
  assert.equal(ids.length, 10);
  const log = h.ledger.actionLog.bind(h.ledger);
  let readId;
  h.ledger.actionLog = async (clan, id) => {
    readId = id;
    return log(clan, id);
  };
  const detail = await h.manage.actionByNumber(tag, who, 1);
  assert.equal(readId, "c0");
  assert.ok(detail.action.log.some((e) => e.kind === "comment"));
});

test("Actions processing reuses a stale saved evaluation until suggestions are explicitly refreshed", async () => {
  const h = harness();
  await h.ledger.saveVerdicts(tag, {
    evaluated_at: "2020-01-01T00:00:00Z",
    as_of: "2020-01-01T00:00:00Z",
    policy_version: 1,
  });
  h.mcp.state.refuse = true;
  const list = await h.manage.actionsView(tag, who, "fixture");
  assert.equal(list.evaluated_at, "2020-01-01T00:00:00Z");
  assert.equal(list.cached, true);
  assert.equal(h.mcp.calls.length, 0);
  await assert.rejects(
    h.manage.actionsView(tag, who, "fixture", { refresh: true }),
    (e) => e.status === 401,
  );
  assert.ok(h.mcp.calls.length > 0);
});

test("a closed latest season cannot make an older incomplete season the current update", () => {
  const h = harness();
  // No final Colosseum in 135, but its old open section is not current.
  h.record.war_weeks = h.record.war_weeks.filter(
    (w) => !(w.season_id === 135 && w.section_index === 4),
  );
  h.record.war_weeks.find(
    (w) => w.season_id === 135 && w.section_index === 3,
  ).finished_observed_at = null;
  const newest = h.record.war_weeks.at(-1);
  newest.is_colosseum = true;
  newest.finished_observed_at = NOW.toISOString();
  assert.equal(
    currentAwardUpdate({
      participation: h.record,
      config: EXAMPLE_AWARDS,
      now: NOW,
    }),
    null,
  );
});

test("a receipt saved before its audit fails is recovered with the original words and sender", async () => {
  const h = harness();
  const a = (await h.service.currentUpdate(tag, who, "fixture", first)).action;
  const append = h.ledger.appendActionLog.bind(h.ledger);
  let fail = true;
  h.ledger.appendActionLog = async (clan, entry) => {
    if (entry.kind === "message_sent" && fail) {
      fail = false;
      throw new Error("synthetic audit failure");
    }
    return append(clan, entry);
  };
  const edited = { title: "Reviewed", body: "Original reviewed words." };
  await assert.rejects(
    h.manage.messageSent(tag, who, a.card_id, 1, edited, "fixture"),
  );
  assert.equal(
    (await h.ledger.card(tag, a.card_id)).messages_sent[0].body,
    edited.body,
  );
  const coLeader = {
    ...who,
    player_tag: "#Q1",
    name: "Other",
    role: "coLeader",
  };
  await h.manage.messageSent(
    tag,
    coLeader,
    a.card_id,
    1,
    { title: "Other", body: "Other words" },
    "other-token",
  );
  assert.equal(
    h.mcp.state.facts.length,
    0,
    "another leader cannot become the original sender",
  );
  await h.manage.messageSent(tag, who, a.card_id, 1, edited, "fixture");
  await h.manage.messageSent(tag, who, a.card_id, 1, edited, "fixture");
  const logs = (await h.ledger.actionLog(tag, a.card_id)).filter(
    (e) => e.kind === "message_sent",
  );
  assert.equal(logs.length, 1);
  assert.equal(logs[0].by.tag, who.player_tag);
  assert.equal(h.mcp.state.facts.length, 1);
  assert.equal(h.mcp.state.facts[0].detail.body, edited.body);
  assert.equal(
    (await h.ledger.card(tag, a.card_id)).messages_sent[0].shared,
    true,
  );
});

test("new current game copy keeps freshness in the app, formats scores and avoids metadata walls", () => {
  const h = harness();
  const update = currentAwardUpdate({
    participation: h.record,
    config: EXAMPLE_AWARDS,
    now: NOW,
  });
  assert.equal(update.as_of, h.record.meta.as_of);
  const text = update.parts.map((p) => p.message.body).join(" ");
  assert.doesNotMatch(
    text,
    /UTC|\d{2}-\d{2} \d{2}:\d{2}|human choice|evidence|#[A-Z0-9]+|points\.|cards\./,
  );
  assert.match(text, /So far:/);
  assert.ok(
    update.parts.every(
      (p) => p.message.title.length <= 24 && p.message.body.length <= 180,
    ),
  );
});
