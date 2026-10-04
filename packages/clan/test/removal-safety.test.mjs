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
  const clock = { t: NOW.getTime() };
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
    now: () => clock.t,
    activityFor,
    mcp: { callTool: async () => ({ ok: true, body: part }) },
  });
  return { ledger, card, subject, part, manage, clock, reads: () => reads };
}
const held = (e) => e.status === 409 && e.code === "removal_evidence_held";
const gap = (h) => {
  h.subject.activity_evidence.observations.at(-1).battle_count = 2;
  h.subject.activity_evidence.observations.at(-1).profile_observed_at =
    new Date(NOW.getTime() - 3600_000).toISOString();
};

test("exact-time and later flat counters cannot admit cached removal words, drafts, completion or reopening", async () => {
  for (const elapsed of [0, 1, 3600_000, 30 * 3600_000]) {
    const h = await harness();
    h.clock.t += elapsed;
    // A claimed flag is not a source contract and cannot fabricate coverage.
    h.subject.activity_evidence.all_modes_covered = true;
    const before = structuredClone(await h.ledger.card(clan, h.card.card_id));
    for (const a of [
      (await h.manage.actionsView(clan, who, "token")).open[0],
      (await h.manage.actionByNumber(clan, who, 45, "token")).action,
    ]) {
      assert.equal(a.removal_safety.status, "held");
      assert.equal(a.removal_safety.counter_quiet_days, 20);
      assert.equal(a.copy, null);
      assert.equal(a.can_complete, false);
      assert.equal(a.can_draft, false);
      if (elapsed === 0) {
        assert.equal(a.removal_safety.unmeasured_tail_hours, 0);
        assert.match(a.removal_safety.reason, /across every mode/);
      }
    }
    let modelCalls = 0;
    const drafts = createDrafts({
      ledger: h.ledger,
      requireRemovalSafety: h.manage.requireRemovalSafety,
      model: {
        write() {
          modelCalls++;
        },
      },
    });
    await assert.rejects(
      drafts.leaderMessage(clan, who, "token", h.card.card_id),
      held,
    );
    await assert.rejects(
      h.manage.decide(clan, who, h.card.card_id, { status: "done" }, "token"),
      held,
    );
    assert.equal(modelCalls, 0);
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
    assert.equal(
      (await h.manage.history(clan, who)).cards[0].can_reopen,
      false,
    );
  }
});

test("old cached eligible verdicts recompute under the all-mode guard and preserve frozen history", async () => {
  const h = await harness();
  const legacy = await h.ledger.latestVerdicts(clan);
  legacy.removal_evidence_schema = 2;
  const old = legacy.members.find((m) => m.player_tag === h.subject.player_tag);
  old.actionable.removal = true;
  old.judgment.removal = "ready";
  old.removal.triage = {
    status: "eligible",
    reason: "Legacy narrow-counter admission",
  };
  await h.ledger.saveVerdicts(clan, legacy);
  const view = await h.manage.manageView(clan, who, "token");
  assert.equal(view.cached, false);
  assert.equal(
    view.board.find((m) => m.player_tag === h.subject.player_tag).removal.triage
      .status,
    "evidence_held",
  );
  assert.equal(
    view.inbox.some((c) => c.type === "removal"),
    false,
  );
  const stored = await h.ledger.card(clan, h.card.card_id);
  assert.equal(stored.status, "withdrawn");
  assert.deepEqual(stored.evidence, h.card.evidence);
  assert.equal(stored.decided_by, undefined);
  assert.equal(
    (await h.ledger.latestVerdicts(clan)).removal_evidence_schema,
    3,
  );
});

test("Board cache keeps role protection and recent captured play out of removal evidence triage", async () => {
  for (const kind of ["protected", "recent"]) {
    const h = await harness();
    gap(h);
    if (kind === "protected") h.subject.role = "leader";
    else
      h.subject.last_battle_time = new Date(
        NOW.getTime() - 3600_000,
      ).toISOString();
    for (let i = 0; i < 2; i++) {
      const view = await h.manage.manageView(clan, who, "token");
      assert.equal(view.cached, i === 1);
      const row = view.board.find((m) => m.player_tag === h.subject.player_tag);
      assert.equal(
        row.removal.triage.status,
        kind === "protected" ? "protected" : "not_candidate",
      );
      assert.notEqual(row.bucket, "held");
      assert.ok(
        row.judgment_reasons.every((r) => !r.startsWith("Removal held:")),
      );
      assert.equal(
        view.inbox.some(
          (c) => c.type === "removal" && c.player_tag === h.subject.player_tag,
        ),
        false,
      );
    }
  }
});

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
  assert.match(c.withdraw_reason, /positive counter bracket/);
  assert.deepEqual(c.evidence, h.card.evidence);
  assert.equal(c.decided_by, undefined);
  assert.equal(
    (await h.ledger.actionLog(clan, c.card_id))[0].kind,
    "withdrawn",
  );
});

test("draft orchestration rechecks its injected guard after a fake model call, without assuming real all-mode coverage", async () => {
  const h = await harness();
  let calls = 0,
    checks = 0;
  const drafts = createDrafts({
    ledger: h.ledger,
    // Only the orchestration unit is mocked here. The real guard is held
    // from the start and is exercised separately at exact time and later.
    requireRemovalSafety: async (...args) => {
      checks++;
      if (checks < 3) return { evidence_version: "synthetic-unit-guard" };
      return h.manage.requireRemovalSafety(...args);
    },
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

test("profile-day gaps keep cached removal completion, reopening and model admission closed", async () => {
  const h = await harness();
  h.subject.activity_evidence.profile_gaps = [
    {
      snapshot_date: new Date(NOW.getTime() - 2 * 86400_000)
        .toISOString()
        .slice(0, 10),
    },
  ];
  const a = (await h.manage.actionByNumber(clan, who, 45, "token")).action;
  assert.equal(a.can_complete, false);
  assert.equal(a.can_draft, false);
  assert.match(a.removal_safety.reason, /observations are missing/);
  await assert.rejects(
    h.manage.decide(clan, who, h.card.card_id, { status: "done" }, "token"),
    held,
  );
  let modelCalls = 0;
  const drafts = createDrafts({
    ledger: h.ledger,
    model: {
      write() {
        modelCalls++;
      },
    },
    requireRemovalSafety: h.manage.requireRemovalSafety,
  });
  await assert.rejects(
    drafts.leaderMessage(clan, who, "token", h.card.card_id),
    held,
  );
  assert.equal(modelCalls, 0);
  assert.equal((await h.ledger.card(clan, h.card.card_id)).status, "proposed");
});

test("draft orchestration binds the version returned by its injected guard", async () => {
  const h = await harness();
  let checks = 0,
    calls = 0;
  // No source coverage is simulated. This unit checks version handling;
  // actual admission always holds and is covered by the service tests above.
  const drafts = createDrafts({
    ledger: h.ledger,
    requireRemovalSafety: async () => ({
      evidence_version: ++checks < 3 ? "unit-before" : "unit-after",
    }),
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
  assert.equal(checks, 3);
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
