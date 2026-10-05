import test from "node:test";
import assert from "node:assert/strict";
import {
  actionDelivery,
  chatLines,
  deliveryWords,
} from "@elixir-mcp/clan-engine";
import { ATTESTED_FACT_TYPES } from "@elixir-mcp/contracts";
import { createMemoryLedger } from "@elixir-mcp/clan-state";
import { createActionStore } from "../src/manage/actions.mjs";
import { createManageService } from "../src/manage/service.mjs";
import { factsOfAction } from "../src/manage/sharing.mjs";
import { fakeMcp, seedVersion } from "./fakes.mjs";
import { EXAMPLE_POLICY, NOW } from "@elixir-mcp/clan-engine/fixtures";

const tag = "#TEST";
const who = {
  player_tag: "#Q0",
  name: "Example",
  role: "leader",
  verified: true,
};
const legacy = (type = "rules_announcement") => ({
  card_id: "legacy",
  number: 1,
  type,
  status: "proposed",
  audience: { kind: "leaders" },
  raised_at: NOW.toISOString(),
  player_name: "Example",
  evidence: {
    version: 4,
    message: { title: "Our rules", body: "Review our rules." },
  },
});
function setup() {
  const ledger = createMemoryLedger();
  seedVersion(ledger, "policy", tag, EXAMPLE_POLICY);
  const store = createActionStore({ ledger, now: () => NOW.getTime() });
  const manage = createManageService({
    ledger,
    mcp: fakeMcp(),
    now: () => NOW.getTime(),
  });
  return { ledger, store, manage };
}

test("fresh delivery freezes chat defaults and bounded alternatives without changing legacy semantics", async () => {
  const h = setup();
  for (const type of [
    "promotion",
    "demotion",
    "awards_standings",
    "awards_announcement",
    "rules_announcement",
  ]) {
    const old = legacy(type);
    const original = structuredClone(old);
    assert.equal(h.store.shapeAction(old, [], who).channel, "leader_message");
    const next = await h.store.raiseAction(tag, { ...old, card_id: type }, [], {
      text: "Fixture",
    });
    assert.equal(next.delivery.channel, "clan_chat");
    assert.equal(h.store.shapeAction(next, [], who).channel, "clan_chat");
    const options = next.delivery.parts[0].options;
    assert.ok(options.clan_chat.lines.every((line) => line.length <= 200));
    assert.equal(
      !!options.leader_message,
      !["promotion", "demotion"].includes(type),
    );
    // Rendering later evidence or today's defaults cannot alter frozen words.
    const changed = {
      ...next,
      evidence: { message: { title: "Changed", body: "Changed" } },
    };
    assert.deepEqual(actionDelivery(changed), next.delivery);
    assert.deepEqual(old, original);
  }
  const message = { title: "T".repeat(24), body: "B".repeat(180) };
  assert.deepEqual(chatLines(message), [message.title, message.body]);
  assert.throws(() =>
    deliveryWords(legacy(), { channel: "clan_chat", lines: ["x".repeat(201)] }),
  );
  assert.throws(() =>
    deliveryWords(legacy(), {
      channel: "leader_message",
      title: "x".repeat(25),
      body: "Body",
    }),
  );
  assert.throws(() =>
    deliveryWords(legacy(), {
      channel: "leader_message",
      title: "Title",
      body: "x".repeat(181),
    }),
  );
  assert.throws(() =>
    deliveryWords(legacy(), { channel: "unknown", lines: ["Body"] }),
  );
});

