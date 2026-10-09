import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { renderMail, htmlToText } from "@elixir-mcp/mail";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import {
  seedDeck,
  seedPlayedDeck,
  hashFor,
} from "../../../packages/tools/test/deck-rows.mjs";
import {
  buildArena,
  arenaMode,
  arenaFeaturedDeck,
} from "../src/email/build-arena.mjs";

const week = {
  from: new Date("2026-09-28T10:00:00Z"),
  to: new Date("2026-10-05T10:00:00Z"),
  label: "Sep 28–Oct 5",
  key: "2026-W40",
};
const names = {
  26000007: "Witch",
  26000021: "Hog Rider",
  26000000: "Knight",
  26000010: "Skeletons",
  28000011: "The Log",
  26000014: "Musketeer",
  27000000: "Cannon",
  28000001: "Arrows",
};
const cards = (evo = 0) =>
  Object.entries(names).map(([id, name]) => ({
    id: Number(id),
    name,
    level: 14,
    ...(Number(id) === 26000007 && evo ? { evolutionLevel: evo } : {}),
  }));
const tower = { id: 159000000, name: "Tower Princess" };
let scratch;
let sequence = 0;
before(async () => {
  scratch = await scratchDb("email_arena");
});
after(async () => scratch?.drop());

async function recipient(tag) {
  const {
    rows: [row],
  } = await scratch.db.query(
    "insert into account (email_hash,status) values ($1,'approved') returning account_id",
    [tag],
  );
  await scratch.db.query(
    "insert into player (player_tag,name) values ($1,'Example')",
    [tag],
  );
  await scratch.db.query(
    "insert into claim (account_id,player_tag,status,is_primary,relationship) values ($1,$2,'verified',true,'primary')",
    [row.account_id, tag],
  );
  await scratch.db.query(
    "insert into recording (subject_type,subject_tag,requested_by) values ('player',$1,$2)",
    [tag, row.account_id],
  );
  return {
    accountId: row.account_id,
    timezone: "UTC",
    kind: "person",
    role: "member",
  };
}
async function battle(
  tag,
  {
    mode = "ladder",
    evo = 0,
    at = "2026-09-30T12:00:00Z",
    outcome = "loss",
  } = {},
) {
  const id = `arena-${++sequence}`;
  const type = mode === "war" ? "riverRacePvP" : "PvP";
  const played = cards(evo);
  const hash = await seedDeck(scratch.db, {
    battle_time: at,
    cards: played,
    supportCards: [tower],
  });
  await scratch.db.query(
    "insert into battle (battle_id,battle_time,type,type_class,game_mode_name,event_tag) values ($1,$2,$3,'pvp',$4,$5)",
    [
      id,
      at,
      type,
      mode === "event" ? "Event" : "Ladder",
      mode === "event" ? "fixture-event" : null,
    ],
  );
  await scratch.db.query(
    `insert into battle_participant (battle_id,player_tag,side,outcome,battle_time,crowns,deck_hash,type,type_class,deck_avg_level,opp_deck_avg_level)
     values ($1,$2,0,$3,$4,0,$5,$6,'pvp',14,$7)`,
    [id, tag, outcome, at, hash, type, mode === "event" ? 11 : 13],
  );
  await seedPlayedDeck(scratch.db, {
    battle_id: id,
    player_tag: tag,
    battle_time: at,
    cards: played,
    supportCards: [tower],
  });
}
const build = (account) =>
  buildArena({ db: scratch.db, account, week, season: "Season 136" });

