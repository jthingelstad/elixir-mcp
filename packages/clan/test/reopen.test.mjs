import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryLedger } from "@elixir-mcp/clan-state";
import { createManageService } from "@elixir-mcp/clan/manage/service.mjs";
import { createActionStore } from "@elixir-mcp/clan/manage/actions.mjs";
import { defaults } from "@elixir-mcp/clan-engine";

const clan = "#2PQRJ8LV",
  actor = { player_tag: "#LEAD", role: "leader", verified: true };
const request = {
  request_id: "00000000-0000-4000-8000-000000000001",
  expected_decided_at: "2026-10-03T12:00:00Z",
};
async function harness(extra = {}) {
  const ledger = createMemoryLedger();
  await ledger.savePolicy(clan, { values: defaults(), by: actor.player_tag });
  const card = {
    card_id: "example",
    number: 33,
    type: "welcome",
    status: "declined",
    raised_at: "2026-10-03T11:00:00Z",
    player_tag: "#NEW",
    evidence: { joined_at: "2026-10-03T10:00:00Z" },
    decided_at: request.expected_decided_at,
    decided_by: "#ELDER",
    decided_by_name: "Example Elder",
    decline_reason: "not_now",
    decision_note: "Later",
    ...extra,
  };
  await ledger.putCard(clan, card);
  const mcp = {
    callTool() {
      throw new Error("Reopen must not call Elixir or grant awards");
    },
  };
  const manage = createManageService({
    ledger,
    mcp,
    now: () => Date.parse("2026-10-03T13:00:00Z"),
  });
  return { ledger, manage, card };
}

test("leadership reopens the same identity and frozen content while preserving the original decline", async () => {
  const h = await harness();
  const next = await h.manage.reopen(clan, actor, h.card.card_id, request);
  assert.equal(next.status, "proposed");
  assert.equal(next.number, 33);
  assert.equal(next.card_id, h.card.card_id);
  assert.deepEqual(next.evidence, h.card.evidence);
  assert.equal(next.decided_at, null);
  assert.equal(next.reopenings[0].decline.decision_note, "Later");
  assert.equal(next.reopenings[0].decline.decided_by, "#ELDER");
  const logs = await h.ledger.actionLog(clan, h.card.card_id);
  const shaped = createActionStore({ ledger: h.ledger }).shapeAction(
    next,
    logs,
    actor,
  );
  assert.deepEqual(
    shaped.log.map((e) => e.kind),
    ["raised", "declined", "reopened"],
  );
  assert.equal(shaped.can_act, true);
  assert.equal(shaped.can_reopen, false);
  assert.equal((await h.ledger.cards(clan)).length, 1);
});

test("concurrent identical retries produce one transition and immutable audit entry; a competing request loses", async () => {
  const h = await harness();
  const [a, b] = await Promise.all([
    h.manage.reopen(clan, actor, "example", request),
    h.manage.reopen(clan, actor, "example", request),
  ]);
  assert.equal(a.status, "proposed");
  assert.equal(b.status, "proposed");
  const originalLog = await h.ledger.actionLog(clan, "example");
  await h.manage.reopen(clan, actor, "example", request);
  assert.deepEqual(await h.ledger.actionLog(clan, "example"), originalLog);
  assert.equal((await h.ledger.card(clan, "example")).reopenings.length, 1);
  await assert.rejects(
    h.manage.reopen(clan, actor, "example", {
      ...request,
      request_id: "00000000-0000-4000-8000-000000000002",
    }),
    (e) => e.code === "action_not_declined",
  );
});

test("reopen rejects other roles, unverified leadership, inaccessible cards and stale decisions", async () => {
  const h = await harness();
  for (const who of [
    { ...actor, role: "elder" },
    { ...actor, role: "member" },
    { ...actor, verified: false },
  ])
    await assert.rejects(
      h.manage.reopen(clan, who, "example", request),
      (e) => e.status === 403,
    );
  await assert.rejects(
    h.manage.reopen(clan, actor, "example", {
      ...request,
      expected_decided_at: "old",
    }),
    (e) => e.code === "action_changed",
  );
  await assert.rejects(
    h.manage.reopen(clan, actor, "example", {}),
    (e) => e.status === 400,
  );
  const assigned = await harness({
    type: "away",
    audience: { kind: "member", player_tag: "#OTHER" },
  });
  await assert.rejects(
    assigned.manage.reopen(clan, actor, "example", request),
    (e) => e.status === 404,
  );
  const next = await h.manage.reopen(
    clan,
    { ...actor, role: "coLeader" },
    "example",
    request,
  );
  assert.equal(next.status, "proposed");
});