test("explicit reviewed channel and exact words are durable in completed history and the audit log", async () => {
  const h = setup();
  const card = await h.store.raiseAction(tag, legacy(), [], {
    text: "Fixture",
  });
  await assert.rejects(
    h.manage.decide(tag, who, card.card_id, { status: "done" }),
    (e) => e.code === "bad_message",
  );
  const sent = {
    channel: "leader_message",
    title: "Reviewed",
    body: " Reviewed words. ",
  };
  const done = await h.manage.decide(tag, who, card.card_id, {
    status: "done",
    sent,
  });
  assert.deepEqual(done.sent, sent);
  assert.deepEqual((await h.ledger.card(tag, card.card_id)).sent, sent);
  const audit = (await h.ledger.actionLog(tag, card.card_id)).find(
    (e) => e.kind === "completed",
  );
  assert.deepEqual(audit.detail.sent, sent);
  const view = h.store.shapeAction(done, [], who);
  assert.equal(view.channel, "leader_message");
  assert.equal(view.can_act, false);
  await assert.rejects(
    h.manage.decide(tag, who, card.card_id, {
      status: "done",
      sent: { channel: "clan_chat", lines: ["Replacement"] },
    }),
    (e) => e.code === "action_closed",
  );
  assert.deepEqual((await h.ledger.card(tag, card.card_id)).sent, sent);
  const historical = {
    ...legacy(),
    status: "done",
    decided_at: NOW.toISOString(),
  };
  assert.equal(
    h.store.shapeAction(historical, [], who).channel,
    "leader_message",
  );
  assert.equal(h.store.shapeAction(historical, [], who).sent, undefined);
});

test("mixed-channel partial receipts survive interrupted and repeated requests; each chat fact fits the existing contract", async () => {
  const h = setup();
  const card = await h.store.raiseAction(
    tag,
    {
      ...legacy("awards_standings"),
      evidence: {
        messages: [
          {
            part: 1,
            message: {
              title: "Season 136",
              body: "So far: Points Cup: Ada, Bob.",
            },
          },
          {
            part: 2,
            message: { title: "Season 136", body: "Attendance: Cy, Dee." },
          },
        ],
      },
    },
    [],
    { text: "Fixture" },
  );
  const chat = {
    channel: "clan_chat",
    lines: ["S136 awards", "WarChamp: Ada, Bob."],
  };
  const partial = await h.manage.messageSent(tag, who, card.card_id, 1, chat);
  assert.deepEqual(partial.messages_sent[0].lines, chat.lines);
  const retry = await h.manage.messageSent(tag, who, card.card_id, 1, {
    title: "Replacement",
    body: "Replacement",
  });
  assert.deepEqual(retry, partial);
  await assert.rejects(
    h.manage.decide(tag, who, card.card_id, { status: "done" }),
    (e) => e.code === "messages_not_sent",
  );
  const inbox = {
    channel: "leader_message",
    title: "Important",
    body: "Reviewed durable update.",
  };
  const all = await h.manage.messageSent(
    tag,
    { ...who, role: "coLeader" },
    card.card_id,
    2,
    inbox,
  );
  assert.equal(all.messages_sent[0].channel, "clan_chat");
  assert.equal(all.messages_sent[1].channel, "leader_message");
  const facts = factsOfAction(card, all, { message_part: 1 });
  assert.deepEqual(
    facts.map((f) => f.detail.body),
    chat.lines,
  );
  assert.ok(
    facts.every(
      (f) =>
        f.detail.body.length <=
        ATTESTED_FACT_TYPES.clan_message.detail.body.max,
    ),
  );
  assert.equal(new Set(facts.map((f) => f.ref)).size, 2);
  const done = await h.manage.decide(tag, who, card.card_id, {
    status: "done",
  });
  assert.deepEqual(done.messages_sent, all.messages_sent);
  const history = h.store.shapeAction(done, [], who);
  assert.equal(history.channel, null);
  assert.deepEqual(history.delivery_channels, ["clan_chat", "leader_message"]);
  assert.deepEqual(
    await h.manage.messageSent(tag, who, card.card_id, 1, chat),
    done,
  );
});

