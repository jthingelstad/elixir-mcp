import test from "node:test";
import assert from "node:assert/strict";
import { createMemberActivity } from "../src/member-activity.mjs";
import {
  harness,
  fakeMcp,
  player,
  req,
  signIn,
  cookieHeader,
} from "./fakes.mjs";

const clan = "#2PQRJ8LV",
  tag = "#9QY";
const now = () => Date.parse("2026-10-04T05:00:00Z");
const member = {
  player_tag: tag,
  name: "Test member",
  role: "member",
  joined_observed_at: "2026-09-25T12:00:00Z",
};
function reader({
  rosterMember = true,
  coverage = true,
  joined = member.joined_observed_at,
} = {}) {
  const calls = [];
  const battle = (id, clan_tag, battle_time) => ({
    battle_id: id,
    battle_time,
    me: { clan_tag, outcome: "win", crowns: 1, private: "secret" },
    opponents: [{ name: "Opponent private extra", crowns: 0 }],
    url: "https://elixir.poapkings.com/battle/012345abcdef",
  });
  const mcp = {
    callTool: async (_token, name, args) => {
      calls.push([name, args]);
      const bodies = {
        clans_roster: { clan_tag: clan, members: rosterMember ? [member] : [] },
        clans_participation: {
          clan_tag: clan,
          weeks: [
            {
              iso_week: "2026-W38",
              from: "2026-09-14T00:00:00Z",
              to: "2026-09-21T00:00:00Z",
            },
            {
              iso_week: "2026-W40",
              from: "2026-09-21T00:00:00Z",
              to: "2026-10-05T00:00:00Z",
            },
          ],
          members: [
            {
              ...member,
              joined_observed_at: joined,
              battles: [999],
              donations: [999],
              war_decks: [999, 999, 12],
              war_points: [999, 999, 2400],
            },
          ],
          meta: { as_of: "2026-10-04T04:00:00Z" },
          war_weeks: [0, 2, 3].map((section_index) => ({
            season_id: 136,
            section_index,
          })),
        },
        battles_query: {
          battles: [
            battle("allowed", clan, "2026-09-25T13:00:00Z"),
            battle("outside", "#PYLQ2", "2026-10-01T12:00:00Z"),
            battle("old-stint", clan, "2026-09-24T12:00:00Z"),
          ],
          next_cursor: "next",
          private: "secret",
        },
        elixir_coverage: {
          battles: { recorded_appearances: 999 },
          observation_intervals: [
            {
              observed_from: "2026-09-20T00:00:00Z",
              observed_to: "2026-09-28T00:00:00Z",
              expected_battles: 999,
            },
            {
              observed_from: "2026-10-01T00:00:00Z",
              observed_to: "2026-10-02T00:00:00Z",
              expected_battles: 5,
              captured_battles: 0,
              is_complete: false,
            },
          ],
          private: "secret",
        },
      };
      return name === "elixir_coverage" && !coverage
        ? { ok: false }
        : { ok: true, body: bodies[name] };
    },
  };
  return {
    calls,
    read: createMemberActivity({
      mcp,
      now,
      warBounds: async () => [
        {
          season_id: 136,
          section_index: 0,
          from: "2026-09-07T10:00:00Z",
          to: "2026-09-14T10:00:00Z",
        },
        {
          season_id: 136,
          section_index: 2,
          from: "2026-09-21T10:00:00Z",
          to: "2026-09-28T10:00:00Z",
        },
        {
          season_id: 136,
          section_index: 3,
          from: "2026-09-28T10:00:00Z",
          to: "2026-10-05T10:00:00Z",
        },
      ],
      weeklyCounts: async () => [
        {
          iso_week: "2026-W40",
          battles: 1,
          ranked_battles: 0,
          donations: null,
        },
      ],
    }),
  };
}

