import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryLedger } from "@elixir-mcp/clan-state";
import { evaluate } from "@elixir-mcp/clan-engine";
import {
  member,
  participation,
  NOW,
  EXAMPLE_POLICY,
} from "@elixir-mcp/clan-engine/fixtures";
import { createManageService } from "../src/manage/service.mjs";
import { createDrafts } from "../src/manage/drafts.mjs";
import { createActionStore } from "../src/manage/actions.mjs";

const clan = "#TEST",
  who = { player_tag: "#LEAD", role: "leader", verified: true };
async function harness() {
  const ledger = createMemoryLedger();
  await ledger.savePolicy(clan, { values: EXAMPLE_POLICY, by: who.player_tag });
  const subject = member("#SYNTHETIC", {
    lastBattleDaysAgo: 20,
    war: [0, 0, 0, 0, 0, 0],
  });
  const part = participation([
    ...Array.from({ length: 10 }, (_, i) => member(`#PEER${i}`)),
    subject,
  ]);
  await ledger.saveVerdicts(
    clan,
    evaluate({
      participation: part,
      policy: EXAMPLE_POLICY,
      policy_version: 1,
      now: NOW,
    }),
  );
  const card = {
    card_id: "old-removal",
    number: 45,
    clan_tag: clan,
    player_tag: subject.player_tag,
    player_name: "Invented member",
    type: "removal",
    status: "proposed",
    policy_version: 1,
    raised_at: NOW.toISOString(),
    evidence: {
      days_idle: 8.02,
      rationale: { headline: "8.02 battle-free days." },
      facts: [],
    },
  };
  await ledger.putCard(clan, card);
  let reads = 0;
  const activityFor = async (_tag, tags) => {
    reads++;
    return new Map(
      part.members
        .filter((m) => tags.includes(m.player_tag))
        .map((m) => [m.player_tag, m]),
    );
  };
  const manage = createManageService({
    ledger,
    now: () => NOW.getTime(),
    activityFor,
    mcp: { callTool: async () => ({ ok: true, body: part }) },
  });
  return { ledger, card, subject, part, manage, reads: () => reads };
}
const held = (e) => e.status === 409 && e.code === "removal_evidence_held";
const gap = (h) => {
  h.subject.activity_evidence.observations.at(-1).battle_count = 2;
  h.subject.activity_evidence.observations.at(-1).profile_observed_at =
    new Date(NOW.getTime() - 3600_000).toISOString();
};

test("cached list/detail withhold stale removal words; drafting and direct completion refuse without deciding; explicit decline remains", async () => {
  const h = await harness();
  gap(h);
  const before = structuredClone(await h.ledger.card(clan, h.card.card_id));
  for (const action of [
    (await h.manage.actionsView(clan, who, "token")).open[0],
    (await h.manage.actionByNumber(clan, who, 45, "token")).action,
  ]) {
    assert.equal(action.removal_safety.status, "held");
    assert.equal(
      action.removal_safety.latest_activity_interval.counter_increase,
      1,
    );
    assert.equal(action.copy, null);
    assert.equal(action.channel, null);
    assert.equal(action.can_complete, false);
    assert.equal(action.can_draft, false);
    assert.equal(action.can_act, true);
    assert.deepEqual(action.evidence, before.evidence);
  }
  let calls = 0;
  const drafts = createDrafts({
    ledger: h.ledger,
    model: {
      write() {
        calls++;
      },
    },
    requireRemovalSafety: h.manage.requireRemovalSafety,
  });
  await assert.rejects(
    drafts.leaderMessage(clan, who, "token", h.card.card_id),
    held,
  );
  await assert.rejects(
    h.manage.decide(clan, who, h.card.card_id, { status: "done" }, "token"),
    held,
  );
  assert.equal(calls, 0);
  assert.deepEqual(await h.ledger.card(clan, h.card.card_id), before);
  assert.equal((await h.ledger.actionLog(clan, h.card.card_id)).length, 0);
  await h.manage.decide(clan, who, h.card.card_id, {
    status: "declined",
    reason: "evidence_wrong",
  });
  const declined = await h.ledger.card(clan, h.card.card_id);
  await assert.rejects(
    h.manage.reopen(
      clan,
      who,
      h.card.card_id,
      {
        request_id: "00000000-0000-4000-8000-000000000001",
        expected_decided_at: declined.decided_at,
      },
      "token",
    ),
    held,
  );
  assert.deepEqual(await h.ledger.card(clan, h.card.card_id), declined);
  assert.equal((await h.manage.history(clan, who)).cards[0].can_reopen, false);
  assert.ok(h.reads() >= 5);
});

test("fresh evaluation withdraws unsafe pending removal with an audit reason and frozen old evidence", async () => {
  const h = await harness();
  gap(h);
  await h.manage.evaluateClan({
    clanTag: clan,
    token: "token",
    who,
    force: true,
  });
  const c = await h.ledger.card(clan, h.card.card_id);
  assert.equal(c.status, "withdrawn");
  assert.match(c.withdraw_reason, /Inactivity is not established/);
  assert.deepEqual(c.evidence, h.card.evidence);
  assert.equal(c.decided_by, undefined);
  assert.equal(
    (await h.ledger.actionLog(clan, c.card_id))[0].kind,
    "withdrawn",
  );
});