test("role refusal and concurrent receipts preserve other decisions and deliveries", async () => {
  const h = setup();
  const card = await h.store.raiseAction(
    tag,
    {
      ...legacy("awards_standings"),
      evidence: {
        messages: [1, 2].map((part) => ({
          part,
          message: { title: "Season", body: "Words" },
        })),
      },
    },
    [],
    { text: "Fixture" },
  );
  const words = { channel: "clan_chat", lines: ["Reviewed."] };
  for (const person of [
    { ...who, role: "elder" },
    { ...who, role: "member" },
    { ...who, verified: false },
  ])
    await assert.rejects(
      h.manage.messageSent(tag, person, card.card_id, 1, words),
      (e) => e.status === 403 || e.status === 404,
    );
  const updates = await Promise.allSettled(
    [1, 2].map((part) =>
      h.manage.messageSent(tag, who, card.card_id, part, words),
    ),
  );
  const saved = await h.ledger.card(tag, card.card_id);
  assert.equal(
    saved.messages_sent.length,
    updates.filter((r) => r.status === "fulfilled").length,
  );
  for (const part of [1, 2])
    await h.manage.messageSent(tag, who, card.card_id, part, words);
  assert.equal(
    (await h.ledger.card(tag, card.card_id)).messages_sent.length,
    2,
  );
  const legacyCard = { ...legacy(), card_id: "old-pending" };
  await h.ledger.putCard(tag, legacyCard);
  const done = await h.manage.decide(tag, who, legacyCard.card_id, {
    status: "done",
  });
  assert.equal(done.sent.channel, "leader_message");
  assert.equal(done.sent.word_source, "suggested");
});

test("an interrupted completion reconstructs its durable exact-word audit without a second decision", async () => {
  const h = setup();
  const card = await h.store.raiseAction(tag, legacy(), [], {
    text: "Fixture",
  });
  const append = h.ledger.appendActionLog.bind(h.ledger);
  h.ledger.appendActionLog = async (clanTag, entry) => {
    if (entry.kind === "completed") throw new Error("Lost log write");
    return append(clanTag, entry);
  };
  const sent = {
    channel: "leader_message",
    title: " Reviewed ",
    body: " Exact words. ",
  };
  await assert.rejects(
    h.manage.decide(tag, who, card.card_id, { status: "done", sent }),
  );
  const saved = await h.ledger.card(tag, card.card_id);
  const logs = await h.ledger.actionLog(tag, card.card_id);
  const view = h.store.shapeAction(saved, logs, who);
  const completed = view.log.find((e) => e.kind === "completed");
  assert.equal(completed.detail.reconstructed, true);
  assert.deepEqual(completed.detail.sent, sent);
  assert.equal(completed.by.role, "leader");
  assert.deepEqual(factsOfAction(card, saved)[0].detail, sent);
  await assert.rejects(
    h.manage.decide(tag, who, card.card_id, { status: "done", sent }),
    (e) => e.code === "action_closed",
  );
});

test("concurrent repairs of a saved part write one audit receipt", async () => {
  const h = setup();
  const card = await h.store.raiseAction(
    tag,
    {
      ...legacy("awards_standings"),
      evidence: {
        messages: [
          { part: 1, message: { title: "Season", body: "Reviewed." } },
        ],
      },
    },
    [],
    { text: "Fixture" },
  );
  const receipt = {
    part: 1,
    channel: "clan_chat",
    lines: ["Reviewed."],
    sent_at: NOW.toISOString(),
    sent_by: who.player_tag,
    sent_by_name: who.name,
    sent_by_role: who.role,
    shared: true,
  };
  await h.ledger.putCard(tag, { ...card, messages_sent: [receipt] });
  await Promise.all(
    [1, 2].map(() => h.manage.messageSent(tag, who, card.card_id, 1, receipt)),
  );
  const entries = await h.ledger.actionLog(tag, card.card_id);
  assert.equal(entries.filter((e) => e.kind === "message_sent").length, 1);
});

test("stored lifecycle logs suppress reconstruction despite later write timestamps", () => {
  const h = setup();
  const card = { ...legacy(), status: "done", decided_at: NOW.toISOString() };
  const logs = ["raised", "completed"].map((kind) => ({
    kind,
    at: new Date(NOW.getTime() + 10).toISOString(),
  }));
  assert.deepEqual(h.store.shapeAction(card, logs, who).log, logs);
});
