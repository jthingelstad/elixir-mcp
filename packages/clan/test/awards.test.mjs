/**
 * Awards over the real handler: grants written once when a season has
 * closed, the live races, a leaders' pick by hand, the versioned
 * document, and the trophy case every member sees. Nothing runs before
 * the clan has a policy, and a clan starts with no awards.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestAccount } from "./fakes.mjs";
import { createHandler } from "@elixir-mcp/clan/handler.mjs";
import { createMemoryLedger } from "@elixir-mcp/clan-state";
import {
  createManageService,
  fetchParticipation,
} from "@elixir-mcp/clan/manage/service.mjs";
import { createAwardsService } from "@elixir-mcp/clan/manage/awards.mjs";
import { createScout } from "@elixir-mcp/clan/manage/scout.mjs";
import { factsOfAction } from "@elixir-mcp/clan/manage/sharing.mjs";
import { actionsWaitingMail } from "@elixir-mcp/clan-engine";
import {
  fakeMcp,
  player,
  req,
  signIn,
  cookieHeader,
  seedVersion,
} from "./fakes.mjs";
import {
  member,
  participation,
  NOW,
  EXAMPLE_POLICY,
  EXAMPLE_AWARDS,
} from "@elixir-mcp/clan-engine/fixtures";

function harness({
  players = [player()],
  part,
  policy = EXAMPLE_POLICY,
  awards = EXAMPLE_AWARDS,
} = {}) {
  const clock = { t: NOW.getTime() };
  const now = () => clock.t;
  const mcp = fakeMcp({ players });
  const inner = mcp.callTool.bind(mcp);
  mcp.callTool = async (token, name, args) => {
    mcp.calls.push([name, token, args]);
    if (name === "clans_participation") return { ok: true, body: part };
    return inner(token, name, args);
  };
  const ledger = createMemoryLedger();
  if (policy) seedVersion(ledger, "policy", "#2PQRJ8LV", policy);
  if (awards) seedVersion(ledger, "awards", "#2PQRJ8LV", awards);
  const handler = createHandler({
    mcp,
    ...createTestAccount(),
    manage: createManageService({ ledger, mcp, now }),
    awards: createAwardsService({
      ledger,
      now,
      participationFor: (token, tag) => fetchParticipation(mcp, token, tag),
    }),
    scout: createScout({ mcp, now }),
    appUrl: "https://elixir.test/clan",
    elixirUrl: "https://elixir.test",
    now,
    log: { warn() {}, error() {} },
  });
  return { clock, mcp, ledger, handler };
}

const api = async (h, cookies, method, path, body) => {
  const [rawPath, qs] = path.split("?");
  const query = qs ? Object.fromEntries(new URLSearchParams(qs)) : undefined;
  const r = await h.handler(
    req(method, rawPath, {
      cookies,
      query,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return {
    status: r.statusCode,
    headers: r.headers,
    body: r.body ? JSON.parse(r.body) : null,
  };
};
const signedIn = async (h) => cookieHeader((await signIn(h)).sessionCookie);

const king = member("#20QQL8CCRU", {
  name: "Ada",
  role: "leader",
  war: [16, 16, 16, 16, 16, 8],
});
const levy = member("#UQ8LP2R9C", {
  name: "Ben",
  role: "coLeader",
  war: [16, 16, 16, 16, 12, 8],
  donations: [500, 500, 500, 500, 500, 100],
});
const amy = member("#8QCV", {
  name: "Amy",
  role: "member",
  tenureDays: 25,
  war: [0, 0, 0, 0, 14, 8],
});
// Members who played no war and donated nothing: the clan is big enough
// for awards (10), and they never reach a podium.
const quiet = Array.from({ length: 9 }, (_, i) =>
  member(`#Q${i}`, {
    war: [0, 0, 0, 0, 0, 0],
    donations: [0, 0, 0, 0, 0, 0],
  }),
);
const partClan = () =>
  participation([king, levy, amy, ...quiet], {
    clan_tag: "#2PQRJ8LV",
    name: "Example Clan",
  });
const BASE = "/api/clans/2PQRJ8LV/awards";

test("awards: the first look after a season closes writes the grants once; the open season is live", async () => {
  const h = harness({ part: partClan() });
  const cookies = await signedIn(h);
  const r = await api(h, cookies, "GET", `${BASE}/manage`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.can_edit, true);
  assert.deepEqual(r.body.can_grant, ["clan_honour"]);
  assert.equal(r.body.config_version, 1);
  const s135 = r.body.seasons.find((s) => s.season_id === 135);
  assert.equal(s135.closed, true);
  const champ = s135.awards.find((a) => a.award_id === "season_champ");
  assert.equal(champ.state, "closed");
  assert.deepEqual(
    champ.rows.map((x) => [x.player_tag, x.official_rank]),
    [
      ["#20QQL8CCRU", 1],
      ["#UQ8LP2R9C", 2],
      ["#8QCV", 3],
    ],
  );
  const grants = r.body.grants;
  assert.deepEqual(
    grants
      .filter((g) => g.award_id === "season_champ")
      .map((g) => [g.rank, g.player_name, g.metric_value, g.manual]),
    [
      [1, "Ada", 16000, false],
      [2, "Ben", 15200, false],
      [3, "Amy", 2800, false],
    ],
  );
  assert.deepEqual(
    grants
      .filter((g) => g.award_id === "ever_present")
      .map((g) => g.player_tag),
    ["#20QQL8CCRU"],
  );
  assert.deepEqual(
    grants.filter((g) => g.award_id === "top_rookie").map((g) => g.player_tag),
    ["#8QCV"],
    "Amy joined in the last week of 135: her first season",
  );
  const s136 = r.body.seasons.find((s) => s.season_id === 136);
  assert.equal(
    s136.awards.find((a) => a.award_id === "season_champ").state,
    "live",
  );
  assert.ok(!grants.some((g) => g.season_id === 136));

  // A second look is cached and grants nothing more.
  const again = await api(h, cookies, "GET", `${BASE}/manage`);
  assert.equal(again.body.cached, true);
  assert.equal(again.body.grants.length, grants.length);
  const forced = await api(h, cookies, "GET", `${BASE}/manage?refresh=1`);
  assert.equal(forced.body.cached, false);
  assert.equal(forced.body.grants.length, grants.length, "idempotent");
});

test("awards: a leaders' pick is granted by hand with a note, shows in the season, and can be taken back; computed grants cannot", async () => {
  const h = harness({ part: partClan() });
  const cookies = await signedIn(h);
  await api(h, cookies, "GET", `${BASE}/manage`);
  const g = await api(h, cookies, "POST", `${BASE}/grants`, {
    award_id: "clan_honour",
    player_tag: "UQ8LP2R9C",
    player_name: "Ben",
    season_id: 135,
    note: "Second on points; Ada held it last season.",
  });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.equal(g.body.player_tag, "#UQ8LP2R9C");
  assert.equal(g.body.manual, true);
  assert.equal(g.body.granted_by, "#20QQL8CCRU");
  assert.equal(g.body.granted_by_name, "Ada");
  const view = await api(h, cookies, "GET", `${BASE}/manage`);
  const fp = view.body.seasons
    .find((s) => s.season_id === 135)
    .awards.find((a) => a.award_id === "clan_honour");
  assert.equal(fp.state, "manual");
  assert.equal(fp.rows[0].name, "Ben");
  assert.match(fp.rows[0].note, /held it last season/);

  const notManual = await api(h, cookies, "POST", `${BASE}/grants`, {
    award_id: "season_champ",
    player_tag: "8QCV",
    season_id: 135,
  });
  assert.equal(notManual.status, 400);
  assert.equal(notManual.body.error, "not_manual");

  const keep = await api(
    h,
    cookies,
    "DELETE",
    `${BASE}/grants/135/season_champ/20QQL8CCRU`,
  );
  assert.equal(keep.status, 400, "a computed grant is the record's");
  const gone = await api(
    h,
    cookies,
    "DELETE",
    `${BASE}/grants/135/clan_honour/UQ8LP2R9C`,
  );
  assert.equal(gone.status, 200);
  const after = await api(h, cookies, "GET", `${BASE}/manage`);
  assert.ok(!after.body.grants.some((x) => x.award_id === "clan_honour"));
});

test("awards: members read Awards while privileged management remains gated", async () => {
  const elderH = harness({
    players: [player({ player_tag: "#8QCV", name: "Amy", clan_role: "elder" })],
    part: partClan(),
  });
  const cookies = await signedIn(elderH);
  const r = await api(elderH, cookies, "GET", `${BASE}/manage`);
  assert.equal(r.status, 200);
  assert.equal(r.body.can_edit, false);
  assert.deepEqual(
    r.body.can_grant,
    [],
    "Clan Honour is leaders-only by default",
  );
  const refused = await api(elderH, cookies, "POST", `${BASE}/grants`, {
    award_id: "clan_honour",
    player_tag: "20QQL8CCRU",
    season_id: 135,
  });
  assert.equal(refused.status, 403);
  const config = await api(elderH, cookies, "POST", `${BASE}/config`, {
    values: {},
  });
  assert.equal(config.status, 403);

  const memberH = harness({
    players: [
      player({ player_tag: "#8QCV", name: "Amy", clan_role: "member" }),
    ],
    part: partClan(),
  });
  const mc = await signedIn(memberH);
  const memberView = await api(memberH, mc, "GET", BASE);
  assert.equal(memberView.status, 200);
  assert.equal(memberView.body.can_edit, false);
  assert.deepEqual(memberView.body.can_grant, []);
  assert.deepEqual(memberView.body.versions, []);
  assert.equal(
    (await api(memberH, mc, "POST", `${BASE}/config`, { values: {} })).status,
    403,
  );
});

test("awards: a leader renames, retunes, adds and switches off awards; every save is a version; bad values are refused in words", async () => {
  const h = harness({ part: partClan() });
  const cookies = await signedIn(h);
  const before = (await api(h, cookies, "GET", `${BASE}/manage`)).body;
  const values = structuredClone(before.config);
  values.awards[0].name = "Boat Captain";
  values.awards[1].params.decks_per_day = 3;
  values.awards[3].enabled = false;
  values.awards.push({
    id: "clanmate",
    kind: "leaders_pick",
    name: "Clanmate of the Month",
    description: "Whoever made the clan better this month.",
    enabled: true,
    params: { granted_by: "elders" },
  });
  const saved = await api(h, cookies, "POST", `${BASE}/config`, {
    values,
    note: "renamed, loosened Ever Present, added a pick",
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.version, 2);
  const after = (await api(h, cookies, "GET", `${BASE}/manage?refresh=1`)).body;
  assert.equal(after.config_version, 2);
  assert.equal(after.config.awards[0].name, "Boat Captain");
  assert.deepEqual(after.can_grant, ["clan_honour", "clanmate"]);
  assert.equal(
    after.versions[0].note,
    "renamed, loosened Ever Present, added a pick",
  );
  // The live race carries the new name; the old grants keep the name they were given.
  const s136 = after.seasons.find((s) => s.season_id === 136);
  assert.equal(
    s136.awards.find((a) => a.award_id === "season_champ").name,
    "Boat Captain",
  );
  assert.equal(
    s136.awards.find((a) => a.award_id === "top_rookie").state,
    "off",
  );
  assert.equal(
    after.grants.find((g) => g.award_id === "season_champ" && g.rank === 1)
      .name,
    "Season Champion",
  );

  const bad = await api(h, cookies, "POST", `${BASE}/config`, {
    values: {
      awards: [
        { id: "x", kind: "donations_podium", name: "", params: { podium: 9 } },
      ],
    },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "invalid_awards");
  assert.match(bad.body.errors["awards.0.name"], /1 to 40/);
  assert.match(bad.body.errors["awards.0.params.podium"], /between 1 and 3/);
});

test("awards: a member's trophy case lists their grants, newest season first", async () => {
  const h = harness({ part: partClan() });
  const cookies = await signedIn(h);
  await api(h, cookies, "GET", `${BASE}/manage`);
  const r = await api(
    h,
    cookies,
    "GET",
    "/api/clans/2PQRJ8LV/members/20QQL8CCRU/grants",
  );
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.grants.map((g) => [g.season_id, g.award_id, g.rank]),
    [
      [135, "ever_present", 1],
      [135, "season_champ", 1],
      [135, "top_donor", 2],
    ],
  );
});

test("awards: the clan's trophy case is every member's, and opening it writes a closed season's grants", async () => {
  const h = harness({
    players: [player({ player_tag: "#O2", clan_role: "member" })],
    part: partClan(),
  });
  const cookies = await signedIn(h);
  // No leader has visited Manage: the member's look is the first one.
  const r = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/trophies");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(
    r.body.awards.map((a) => [a.id, a.manual]),
    [
      ["season_champ", false],
      ["ever_present", false],
      ["top_donor", false],
      ["top_rookie", false],
      ["clan_honour", true],
    ],
  );
  assert.ok(r.body.awards.every((a) => a.rule.length > 20));
  const s135 = r.body.seasons.find((s) => s.season_id === 135);
  assert.ok(s135.grants.some((g) => g.award_id === "season_champ"));
  assert.ok(Array.isArray(r.body.yours));
  assert.ok((await h.ledger.grants("#2PQRJ8LV")).length > 0);
});

test("awards: a clan starts with none, and nothing runs before it has a policy", async () => {
  const fresh = harness({ part: partClan(), awards: null });
  const fc = await signedIn(fresh);
  const view = await api(fresh, fc, "GET", `${BASE}/manage`);
  assert.equal(view.status, 200);
  assert.deepEqual(view.body.config.awards, []);
  assert.equal(view.body.config_version, 0);
  const none = harness({ part: partClan(), policy: null, awards: null });
  const nc = await signedIn(none);
  for (const path of [
    `${BASE}/manage`,
    "/api/clans/2PQRJ8LV/trophies",
    "/api/clans/2PQRJ8LV/members/20QQL8CCRU/grants",
  ]) {
    const r = await api(none, nc, "GET", path);
    assert.equal(r.status, 409, path);
    assert.equal(r.body.error, "no_policy", path);
  }
  assert.equal(
    none.mcp.calls.filter((c) => c[0] === "clans_participation").length,
    0,
  );
});

test("awards: below 10 members nothing is judged or granted, and the trophy case says why", async () => {
  const h = harness({
    part: participation([king, levy, amy], {
      clan_tag: "#2PQRJ8LV",
      name: "Example Clan",
    }),
  });
  const cookies = await signedIn(h);
  for (const path of [`${BASE}/manage`, "/api/clans/2PQRJ8LV/trophies"]) {
    const r = await api(h, cookies, "GET", path);
    assert.equal(r.status, 409, path);
    assert.equal(r.body.error, "too_few_members", path);
    assert.equal(r.body.members, 3, path);
  }
  assert.deepEqual(await h.ledger.grants("#2PQRJ8LV"), []);
  const pick = await api(h, cookies, "POST", `${BASE}/grants`, {
    award_id: "clan_honour",
    player_tag: "UQ8LP2R9C",
    season_id: 135,
  });
  assert.equal(pick.status, 409);
  assert.equal(pick.body.error, "too_few_members");
});

test("awards: when a season's awards are granted, leaders get a Clan Leader Message naming the winners, once", async () => {
  const h = harness({
    part: partClan(),
    policy: { ...EXAMPLE_POLICY, announce_awards_enabled: true },
  });
  const cookies = await signedIn(h);
  await api(h, cookies, "GET", `${BASE}/manage`);
  const announcements = (await h.ledger.cards("#2PQRJ8LV")).filter(
    (c) => c.type === "awards_announcement",
  );
  assert.equal(announcements.length, 1);
  const a = announcements[0];
  assert.equal(a.evidence.season_id, 135);
  assert.equal(a.evidence.message.title, "Season 135 awards");
  assert.ok(a.evidence.message.body.length <= 180);
  assert.match(a.evidence.message.body, /Season Champion: Ada/);
  assert.deepEqual(a.audience, { kind: "leaders" });
  h.clock.t += 10 * 60_000;
  await api(h, cookies, "GET", `${BASE}/manage?refresh=1`);
  assert.equal(
    (await h.ledger.cards("#2PQRJ8LV")).filter(
      (c) => c.type === "awards_announcement",
    ).length,
    1,
  );
});

test("awards: the morning run shares the running season's standings with Elixir on its key, then only what moved", async () => {
  const h = harness({ part: partClan() });
  const svc = createAwardsService({
    ledger: h.ledger,
    now: () => h.clock.t,
    participationFor: (token, tag) => fetchParticipation(h.mcp, token, tag),
    elixir: h.mcp,
  });
  const first = await svc.evaluateOnSchedule("#2PQRJ8LV", "svt_clan_key");
  assert.equal(first.awards_evaluated, true);
  assert.ok(first.standings_written > 0, JSON.stringify(first));
  assert.equal(first.standings_failed, 0);
  const writes = h.mcp.calls.filter((c) => c[0] === "writeFact");
  assert.equal(writes.length, first.standings_written);
  assert.ok(
    writes.every((c) => c[1] === "svt_clan_key"),
    "on the integration key",
  );
  const facts = h.mcp.state.facts;
  assert.ok(facts.every((f) => f.type === "award_standing"));
  // The running season, and the latest closed season's final places.
  const seasons = new Set(facts.map((f) => f.detail.season_id));
  assert.ok(seasons.has(136), "the running season");
  assert.ok(
    [...seasons].every((id) => id === 136 || id === 135),
    [...seasons].join(),
  );
  assert.ok(
    facts.some(
      (f) => f.detail.award_id === "season_champ" && f.detail.place === 1,
    ),
  );
  // What was shared is remembered; the next morning writes nothing new.
  const saved = await h.ledger.sharedStandings("#2PQRJ8LV");
  assert.equal(saved.season_id, 136);
  assert.equal(Object.keys(saved.refs).length, first.standings_written);
  h.clock.t += 86_400_000;
  const second = await svc.evaluateOnSchedule("#2PQRJ8LV", "svt_clan_key");
  assert.equal(second.standings_written, 0);
  assert.equal(second.standings_removed, 0);
});

test("awards: an interrupted batch resumes its frozen winners after capture changes", async () => {
  const part = structuredClone(partClan());
  const h = harness({ part });
  const cookies = await signedIn(h);
  const put = h.ledger.putGrant.bind(h.ledger);
  let calls = 0;
  h.ledger.putGrant = async (...args) => {
    if (++calls === 2) throw new Error("interrupted");
    return put(...args);
  };
  assert.equal((await api(h, cookies, "GET", `${BASE}/manage`)).status, 500);
  assert.equal((await h.ledger.grants("#2PQRJ8LV")).length, 1);
  const original = (await h.ledger.grants("#2PQRJ8LV"))[0];
  part.members[0].war_points.fill(0);
  part.members[1].war_points.fill(9999);
  h.clock.t += 10 * 60_000;
  h.ledger.putGrant = put;
  const recovered = await api(h, cookies, "GET", `${BASE}/manage?refresh=1`);
  assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
  const champ = recovered.body.grants.filter(
    (g) => g.award_id === "season_champ",
  );
  assert.deepEqual(
    champ.map((g) => [g.player_name, g.rank, g.metric_value]),
    [
      ["Ada", 1, 16000],
      ["Ben", 2, 15200],
      ["Amy", 3, 2800],
    ],
  );
  assert.equal(champ[0].granted_at, original.granted_at);
  assert.ok(
    (await h.ledger.awardPlans("#2PQRJ8LV")).every((p) => p.completed_at),
  );
  const again = await api(h, cookies, "GET", `${BASE}/manage?refresh=1`);
  assert.deepEqual(again.body.grants, recovered.body.grants);
});

test("awards: manual choices require a closed complete season, roster member and reason; retries preserve author", async () => {
  const h = harness({ part: partClan() });
  const cookies = await signedIn(h);
  await api(h, cookies, "GET", `${BASE}/manage`);
  const body = {
    award_id: "clan_honour",
    player_tag: "UQ8LP2R9C",
    season_id: 135,
    note: "rotation",
  };
  for (const id of [136, 137]) {
    const r = await api(h, cookies, "POST", `${BASE}/grants`, {
      ...body,
      season_id: id,
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "season_not_closed");
  }
  assert.equal(
    (await api(h, cookies, "POST", `${BASE}/grants`, { ...body, note: " " }))
      .status,
    400,
  );
  assert.equal(
    (
      await api(h, cookies, "POST", `${BASE}/grants`, {
        ...body,
        player_tag: "P0LYQ",
      })
    ).body.error,
    "not_in_roster",
  );
  const first = await api(h, cookies, "POST", `${BASE}/grants`, {
    ...body,
    player_name: "invented",
  });
  assert.equal(first.body.player_name, "Ben");
  h.clock.t += 60_000;
  const retry = await api(h, cookies, "POST", `${BASE}/grants`, body);
  assert.deepEqual(retry.body, first.body);
  assert.equal(
    (
      await api(h, cookies, "POST", `${BASE}/grants`, {
        ...body,
        note: "changed",
      })
    ).body.error,
    "grant_exists",
  );
});

test("awards: all winners have complete bounded announcement copy; later manual picks replace pending copy", async () => {
  const part = structuredClone(partClan());
  part.members.forEach((m, i) => {
    m.war_decks.fill(16);
    m.name = `Fixture member ${i}`;
  });
  const h = harness({
    part,
    policy: { ...EXAMPLE_POLICY, announce_awards_enabled: true },
  });
  const cookies = await signedIn(h);
  await api(h, cookies, "GET", `${BASE}/manage`);
  const cards = () => h.ledger.cards("#2PQRJ8LV");
  const pending = async () =>
    (await cards()).filter(
      (c) => c.type === "awards_announcement" && c.status === "proposed",
    );
  const verify = async () => {
    const all = await h.ledger.grants("#2PQRJ8LV");
    const current = await pending();
    assert.ok(current.length > 1);
    assert.ok(
      current.every(
        (c) =>
          c.evidence.message.body.length <= 180 &&
          c.evidence.message.title.length <= 24,
      ),
    );
    assert.ok(current.every((c) => !c.evidence.message.body.includes("and ")));
    const refs = current.flatMap((c) => c.evidence.grant_refs);
    assert.equal(new Set(refs).size, all.length);
    for (const g of all)
      assert.ok(refs.includes(`${g.season_id}:${g.award_id}:${g.player_tag}`));
    for (const card of current) {
      const facts = factsOfAction(
        card,
        { status: "done", decided_at: new Date(h.clock.t).toISOString() },
        { grants: all },
      );
      assert.deepEqual(
        facts
          .filter((f) => f.type === "award_granted")
          .map((f) => f.ref)
          .sort(),
        card.evidence.grant_refs.map((ref) => `award:${ref}`).sort(),
      );
    }
    return current;
  };
  await verify();
  const pick = await api(h, cookies, "POST", `${BASE}/grants`, {
    award_id: "clan_honour",
    player_tag: "UQ8LP2R9C",
    season_id: 135,
    note: "human choice",
  });
  assert.equal(pick.status, 200);
  const withPick = await verify();
  assert.ok(
    withPick.some((c) =>
      c.evidence.message.body.includes("Clan Honour: Fixture member 1"),
    ),
  );
  assert.ok((await cards()).some((c) => c.status === "withdrawn"));
  await api(h, cookies, "DELETE", `${BASE}/grants/135/clan_honour/UQ8LP2R9C`);
  const removed = await verify();
  assert.ok(
    !removed.some((c) => c.evidence.message.body.includes("Clan Honour")),
  );
});

test("awards: no-winner decisions stay frozen when later capture changes", async () => {
  const part = structuredClone(partClan());
  part.members.forEach((m) => m.war_points.fill(0));
  const h = harness({ part });
  const cookies = await signedIn(h);
  await api(h, cookies, "GET", `${BASE}/manage`);
  const plan = (await h.ledger.awardPlans("#2PQRJ8LV")).find(
    (p) => p.award_id === "season_champ",
  );
  assert.ok(plan.completed_at);
  assert.deepEqual(plan.grants, []);
  part.members[0].war_points.fill(9999);
  const refreshed = await api(h, cookies, "GET", `${BASE}/manage?refresh=1`);
  assert.equal(refreshed.status, 200);
  assert.equal(
    refreshed.body.grants.filter((g) => g.award_id === "season_champ").length,
    0,
  );
  assert.equal(
    refreshed.body.seasons
      .find((s) => s.season_id === 135)
      .awards.find((a) => a.award_id === "season_champ").rows.length,
    0,
  );
});

test("awards: pending parts are renumbered after one was sent and a manual receipt changes", async () => {
  const part = structuredClone(partClan());
  part.members.forEach((m, i) => {
    m.war_decks.fill(16);
    m.name = `Fixture member ${i}`;
  });
  const h = harness({
    part,
    policy: { ...EXAMPLE_POLICY, announce_awards_enabled: true },
  });
  const cookies = await signedIn(h);
  await api(h, cookies, "GET", `${BASE}/manage`);
  const cards = () => h.ledger.cards("#2PQRJ8LV");
  const initial = (await cards()).filter((c) => c.status === "proposed");
  assert.ok(initial.length > 2);
  const first = initial.find((c) => c.evidence.part === 1);
  const sent = {
    ...first,
    status: "done",
    decided_at: new Date(h.clock.t).toISOString(),
  };
  await h.ledger.putCard("#2PQRJ8LV", sent);
  h.clock.t += 60_000;
  const check = async () => {
    const pending = (await cards()).filter((c) => c.status === "proposed");
    assert.deepEqual(
      pending.map((c) => c.evidence.part).sort((a, b) => a - b),
      Array.from({ length: pending.length }, (_, i) => i + 1),
    );
    assert.ok(pending.every((c) => c.evidence.parts === pending.length));
    assert.deepEqual(await h.ledger.card("#2PQRJ8LV", first.card_id), sent);
    const unsent = (await h.ledger.grants("#2PQRJ8LV")).filter(
      (g) =>
        !sent.evidence.grant_refs.includes(
          `${g.season_id}:${g.award_id}:${g.player_tag}`,
        ),
    );
    assert.equal(
      new Set(pending.flatMap((c) => c.evidence.grant_refs)).size,
      unsent.length,
    );
  };
  assert.equal(
    (
      await api(h, cookies, "POST", `${BASE}/grants`, {
        award_id: "clan_honour",
        player_tag: "UQ8LP2R9C",
        season_id: 135,
        note: "human choice",
      })
    ).status,
    200,
  );
  await check();
  assert.equal(
    (
      await api(
        h,
        cookies,
        "DELETE",
        `${BASE}/grants/135/clan_honour/UQ8LP2R9C`,
      )
    ).status,
    200,
  );
  await check();
});

test("awards: attendance with an unknown possible recipient is not frozen until evidence resolves", async () => {
  const part = structuredClone(partClan());
  part.members[1].war_decks.fill(16);
  part.members[1].war_decks[2] = null;
  const h = harness({ part });
  const cookies = await signedIn(h);
  const first = await api(h, cookies, "GET", `${BASE}/manage`);
  assert.equal(
    first.body.seasons
      .find((s) => s.season_id === 135)
      .awards.find((a) => a.award_id === "ever_present").state,
    "held",
  );
  assert.ok(
    !(await h.ledger.awardPlans("#2PQRJ8LV")).some(
      (p) => p.award_id === "ever_present",
    ),
  );
  part.members[1].war_decks.fill(16);
  const second = await api(h, cookies, "GET", `${BASE}/manage?refresh=1`);
  assert.ok(
    second.body.grants.some(
      (g) => g.award_id === "ever_present" && g.player_tag === "#UQ8LP2R9C",
    ),
  );
});

test("awards: an id cannot change kind after a frozen plan, and removed configuration still resumes its plan", async () => {
  const h = harness({ part: structuredClone(partClan()) });
  const cookies = await signedIn(h);
  const put = h.ledger.putGrant.bind(h.ledger);
  h.ledger.putGrant = async () => {
    throw new Error("interrupted");
  };
  assert.equal((await api(h, cookies, "GET", `${BASE}/manage`)).status, 500);
  const changed = structuredClone(EXAMPLE_AWARDS);
  changed.awards[0].kind = "donations_podium";
  changed.awards[0].params = { podium: 3 };
  const refused = await api(h, cookies, "POST", `${BASE}/config`, {
    values: changed,
  });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, "invalid_awards");
  const removed = structuredClone(EXAMPLE_AWARDS);
  removed.awards = removed.awards.filter((a) => a.id !== "season_champ");
  assert.equal(
    (await api(h, cookies, "POST", `${BASE}/config`, { values: removed }))
      .status,
    200,
  );
  h.ledger.putGrant = put;
  const resumed = await api(h, cookies, "GET", `${BASE}/manage?refresh=1`);
  assert.equal(resumed.status, 200);
  assert.equal(
    resumed.body.grants.filter((g) => g.award_id === "season_champ").length,
    3,
  );
  assert.equal(
    resumed.body.seasons
      .find((s) => s.season_id === 135)
      .awards.find((a) => a.award_id === "season_champ").kind,
    "season_points_podium",
  );
});

test("awards: a revoke retries announcement reconciliation after deletion already succeeded", async () => {
  const h = harness({
    part: structuredClone(partClan()),
    policy: { ...EXAMPLE_POLICY, announce_awards_enabled: true },
  });
  const cookies = await signedIn(h);
  await api(h, cookies, "GET", `${BASE}/manage`);
  await api(h, cookies, "POST", `${BASE}/grants`, {
    award_id: "clan_honour",
    player_tag: "UQ8LP2R9C",
    season_id: 135,
    note: "human choice",
  });
  const cards = h.ledger.cards.bind(h.ledger);
  h.ledger.cards = async () => {
    throw new Error("reconcile unavailable");
  };
  const path = `${BASE}/grants/135/clan_honour/UQ8LP2R9C`;
  assert.equal((await api(h, cookies, "DELETE", path)).status, 500);
  assert.ok(
    !(await h.ledger.grants("#2PQRJ8LV")).some(
      (g) => g.award_id === "clan_honour",
    ),
  );
  h.ledger.cards = cards;
  assert.equal((await api(h, cookies, "DELETE", path)).status, 200);
  const pending = (await cards("#2PQRJ8LV")).filter(
    (c) => c.type === "awards_announcement" && c.status === "proposed",
  );
  assert.ok(
    !pending.some((c) => c.evidence.message.body.includes("Clan Honour")),
  );
});

test("awards: a manual choice after a sent announcement gets separate copy without rewriting the sent action", async () => {
  const h = harness({
    part: partClan(),
    policy: { ...EXAMPLE_POLICY, announce_awards_enabled: true },
  });
  const cookies = await signedIn(h);
  await api(h, cookies, "GET", `${BASE}/manage`);
  const c = (await h.ledger.cards("#2PQRJ8LV"))[0];
  const sent = {
    ...c,
    status: "done",
    decided_at: new Date(h.clock.t).toISOString(),
  };
  await h.ledger.putCard("#2PQRJ8LV", sent);
  h.clock.t += 60_000;
  await api(h, cookies, "POST", `${BASE}/grants`, {
    award_id: "clan_honour",
    player_tag: "UQ8LP2R9C",
    season_id: 135,
    note: "human choice",
  });
  assert.deepEqual(await h.ledger.card("#2PQRJ8LV", c.card_id), sent);
  const fresh = (await h.ledger.cards("#2PQRJ8LV")).filter(
    (c) => c.status === "proposed",
  );
  assert.equal(fresh.length, 1);
  assert.match(fresh[0].evidence.message.body, /Clan Honour: Ben/);
  assert.equal(fresh[0].evidence.grant_refs.length, 1);
  const view = await api(
    h,
    cookies,
    "GET",
    `/api/clans/2PQRJ8LV/actions/${fresh[0].number}`,
  );
  assert.equal(view.status, 200);
  assert.equal(
    view.body.action.label,
    "Announce season 135 awards: Clan Honour",
  );
  const mail = actionsWaitingMail({
    clanTag: "#2PQRJ8LV",
    clanName: "Example Clan",
    appUrl: "https://elixir.test/clan",
    cards: [sent, fresh[0]],
    people: [{ player_tag: "#L", role: "leader" }],
  });
  assert.equal(mail.length, 1);
  assert.match(mail[0].subject, /Announce season 135 awards: Clan Honour/);
  assert.deepEqual(mail[0].card_ids, [fresh[0].card_id]);
  assert.deepEqual(await h.ledger.card("#2PQRJ8LV", c.card_id), sent);
});