test("completed, withdrawn and fully delivered actions cannot reopen; partial sent receipts stay intact", async () => {
  for (const status of ["done", "withdrawn", "proposed"]) {
    const h = await harness({ status });
    await assert.rejects(
      h.manage.reopen(clan, actor, "example", request),
      (e) => e.code === "action_not_declined",
    );
  }
  const extra = {
    type: "awards_standings",
    evidence: {
      snapshot: "frozen",
      messages: [
        { part: 1, title: "One", body: "Old words" },
        { part: 2, title: "Two", body: "Other words" },
      ],
    },
    messages_sent: [
      {
        part: 1,
        title: "Sent edited title",
        body: "Sent edited body",
        by: "#LEAD",
        at: "2026-10-03T11:30:00Z",
        shared: true,
      },
    ],
  };
  const h = await harness(extra);
  const next = await h.manage.reopen(clan, actor, "example", request);
  assert.deepEqual(next.messages_sent, extra.messages_sent);
  assert.deepEqual(next.evidence, extra.evidence);
  const delivered = await harness({
    ...extra,
    messages_sent: [...extra.messages_sent, { part: 2 }],
  });
  await assert.rejects(
    delivered.manage.reopen(clan, actor, "example", request),
    (e) => e.code === "action_already_delivered",
  );
  assert.equal(
    createActionStore({ ledger: delivered.ledger }).shapeAction(
      delivered.card,
      [],
      actor,
    ).can_reopen,
    false,
  );
});

test("lost audit write leaves a durable visible transition and same-request retry repairs its single log", async () => {
  const h = await harness();
  const append = h.ledger.appendActionLog;
  h.ledger.appendActionLog = async () => {
    throw new Error("synthetic audit outage");
  };
  await assert.rejects(
    h.manage.reopen(clan, actor, "example", request),
    /synthetic audit outage/,
  );
  const saved = await h.ledger.card(clan, "example");
  assert.equal(saved.status, "proposed");
  const visible = createActionStore({ ledger: h.ledger }).shapeAction(
    saved,
    [],
    actor,
  );
  assert.deepEqual(
    visible.log.map((e) => e.kind),
    ["raised", "declined", "reopened"],
  );
  h.ledger.appendActionLog = append;
  await h.manage.reopen(clan, actor, "example", request);
  assert.equal((await h.ledger.actionLog(clan, "example")).length, 1);
  assert.equal((await h.ledger.card(clan, "example")).reopenings.length, 1);
});

test("later decline cycles keep both decisions, and an old successful retry cannot reopen a completed action", async () => {
  const h = await harness();
  const first = await h.manage.reopen(clan, actor, "example", request);
  const decided_at = "2026-10-03T13:30:00Z";
  await h.ledger.putCard(clan, {
    ...first,
    status: "declined",
    decided_at,
    decided_by: actor.player_tag,
    decision_note: "A later decline",
  });
  await assert.rejects(
    h.manage.reopen(clan, actor, "example", {
      ...request,
      request_id: "00000000-0000-4000-8000-000000000002",
    }),
    (e) => e.code === "action_changed",
  );
  const second = await h.manage.reopen(clan, actor, "example", {
    request_id: "00000000-0000-4000-8000-000000000002",
    expected_decided_at: decided_at,
  });
  assert.equal(second.reopenings.length, 2);
  const shaped = createActionStore({ ledger: h.ledger }).shapeAction(
    second,
    await h.ledger.actionLog(clan, "example"),
    actor,
  );
  assert.equal(shaped.log.filter((e) => e.kind === "declined").length, 2);
  assert.equal(shaped.log.filter((e) => e.kind === "reopened").length, 2);
  const done = {
    ...second,
    status: "done",
    decided_at: "2026-10-03T14:00:00Z",
  };
  await h.ledger.putCard(clan, done);
  assert.equal(
    (await h.manage.reopen(clan, actor, "example", request)).status,
    "done",
  );
  assert.deepEqual(await h.ledger.card(clan, "example"), done);
});
