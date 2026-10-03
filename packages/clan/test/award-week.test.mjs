import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryLedger } from "@elixir-mcp/clan-state";
import { canAct, LEADER_MESSAGE } from "@elixir-mcp/clan-engine";
import {
  member,
  participation,
  NOW,
  EXAMPLE_AWARDS,
  EXAMPLE_POLICY,
} from "@elixir-mcp/clan-engine/fixtures";
import { createAwardsService } from "../src/manage/awards.mjs";
import { weeklyAwardUpdates } from "../src/manage/award-week.mjs";
import { factsOfAction } from "../src/manage/sharing.mjs";
import { seedVersion } from "./fakes.mjs";

const tag = "#TEST";
function record() {
  const p = participation(
    Array.from({ length: 10 }, (_, i) =>
      member(`#Q${i}`, { name: `Member ${i}`, donations: [1, 2, 3, 4, 5, 6] }),
    ),
  );
  p.war_weeks[5].finished_observed_at = new Date(
    NOW.getTime() - 60000,
  ).toISOString();
  p.war_weeks.push({
    ...p.war_weeks[5],
    section_index: 1,
    finished_observed_at: null,
    started_observed_at: NOW.toISOString(),
  });
  p.members.forEach((m) => {
    m.war_points.push(999999);
    m.war_decks.push(0);
  });
  return p;
}
const updates = (p, extra = {}) =>
  weeklyAwardUpdates({
    participation: p,
    config: EXAMPLE_AWARDS,
    now: NOW,
    ...extra,
  });

test("weekly standings wait for observed closure, exclude later points and keep game-sized provisional copy", () => {
  const p = record();
  const weeks = updates(p);
  assert.deepEqual(
    weeks.map((w) => [w.season_id, w.section_index]),
    [[136, 0]],
  );
  assert.equal(weeks[0].as_of, p.meta.as_of);
  for (const part of weeks[0].parts) {
    assert.ok(part.message.title.length <= LEADER_MESSAGE.title);
    assert.ok(part.message.body.length <= LEADER_MESSAGE.body);
    assert.match(part.message.body, /^Provisional S136 W1\./);
    assert.doesNotMatch(part.message.body, /999999/);
  }
  assert.match(
    weeks[0].parts.map((p) => p.message.body).join(" "),
    /1600 points/,
  );
  p.war_weeks[5].finished_observed_at = null;
  assert.deepEqual(updates(p), []); // wall clock and early finish are insufficient
  p.war_weeks[5].finished_observed_at = new Date(
    NOW.getTime() + 1,
  ).toISOString();
  assert.deepEqual(updates(p), []);
});

test("weekly missing counters withhold places and missing sections withhold computed standings", () => {
  const p = record();
  p.members[0].war_points[5] = null;
  const text = updates(p)[0]
    .parts.map((p) => p.message.body)
    .join(" ");
  assert.match(text, /evidence incomplete; places withheld/);
  assert.doesNotMatch(text, /Season champion: 1\./);
  p.war_weeks[5].section_index = 2;
  assert.equal(updates(p)[0].complete, false);
  assert.ok(
    updates(p)[0].parts.some((p) => /evidence incomplete/.test(p.message.body)),
  );
});

test("weekly frozen plans recover partial raises, preserve sent/skipped copy without historical backfill", async () => {
  const p = record();
  const ledger = createMemoryLedger();
  seedVersion(ledger, "policy", tag, {
    ...EXAMPLE_POLICY,
    announce_awards_enabled: true,
  });
  seedVersion(ledger, "awards", tag, EXAMPLE_AWARDS);
  const service = createAwardsService({
    ledger,
    now: () => NOW.getTime(),
    participationFor: async () => structuredClone(p),
  });
  const put = ledger.putCard.bind(ledger);
  let interrupted = false;
  ledger.putCard = async (clan, card) => {
    if (card.type === "awards_standings" && !interrupted) {
      interrupted = true;
      throw new Error("interrupted");
    }
    return put(clan, card);
  };
  await assert.rejects(service.evaluateOnSchedule(tag, "test"), /interrupted/);
  const frozen = await ledger.weeklyAwardPlans(tag);
  p.members[0].war_points[5] = 123456;
  p.meta.as_of = "2026-09-12T20:01:00Z";
  await ledger.saveAwards(tag, {
    values: { schema: 1, awards: [] },
    by: "#Q0",
  });
  await service.evaluateClan({ clanTag: tag, token: "test" });
  const cards = (await ledger.cards(tag))
    .filter((c) => c.type === "awards_standings")
    .sort((a, b) => a.evidence.part - b.evidence.part);
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].evidence.messages, frozen[0].parts);
  assert.ok(cards.every((c) => c.evidence.as_of === frozen[0].as_of));
  for (const [i, c] of cards.entries())
    await ledger.putCard(tag, { ...c, status: i ? "declined" : "done" });
  await service.evaluateOnSchedule(tag, "test");
  assert.equal(
    (await ledger.cards(tag)).filter((c) => c.type === "awards_standings")
      .length,
    cards.length,
  );
  await ledger.saveAwards(tag, { values: EXAMPLE_AWARDS, by: "#Q0" });
  p.war_weeks[6].finished_observed_at = NOW.toISOString();
  p.war_weeks[6].is_colosseum = true;
  p.war_weeks.push({
    ...p.war_weeks[6],
    season_id: 137,
    section_index: 0,
    finished_observed_at: null,
    is_colosseum: false,
  });
  p.members.forEach((m) => {
    m.war_points.push(0);
    m.war_decks.push(0);
  });
  await service.evaluateOnSchedule(tag, "test");
  assert.deepEqual(
    (await ledger.weeklyAwardPlans(tag)).map((p) => [
      p.season_id,
      p.section_index,
    ]),
    [[136, 0]],
  );
  assert.ok(
    (await ledger.cards(tag)).some(
      (c) => c.type === "awards_announcement" && c.evidence.season_id === 136,
    ),
  );
});

test("weekly Actions belong to leaders and completed copy attests a message, never an award grant", () => {
  const card = {
    card_id: "weekly",
    type: "awards_standings",
    evidence: {
      season_id: 136,
      message: { title: "S136 W1", body: "Provisional standings." },
    },
  };
  assert.equal(canAct(card, { role: "leader" }), true);
  assert.equal(canAct(card, { role: "coLeader" }), true);
  assert.equal(canAct(card, { role: "elder" }), false);
  const facts = factsOfAction(
    card,
    { status: "done", decided_at: NOW.toISOString() },
    {},
  );
  assert.deepEqual(
    facts.map((f) => f.type),
    ["clan_message"],
  );
});

test("weekly sanitized labels stay bounded and a missing earlier closure holds places", () => {
  const p = record();
  const config = structuredClone(EXAMPLE_AWARDS);
  config.awards.forEach((a) => {
    a.name = "&".repeat(40);
  });
  const parts = weeklyAwardUpdates({ participation: p, config, now: NOW })[0]
    .parts;
  assert.ok(parts.every((p) => p.message.body.length <= LEADER_MESSAGE.body));
  p.war_weeks[6].finished_observed_at = NOW.toISOString();
  p.war_weeks[5].finished_observed_at = null;
  const week = updates(p)[0];
  assert.equal(week.complete, false);
  assert.match(week.parts[0].message.body, /places withheld/);
});