test("four Trophy Road losses and two Events losses with one deck keep separate records and card statistics", async () => {
  const tag = "#8QQ8QQ8Q";
  const account = await recipient(tag);
  for (let n = 0; n < 4; n++) await battle(tag);
  for (let n = 0; n < 2; n++) await battle(tag, { mode: "event" });
  const facts = await build(account);
  assert.deepEqual(
    facts.primary.totals.by_family.map(({ mode, battles, wins, losses }) => ({
      mode,
      battles,
      wins,
      losses,
    })),
    [
      { mode: "ladder", battles: 4, wins: 0, losses: 4 },
      { mode: "event", battles: 2, wins: 0, losses: 2 },
    ],
  );
  assert.equal(facts.primary.deck.family, "ladder");
  assert.equal(facts.primary.deck.battles, 4);
  assert.equal(facts.primary.deck.wins, 0);
  assert.equal(facts.primary.deck.losses, 4);
  assert.equal(facts.primary.deck.level_gap, 1);
  assert.equal(facts.primary.deck.cards.length, 8);
  const rendered = renderMail("arena_week", facts, {
    unsubscribe: "https://elixir.poapkings.com/api/email/unsubscribe?t=fixture",
    manage: "https://elixir.poapkings.com/console/account/profile/email",
    period: week.key,
  });
  const text = htmlToText(rendered.html);
  assert.match(text, /Your Trophy Road deck/);
  assert.doesNotMatch(text, /0–6|0\s*–\s*6/);
});

test("mode is chosen before deck: a busier mode with distinct decks beats another mode's larger single deck and war", async () => {
  const tag = "#8QQ8QQ8R";
  const account = await recipient(tag);
  for (let n = 0; n < 3; n++) await battle(tag, { evo: 1, outcome: "win" });
  for (let n = 0; n < 2; n++) await battle(tag);
  for (let n = 0; n < 4; n++) await battle(tag, { mode: "event" });
  for (let n = 0; n < 6; n++) await battle(tag, { mode: "war" });
  const { primary } = await build(account);
  assert.equal(primary.deck.family, "ladder");
  assert.equal(primary.deck.battles, 3);
  assert.equal(primary.deck.wins, 3);
  assert.equal(primary.deck.losses, 0);
  assert.equal(
    primary.deck.cards.find((c) => c.name === "Witch").form,
    "evolution",
  );
  assert.equal(
    primary.totals.by_family.find((m) => m.mode === "war").battles,
    6,
  );
});

test("equal mode counts use alphabetical contract order and equal deck counts use hash order", async () => {
  assert.equal(
    arenaMode({ modes: { ladder: { battles: 2 }, event: { battles: 2 } } }),
    "event",
  );
  assert.equal(
    arenaMode({ modes: { event: { battles: 2 }, ladder: { battles: 2 } } }),
    "event",
  );
  const tag = "#8QQ8QQ8Y";
  const account = await recipient(tag);
  for (const evo of [1, 0]) await battle(tag, { mode: "event", evo });
  for (let n = 0; n < 2; n++) await battle(tag);
  const { primary } = await build(account);
  assert.equal(primary.deck.family, "event");
  assert.equal(primary.deck.battles, 1);
  const expectedEvo =
    hashFor(cards(0), tower.id) < hashFor(cards(1), tower.id)
      ? "base"
      : "evolution";
  assert.equal(
    primary.deck.cards.find((c) => c.name === "Witch").form,
    expectedEvo,
  );
  assert.equal(primary.deck.level_gap, 3);
});

test("both deck reads respect the same half-open game week", async () => {
  const tag = "#8QQ8QQ8P";
  const account = await recipient(tag);
  await battle(tag, { at: week.from.toISOString() });
  await battle(tag, { at: "2026-10-05T09:59:59.999Z" });
  for (let n = 0; n < 3; n++) {
    await battle(tag, { mode: "event", at: "2026-09-28T09:59:59.999Z" });
    await battle(tag, { mode: "event", at: week.to.toISOString() });
  }
  const { primary } = await build(account);
  assert.equal(primary.totals.battles, 2);
  assert.equal(primary.deck.family, "ladder");
  assert.equal(primary.deck.battles, 2);
  assert.equal(primary.deck.losses, 2);
});

