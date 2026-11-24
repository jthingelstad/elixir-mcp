import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "@elixir-mcp/clan/handler.mjs";
import { createMemoryLedger } from "@elixir-mcp/clan-state";
import { createManageService } from "@elixir-mcp/clan/manage/service.mjs";
import { buildMemberHistory } from "@elixir-mcp/clan/manage/member-history.mjs";
import {
  createTestAccount,
  fakeRecord,
  player,
  req,
  signIn,
  cookieHeader,
  rosterBody,
  ledgerWithPolicy,
} from "./fakes.mjs";
import {
  member,
  participation,
  NOW,
  EXAMPLE_POLICY,
} from "@elixir-mcp/clan-engine/fixtures";

// Invented tags (docs/invented-tags.json).
const CLAN = "#0QC8RCGY";
const LEADER = "#098R2R0PUL";
const SUBJECT = "#0PYLQ2";
const FORMER = "#000QY0L0C";
const DAY = 86400_000;
const iso = (daysAgo) => new Date(NOW.getTime() - daysAgo * DAY).toISOString();

const others = Array.from({ length: 10 }, (_, i) =>
  member(`#0C${"PYLQGRJCUV"[i]}8`),
);

function clanPart({ subject = {}, extra = {} } = {}) {
  const ada = member(LEADER, { name: "Ada", role: "leader" });
  const sub = {
    ...member(SUBJECT, {
      name: "Bea",
      role: "elder",
      tenureKnown: false,
      war: [16, 12, null, 16, 8, 4],
    }),
    // Already a member at the first roster read, so the join is that read.
    joined_observed_at: "2026-05-01T00:00:00.000Z",
    first_joined_at: "2026-05-01T00:00:00.000Z",
    role_changes: [
      {
        role_before: "member",
        role_after: "elder",
        window_start: "2026-07-18T00:00:00.000Z",
        observed_at: iso(20),
      },
    ],
    ...subject,
  };
  return participation([ada, sub, ...others], {
    clan_tag: CLAN,
    name: "Example Clan",
    former_members: [
      {
        player_tag: FORMER,
        name: "Cy",
        role_at_departure: "member",
        joined_observed_at: iso(40),
        left_observed_at: iso(6),
        battles: [],
        war_decks: [16, 16, 0, 0, 0, null],
      },
    ],
    ...extra,
  });
}

function setup({ part = clanPart(), roster = null, players } = {}) {
  const ledger = ledgerWithPolicy(createMemoryLedger(), CLAN, EXAMPLE_POLICY);
  const record = fakeRecord({
    players: players ?? [player()],
    roster: roster ?? { ...rosterBody([]), member_count: 12 },
  });
  const inner = record.read.bind(record);
  const state = { part, fail: false };
  record.read = async (name, args) => {
    if (name === "clans_participation") {
      record.calls.push([name, args]);
      return state.fail
        ? { ok: false, code: "unavailable", error: "timeout" }
        : { ok: true, body: state.part };
    }
    return inner(name, args);
  };
  const now = () => NOW.getTime();
  const manage = createManageService({
    ledger,
    record,
    now,
    log: { warn() {}, error() {} },
  });
  const { identity, store } = createTestAccount();
  const handler = createHandler({
    record,
    identity,
    store,
    manage,
    appUrl: "https://elixir.test/clan",
    elixirUrl: "https://elixir.test",
    now,
    log: { warn() {}, error() {} },
  });
  return { ledger, record, manage, handler, state };
}