test("member evidence clips a returner's stint and projects only this clan's battle facts", async () => {
  const h = reader();
  const r = await h.read(clan, "token", tag);
  assert.deepEqual(
    r.battles.map((b) => b.battle_id),
    ["allowed"],
  );
  assert.equal(
    r.window.from,
    new Date(member.joined_observed_at).toISOString(),
  );
  assert.equal(r.weeks.length, 1, "wholly earlier ISO weeks are omitted");
  assert.equal(r.weeks[0].battles, 1);
  assert.equal(r.weeks[0].donations, null);
  assert.equal(r.weeks[0].from, r.window.from);
  assert.equal(r.weeks[0].to, r.window.to);
  assert.equal(r.weeks[0].partial, true);
  assert.deepEqual(
    r.war_weeks.map((w) => w.section_index),
    [2, 3],
  );
  assert.equal(r.war_weeks[0].decks, null);
  assert.equal(r.war_weeks[0].attribution_unknown, true);
  assert.equal(r.war_weeks[1].decks, 12);
  assert.equal(r.coverage.intervals.length, 1);
  assert.equal(r.coverage.intervals[0].complete, false);
  assert.doesNotMatch(
    JSON.stringify(r),
    /secret|Opponent private|999|old-stint|outside/,
  );
  assert.equal(
    h.calls.some(([name, args]) => name === "live_fetch" || args.live),
    false,
  );
});
test("a former or non-member refuses before any player history read", async () => {
  const h = reader({ rosterMember: false });
  await assert.rejects(h.read(clan, "token", tag), (e) => e.status === 404);
  assert.deepEqual(
    h.calls.map((c) => c[0]),
    ["clans_roster"],
  );
});
test("coverage failure stays unknown and pagination fixes its read window", async () => {
  const h = reader({ coverage: false });
  const r = await h.read(clan, "token", tag, {
    cursor: "next",
    to: "2026-10-03T00:00:00Z",
  });
  assert.equal(r.coverage.available, false);
  assert.deepEqual(r.coverage.intervals, []);
  assert.equal(h.calls.find((c) => c[0] === "battles_query")[1].cursor, "next");
  await assert.rejects(
    h.read(clan, "token", tag, { to: "2027-01-01T00:00:00Z" }),
    (e) => e.code === "invalid_window",
  );
});
test("member activity HTTP route preserves sign-in and own-clan admission", async () => {
  let reads = 0;
  const h = harness({
    mcp: fakeMcp({ players: [player()] }),
    memberActivity: async () => {
      reads++;
      return { safe: true };
    },
  });
  // The test harness deliberately wires only the provided feature under test.
  const { sessionCookie } = await signIn(h);
  const cookies = cookieHeader(sessionCookie);
  assert.equal(
    (
      await h.handler(
        req("GET", "/api/clans/PYLQ2/members/9QY/activity", { cookies }),
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (await h.handler(req("GET", "/api/clans/2PQRJ8LV/members/9QY/activity")))
      .statusCode,
    401,
  );
  assert.equal(reads, 0);
  assert.equal(
    (
      await h.handler(
        req("GET", "/api/clans/2PQRJ8LV/members/9QY/activity", { cookies }),
      )
    ).statusCode,
    200,
  );
  assert.equal(reads, 1);
});

test("a same-day rejoin withholds cumulative counters and omits earlier weeks", async () => {
  const h = reader({ joined: "2026-10-01T15:00:00Z" });
  const r = await h.read(clan, "token", tag);
  assert.equal(r.weeks[0].from, "2026-10-01T15:00:00.000Z");
  assert.equal(r.weeks[0].donations, null);
  assert.equal(r.war_weeks.length, 1);
  assert.equal(r.war_weeks[0].decks, null);
  assert.equal(r.war_weeks[0].points, null);
  const older = await reader().read(clan, "token", tag, {
    to: "2026-10-02T00:00:00Z",
  });
  assert.equal(
    older.war_weeks[1].decks,
    null,
    "a later unversioned counter cannot enter a fixed earlier page window",
  );
});