test("missing, zero, invalid and unknown mode counts cannot choose a featured mode", () => {
  for (const modes of [
    undefined,
    {},
    { war: { battles: 20 } },
    { ladder: { battles: 0 } },
    { unknown: { battles: 20 } },
    { ladder: {} },
    { ladder: { battles: "4" } },
    { event: { battles: -1 } },
    { ladder: { battles: 1.5 } },
  ]) {
    assert.equal(arenaMode({ modes }), null);
  }
  assert.equal(arenaMode(null), null);
});

test("missing or inconsistent mode evidence and missing art omit the featured card", () => {
  const full = {
    dominant_mode: "ladder",
    modes: { ladder: { battles: 4 } },
    battles: 4,
    wins: 0,
    losses: 4,
    cards: cards(),
  };
  assert.equal(arenaFeaturedDeck("ladder", full).battles, 4);
  for (const row of [
    null,
    { ...full, dominant_mode: undefined },
    { ...full, modes: undefined },
    { ...full, modes: {} },
    { ...full, modes: { ladder: {}, event: {} } },
    { ...full, dominant_mode: "event", modes: { event: {} } },
    { ...full, cards: [] },
    { ...full, cards: undefined },
  ]) {
    assert.equal(arenaFeaturedDeck("ladder", row), null);
  }
  assert.equal(arenaFeaturedDeck(null, full), null);
});

test("the week's win rate sits beside the previous four game weeks', in the featured mode, with counts", async () => {
  const tag = "#8QQ8QQ8L";
  const account = await recipient(tag);
  // This week: 12 Trophy Road battles, 9 won; and war, which never
  // pools into the line.
  for (let n = 0; n < 12; n++)
    await battle(tag, {
      at: `2026-09-30T12:${String(n).padStart(2, "0")}:00Z`,
      outcome: n < 9 ? "win" : "loss",
    });
  for (let n = 0; n < 6; n++)
    await battle(tag, { mode: "war", at: "2026-10-01T12:00:00Z" });
  // The previous four game weeks (Aug 31 10:00Z to Sep 28 10:00Z): 20,
  // 10 won, one at each edge. One just before the four weeks opened and
  // one in this week's last instant before it closes never count there.
  await battle(tag, { at: "2026-08-31T10:00:00Z", outcome: "win" });
  await battle(tag, { at: "2026-09-28T09:59:59.999Z" });
  for (let n = 0; n < 18; n++)
    await battle(tag, {
      at: `2026-09-1${n % 9}T12:${String(n).padStart(2, "0")}:00Z`,
      outcome: n < 9 ? "win" : "loss",
    });
  await battle(tag, { at: "2026-08-31T09:59:59.999Z", outcome: "win" });
  const facts = await build(account);
  const { form } = facts.primary;
  assert.equal(form.mode, "ladder");
  assert.equal(form.week.decided_battles, 12);
  assert.equal(form.week.win_rate, 0.75);
  assert.equal(form.previous.decided_battles, 20);
  assert.equal(form.previous.win_rate, 0.5);
  const text = htmlToText(
    renderMail("arena_week", facts, {
      unsubscribe:
        "https://elixir.poapkings.com/api/email/unsubscribe?t=fixture",
      manage: "https://elixir.poapkings.com/console/account/profile/email",
      period: week.key,
    }).html,
  );
  assert.match(
    text,
    /Trophy Road win rate 75% this week \(12 battles\), up from 50% over the previous four weeks \(20 battles\)\./,
  );
});

test("a week under the minimum has no form, and the mail no line", async () => {
  const tag = "#8QQ8QQ8V";
  const account = await recipient(tag);
  for (let n = 0; n < 9; n++) await battle(tag, { outcome: "win" });
  for (let n = 0; n < 30; n++)
    await battle(tag, { at: "2026-09-15T12:00:00Z" });
  const facts = await build(account);
  assert.equal(facts.primary.form, null);
  const text = htmlToText(
    renderMail("arena_week", facts, {
      unsubscribe:
        "https://elixir.poapkings.com/api/email/unsubscribe?t=fixture",
      manage: "https://elixir.poapkings.com/console/account/profile/email",
      period: week.key,
    }).html,
  );
  assert.doesNotMatch(text, /previous four weeks/);
});