async function get(h, path) {
  const { sessionCookie } = await signIn(h);
  const r = await h.handler(
    req("GET", path, { cookies: cookieHeader(sessionCookie) }),
  );
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

async function seedLedger(ledger) {
  await ledger.putCard(CLAN, {
    card_id: "promo-1",
    number: 7,
    clan_tag: CLAN,
    player_tag: SUBJECT,
    player_name: "Bea",
    type: "promotion",
    status: "done",
    raised_at: iso(22),
    decided_at: iso(21),
    decided_by: LEADER,
    decided_by_name: "Ada",
    evidence: { rationale: { headline: "Ready after 3 weekly reviews." } },
  });
  await ledger.putCard(CLAN, {
    card_id: "demo-1",
    number: 9,
    clan_tag: CLAN,
    player_tag: SUBJECT,
    player_name: "Bea",
    type: "demotion",
    status: "declined",
    raised_at: iso(5),
    decided_at: iso(4),
    decided_by: LEADER,
    decided_by_name: "Ada",
    decline_reason: "knows_the_member",
    decision_note: "Back from a trip.",
    reopenings: [
      {
        request_id: "r1",
        at: iso(4.5),
        by: { tag: LEADER, name: "Ada", role: "leader" },
        decline: {
          decided_at: iso(4.8),
          decided_by: LEADER,
          decided_by_name: "Ada",
          decline_reason: "not_now",
          decision_note: null,
        },
      },
    ],
  });
  // Someone else's action never shows on this page.
  await ledger.putCard(CLAN, {
    card_id: "other-1",
    clan_tag: CLAN,
    player_tag: FORMER,
    type: "removal",
    status: "proposed",
    raised_at: iso(2),
  });
  await ledger.putHold(CLAN, {
    player_tag: SUBJECT,
    kind: "leader",
    until: "2026-12-12",
    note: "Exams",
    by: LEADER,
    by_name: "Ada",
    set_at: iso(3),
  });
  await ledger.putNote(CLAN, {
    note_id: "n1",
    player_tag: SUBJECT,
    tier: "leader",
    author_tag: LEADER,
    author_name: "Ada",
    text: "Great donor.",
    created_at: iso(1),
  });
  await ledger.putNote(CLAN, {
    note_id: "n2",
    player_tag: SUBJECT,
    tier: "elder",
    author_tag: LEADER,
    author_name: "Ada",
    text: "Asked about Elder.",
    created_at: iso(30),
  });
  await ledger.putGrant(CLAN, {
    season_id: 135,
    award_id: "top_donor",
    kind: "season_points_podium",
    name: "Top Donor",
    rank: 1,
    player_tag: SUBJECT,
    player_name: "Bea",
    granted_at: iso(5.4),
  });
}

test("member history: a leader reads one member's story, newest first, from the record and the ledger", async () => {
  const h = setup();
  await seedLedger(h.ledger);
  const r = await get(h, `/api/clans/${CLAN.slice(1)}/members/0PYLQ2/history`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = r.body;
  assert.equal(d.clan_name, "Example Clan");
  assert.equal(d.member.name, "Bea");
  assert.equal(d.member.role, "elder");
  assert.equal(d.member.in_clan, true);
  assert.equal(d.member.tenure_known, false);
  assert.equal(d.known_since, "2026-05-01T00:00:00.000Z");
  const ats = d.entries.map((e) => Date.parse(e.at));
  assert.deepEqual(
    ats,
    [...ats].sort((a, b) => b - a),
    "newest first",
  );
  const kinds = d.entries.map((e) => e.kind);
  // The earliest day is the first roster read, and nothing is before it.
  assert.equal(kinds.at(-1), "known_since");
  assert.ok(!kinds.includes("joined"));
  // The promotion's Done and the role change it asked for are one entry.
  const role = d.entries.find((e) => e.kind === "role_changed");
  assert.deepEqual(role.groups, ["role", "actions"]);
  assert.equal(role.action.number, 7);
  assert.equal(role.action.by.name, "Ada");
  assert.equal(role.action.headline, "Ready after 3 weekly reviews.");
  assert.ok(!d.entries.some((e) => e.card_id === "promo-1"));
  // The demotion: declined, reopened, declined again, each with its reason.
  const demotion = d.entries.filter((e) => e.card_id === "demo-1");
  assert.deepEqual(
    demotion.map((e) => [e.status, e.reason]),
    [
      ["declined", "knows_the_member"],
      ["reopened", null],
      ["declined", "not_now"],
    ],
  );
  assert.equal(demotion[0].note, "Back from a trip.");
  // Nobody else's action.
  assert.ok(!d.entries.some((e) => e.card_id === "other-1"));
  // The exception in force, who set it and until when.
  const x = d.entries.find((e) => e.kind === "exception");
  assert.equal(x.exception, "leader");
  assert.equal(x.until, "2026-12-12");
  assert.equal(x.by.name, "Ada");
  // River Race weeks: the five read weeks with decks, never the null one.
  const war = d.entries.filter((e) => e.kind === "war_week");
  assert.deepEqual(
    war.map((w) => [w.season_id, w.week, w.decks, w.in_progress]),
    [
      [136, 1, 4, true],
      [135, 5, 8, false],
      [135, 4, 16, false],
      [135, 2, 12, false],
      [135, 1, 16, false],
    ],
  );
  assert.equal(war[1].colosseum, true);
  assert.equal(war[1].decks_asked, 16);
  // The award and both notes' tiers: this read is the leaders'.
  assert.equal(d.entries.find((e) => e.kind === "award").name, "Top Donor");
  assert.deepEqual(
    d.entries.filter((e) => e.kind === "note").map((e) => e.tier),
    ["leader", "elder"],
  );
  assert.ok(d.gaps.includes("ended_exceptions"));
});

test("member history: reading it writes nothing to the ledger", async () => {
  const h = setup();
  await seedLedger(h.ledger);
  const before = JSON.stringify([...h.ledger.items.entries()]);
  const r = await get(h, `/api/clans/${CLAN.slice(1)}/members/0PYLQ2/history`);
  assert.equal(r.status, 200);
  assert.equal(JSON.stringify([...h.ledger.items.entries()]), before);
});

test("member history: a member and an elder are refused it, with nothing of the clan's", async () => {
  for (const role of ["member", "elder"]) {
    const h = setup({ players: [player({ clan_role: role })] });
    await seedLedger(h.ledger);
    const r = await get(
      h,
      `/api/clans/${CLAN.slice(1)}/members/0PYLQ2/history`,
    );
    assert.equal(r.status, 403, role);
    assert.equal(r.body.error, "leaders_only");
    assert.ok(!JSON.stringify(r.body).includes("Exams"));
  }
});

test("member history: an unverified leader is refused it", async () => {
  const h = setup({ players: [player({ claim_status: "claimed" })] });
  const r = await get(h, `/api/clans/${CLAN.slice(1)}/members/0PYLQ2/history`);
  assert.equal(r.status, 403);
});

test("member history: a tag nothing knows is a 404; a failed record read is a 502", async () => {
  const h = setup();
  const r = await get(h, `/api/clans/${CLAN.slice(1)}/members/0LUVR2/history`);
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "not_a_member");
  h.state.fail = true;
  const failed = await get(
    h,
    `/api/clans/${CLAN.slice(1)}/members/0PYLQ2/history`,
  );
  assert.equal(failed.status, 502);
});

test("member history: a former member's leave, and the roster's older events folded in once", async () => {
  const roster = {
    ...rosterBody([]),
    member_count: 12,
    recent_events: [
      // The same leave participation holds: told once.
      {
        type: "member_left",
        at: iso(6),
        detail: {
          player_tag: FORMER,
          name: "Cy",
          role_at_departure: "member",
        },
      },
      // An earlier stint's leave and an older role change, beyond the window.
      {
        type: "member_left",
        at: iso(90),
        detail: { player_tag: FORMER, name: "Cy", role_at_departure: "elder" },
      },
      {
        type: "role_changed",
        at: iso(100),
        detail: {
          player_tag: FORMER,
          role_before: "member",
          role_after: "elder",
        },
      },
      // Someone else's.
      {
        type: "member_joined",
        at: iso(2),
        detail: { player_tag: SUBJECT, name: "Bea" },
      },
    ],
  };
  const h = setup({ roster });
  const r = await get(
    h,
    `/api/clans/${CLAN.slice(1)}/members/000QY0L0C/history`,
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.member.in_clan, false);
  assert.equal(r.body.member.role, "member");
  assert.equal(r.body.member.left_observed_at, iso(6));
  const kinds = r.body.entries.map((e) => [e.kind, e.at]);
  assert.deepEqual(
    kinds.filter(([k]) => k !== "war_week"),
    [
      ["left", iso(6)],
      ["joined", iso(40)],
      ["left", iso(90)],
      ["role_changed", iso(100)],
    ],
  );
  // A join after an earlier leave is a rejoin.
  assert.equal(r.body.entries.find((e) => e.kind === "joined").again, false);
});

test("buildMemberHistory: a join after the first roster read is told; a later stint is a rejoin", () => {
  const part = participation(
    [
      {
        ...member(SUBJECT, { tenureDays: 30 }),
        first_joined_at: iso(60),
        joined_observed_at: iso(30),
      },
    ],
    { first_roster_observed_at: iso(100) },
  );
  const entries = buildMemberHistory({
    playerTag: SUBJECT,
    part,
    roster: null,
    now: NOW.getTime(),
  });
  const joins = entries.filter((e) => e.kind === "joined");
  assert.deepEqual(
    joins.map((e) => [e.at, e.again]),
    [
      [iso(30), true],
      [iso(60), false],
    ],
  );
  assert.ok(!entries.some((e) => e.kind === "known_since"));
});

test("buildMemberHistory: an exception whose end has passed says it ended", () => {
  const entries = buildMemberHistory({
    playerTag: SUBJECT,
    part: null,
    roster: null,
    exceptions: [
      {
        kind: "away",
        until: iso(1),
        set_at: iso(8),
        by: SUBJECT,
        by_name: "Bea",
      },
    ],
    now: NOW.getTime(),
  });
  assert.deepEqual(
    entries.map((e) => e.kind),
    ["exception_ended", "exception"],
  );
});