test("new counter evidence during a fake model call rejects the result and logs no draft or decision", async () => {
  const h = await harness();
  let calls = 0;
  const drafts = createDrafts({
    ledger: h.ledger,
    requireRemovalSafety: h.manage.requireRemovalSafety,
    now: () => NOW.getTime(),
    model: {
      async write() {
        calls++;
        gap(h);
        return { model: "fake", input: { line: "Old removal words" } };
      },
    },
  });
  await assert.rejects(
    drafts.leaderMessage(clan, who, "token", h.card.card_id),
    held,
  );
  assert.equal(calls, 1);
  assert.equal((await h.ledger.card(clan, h.card.card_id)).status, "proposed");
  assert.equal((await h.ledger.actionLog(clan, h.card.card_id)).length, 0);
});

test("a failed current evidence read holds rather than trusting frozen eligible evidence", async () => {
  const h = await harness();
  const manage = createManageService({
    ledger: h.ledger,
    now: () => NOW.getTime(),
    mcp: {
      callTool() {
        throw Error("unused");
      },
    },
    activityFor() {
      throw Error("read unavailable");
    },
  });
  const a = (await manage.actionByNumber(clan, who, 45)).action;
  assert.match(a.removal_safety.reason, /could not be read/);
  assert.equal(a.copy, null);
  await assert.rejects(
    manage.decide(clan, who, h.card.card_id, { status: "done" }),
    held,
  );
});

test("the draft guard hashes the final evidence admitted by its second read", async () => {
  const h = await harness();
  let reads = 0,
    calls = 0;
  const manage = createManageService({
    ledger: h.ledger,
    now: () => NOW.getTime(),
    mcp: { callTool: async () => ({ ok: true, body: h.part }) },
    activityFor: async (_tag, tags) => {
      reads++;
      return new Map(
        h.part.members
          .filter((m) => tags.includes(m.player_tag))
          .map((m) => [
            m.player_tag,
            {
              ...m,
              activity_evidence: {
                ...m.activity_evidence,
                observations: m.activity_evidence.observations.map((r) => ({
                  ...r,
                  battle_count: r.battle_count + (reads >= 6 ? 100 : 0),
                })),
              },
            },
          ]),
      );
    },
  });
  const drafts = createDrafts({
    ledger: h.ledger,
    requireRemovalSafety: manage.requireRemovalSafety,
    model: {
      async write() {
        calls++;
        return { model: "fake", input: { line: "Old context" } };
      },
    },
  });
  await assert.rejects(
    drafts.leaderMessage(clan, who, "token", h.card.card_id),
    (e) => e.code === "draft_changed",
  );
  assert.equal(reads, 6);
  assert.equal(calls, 1);
  assert.equal((await h.ledger.actionLog(clan, h.card.card_id)).length, 0);
});

test("a failed withdrawal log append leaves durable proof recoverable beside an existing raised entry", async () => {
  const h = await harness();
  await h.ledger.appendActionLog(clan, {
    card_id: h.card.card_id,
    kind: "raised",
    at: NOW.toISOString(),
    by: { system: "elixir-clan" },
    text: "Historical rationale",
  });
  const append = h.ledger.appendActionLog.bind(h.ledger);
  let fail = true;
  h.ledger.appendActionLog = async (tag, entry) => {
    if (fail && entry.kind === "withdrawn") {
      fail = false;
      throw Error("lost append");
    }
    return append(tag, entry);
  };
  const store = createActionStore({
    ledger: h.ledger,
    now: () => NOW.getTime(),
  });
  const detail = {
    activity_evidence: {
      status: "held",
      reason: "Unmeasured tail",
      latest_activity_interval: { counter_increase: 1 },
    },
  };
  await assert.rejects(
    store.withdrawAction(
      clan,
      h.card,
      "Inactivity is not established.",
      detail,
    ),
    /lost append/,
  );
  const saved = await h.ledger.card(clan, h.card.card_id);
  assert.equal(saved.status, "withdrawn");
  assert.deepEqual(saved.withdraw_detail, detail);
  const log = await h.ledger.actionLog(clan, h.card.card_id);
  const read = store.shapeAction(saved, log, who);
  const withdrawal = read.log.find((e) => e.kind === "withdrawn");
  assert.deepEqual(
    withdrawal.detail.activity_evidence,
    detail.activity_evidence,
  );
  assert.equal(withdrawal.detail.reconstructed, true);
  assert.deepEqual(withdrawal.by, { system: "elixir-clan" });
  assert.equal(read.log.filter((e) => e.kind === "raised").length, 1);
  assert.equal(
    await store.withdrawAction(
      clan,
      h.card,
      "Inactivity is not established.",
      detail,
    ),
    false,
  );
  assert.deepEqual(
    (await h.ledger.card(clan, h.card.card_id)).evidence,
    h.card.evidence,
  );
});
