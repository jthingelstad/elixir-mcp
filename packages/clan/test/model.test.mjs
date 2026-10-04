/**
 * The clan's own model over the real handler: a leader adds the clan's
 * Anthropic key (checked, sealed, never shown again), drafts the
 * recruiting pitch with it (clan facts only, never a member), and every
 * use is bounded and recorded. Anthropic is scripted; nothing reaches the
 * network and no key here is real.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestAccount } from "./fakes.mjs";
import { createHandler } from "@elixir-mcp/clan/handler.mjs";
import { createMemoryLedger } from "@elixir-mcp/clan-state";
import { createRecruitService } from "@elixir-mcp/clan/manage/recruit.mjs";
import { fetchRoster } from "@elixir-mcp/clan/manage/service.mjs";
import { createDrafts } from "@elixir-mcp/clan/manage/drafts.mjs";
import { draftContextVersion } from "@elixir-mcp/clan/manage/actions.mjs";
import {
  USES_PER_DAY,
  createModelService,
  sealer,
} from "@elixir-mcp/clan/manage/model.mjs";
import {
  fakeMcp,
  player,
  req,
  signIn,
  cookieHeader,
  rosterBody,
  seedVersion,
} from "./fakes.mjs";

const GOOD = `sk-ant-api03-${"a".repeat(40)}WXYZ`;
const OTHER = `sk-ant-api03-${"b".repeat(40)}QRST`;
const ADA = "#20QQL8CCRU";
const BEA = "#8QCV";

const CLAN = {
  tag: "#2PQRJ8LV",
  name: "Example Clan",
  type: "inviteOnly",
  members: 40,
  requiredTrophies: 5000,
  clanScore: 61234,
  clanWarTrophies: 3210,
  donationsPerWeek: 8400,
  description: "War every week",
  memberList: [
    { name: "Ada", trophies: 9000, donations: 300 },
    { name: "Secretname", trophies: 8000, donations: 900 },
  ],
};

const PITCH = {
  schema: 1,
  tagline: "Steady wars, friendly chat",
  about: "A clan that plays together every week.",
  points: ["Wars every week"],
  looking_for: "Active players.",
  website_url: "https://clan.example",
  contact: "Request to join in game.",
};

function fakeAnthropic() {
  const state = { calls: [], write: null };
  return {
    state,
    async models(key) {
      state.calls.push(["models", key]);
      if (key !== GOOD && key !== OTHER) return { ok: false, status: 401 };
      return {
        ok: true,
        models: [
          { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
          { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
        ],
      };
    },
    async write(key, request) {
      state.calls.push(["write", key, request]);
      if (state.write) return state.write(key, request);
      return {
        ok: true,
        model: request.model,
        usage: { input_tokens: 700, output_tokens: 180 },
        input: {
          tagline: "**War first**, friends always",
          about: "We fight the River Race every week. See https://x.example",
          points: ["- Four decks every war day", "Top 3 in the region"],
          looking_for: "A player who shows up for war days.",
        },
      };
    },
  };
}

function harness({ players = [player()] } = {}) {
  const clock = { t: Date.parse("2026-09-25T12:00:00Z") };
  const now = () => clock.t;
  const ledger = seedVersion(
    createMemoryLedger(),
    "recruit",
    "#2PQRJ8LV",
    PITCH,
  );
  const mcp = fakeMcp({
    players,
    roster: rosterBody([
      { player_tag: ADA, name: "Ada", role: "leader", trophies: 9000 },
      { player_tag: BEA, name: "Bea", role: "coLeader", trophies: 8000 },
    ]),
  });
  const inner = mcp.rawCallTool.bind(mcp);
  mcp.rawCallTool = async (token, name, args) =>
    name === "live_fetch"
      ? { ok: true, body: { data: CLAN } }
      : inner(token, name, args);
  const anthropic = fakeAnthropic();
  const model = createModelService({
    ledger,
    anthropic,
    secret: "test-secret",
    rosterFor: (token, clanTag) => fetchRoster(mcp, token, clanTag),
    now,
  });
  const lines = [];
  const handler = createHandler({
    mcp,
    ...createTestAccount(),
    recruit: createRecruitService({ ledger, mcp, model, now }),
    model,
    drafts: createDrafts({
      ledger,
      model,
      now,
      // This suite isolates prompt/privacy behavior; admission races are
      // exercised through the real Manage guard in removal-safety.test.
      requireRemovalSafety: async () => ({ evidence_version: "fixture-proof" }),
    }),
    appUrl: "https://elixir.test/clan",
    elixirUrl: "https://elixir.test",
    now,
    log: {
      info: (l) => lines.push(l),
      warn: (l) => lines.push(l),
      error() {},
    },
  });
  return { clock, ledger, mcp, anthropic, handler, lines };
}

const api = async (h, cookies, method, path, body) => {
  const r = await h.handler(
    req(method, path, {
      cookies,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};
const signedIn = async (h) => cookieHeader((await signIn(h)).sessionCookie);
const MODEL = "/api/clans/2PQRJ8LV/model";
const DRAFT = "/api/clans/2PQRJ8LV/recruit/draft";

test("model: a leader adds the clan's key; it is checked, sealed, kept out of the clan's listing and never shown again", async () => {
  const h = harness();
  const c = await signedIn(h);
  const before = await api(h, c, "GET", MODEL);
  assert.equal(before.status, 200, JSON.stringify(before.body));
  assert.equal(before.body.set, false);
  const put = await api(h, c, "PUT", MODEL, { key: GOOD });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.model, "claude-sonnet-5", "the preferred model");
  const s = await api(h, c, "GET", MODEL);
  assert.equal(s.body.set, true);
  assert.equal(s.body.hint, "sk-ant-…WXYZ");
  assert.equal(s.body.set_by, ADA);
  assert.equal(s.body.usable, true);
  assert.equal(s.body.owner_leads, true);
  assert.equal(s.body.models.length, 2);
  // Nothing the app answers or logs carries the key.
  assert.ok(!JSON.stringify(s.body).includes(GOOD));
  assert.ok(!JSON.stringify(put.body).includes(GOOD));
  assert.ok(!h.lines.join("\n").includes(GOOD), "never in the log");
  // Kept sealed, in its own item, outside the clan's index.
  const item = h.ledger.items.get("model_key##2PQRJ8LV");
  assert.ok(item && !item.gsi1pk);
  assert.ok(!JSON.stringify(item).includes(GOOD));
  const listed = await h.ledger.modelCalls("#2PQRJ8LV");
  assert.deepEqual(listed, []);
  // Removed with the clan.
  await h.ledger.deleteClan("#2PQRJ8LV");
  assert.equal(h.ledger.items.get("model_key##2PQRJ8LV"), undefined);
});

test("model: a refused, admin or malformed key is not kept", async () => {
  const h = harness();
  const c = await signedIn(h);
  const refused = await api(h, c, "PUT", MODEL, {
    key: `sk-ant-api03-${"z".repeat(40)}`,
  });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, "key_refused");
  const admin = await api(h, c, "PUT", MODEL, {
    key: `sk-ant-admin01-${"z".repeat(40)}`,
  });
  assert.equal(admin.body.error, "admin_key");
  const junk = await api(h, c, "PUT", MODEL, { key: "hello" });
  assert.equal(junk.body.error, "not_a_key");
  assert.equal(
    h.anthropic.state.calls.length,
    1,
    "only the well-formed API key is checked with Anthropic",
  );
  assert.equal((await api(h, c, "GET", MODEL)).body.set, false);
});

test("model: only leaders and co-leaders see, set or use the key", async () => {
  const h = harness({
    players: [player({ player_tag: BEA, name: "Bea", clan_role: "elder" })],
  });
  const c = await signedIn(h);
  assert.equal((await api(h, c, "GET", MODEL)).status, 403);
  assert.equal((await api(h, c, "PUT", MODEL, { key: GOOD })).status, 403);
  assert.equal((await api(h, c, "POST", DRAFT, {})).status, 403);
  const recruit = await api(h, c, "GET", "/api/clans/2PQRJ8LV/recruit");
  assert.equal(recruit.body.model, null);
});

test("model: a leader drafts the pitch from clan facts only; the draft is tidied, checked and not saved", async () => {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  const view = await api(h, c, "GET", "/api/clans/2PQRJ8LV/recruit");
  assert.deepEqual(view.body.model, {
    set: true,
    refused: false,
    model: "claude-sonnet-5",
  });
  const r = await api(h, c, "POST", DRAFT, { note: "stress war days" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.draft.tagline, "War first, friends always");
  assert.equal(
    r.body.draft.about,
    "We fight the River Race every week. See",
    "links are taken out",
  );
  assert.deepEqual(r.body.draft.points, [
    "Four decks every war day",
    "Top 3 in the region",
  ]);
  // The clan's own website and contact are kept, never written by a model.
  assert.equal(r.body.draft.website_url, "https://clan.example");
  assert.equal(r.body.draft.contact, "Request to join in game.");
  assert.match(r.body.checks[0], /\b3\b/);
  // What was sent: clan facts, its words and the note; never a member.
  const [, key, sent] = h.anthropic.state.calls.at(-1);
  assert.equal(key, GOOD);
  assert.equal(sent.model, "claude-sonnet-5");
  assert.match(sent.prompt, /Required trophies to join: 5,000/);
  assert.match(sent.prompt, /Steady wars, friendly chat/);
  assert.match(sent.prompt, /stress war days/);
  assert.doesNotMatch(sent.prompt, /Ada|Bea|Secretname/);
  assert.equal(sent.tool.name, "write_pitch");
  // Nothing saved; the use is recorded.
  const again = await api(h, c, "GET", "/api/clans/2PQRJ8LV/recruit");
  assert.equal(again.body.pitch_version, 1);
  const s = await api(h, c, "GET", MODEL);
  assert.equal(s.body.uses.today, 1);
  assert.equal(s.body.uses.month.input_tokens, 700);
  assert.equal(s.body.uses.recent[0].purpose, "recruit_pitch");
  assert.equal(s.body.uses.recent[0].by, ADA);
});

test("model: the key works only while the leader who added it leads here; another leader may replace it", async () => {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  h.mcp.state.roster = rosterBody([
    { player_tag: ADA, name: "Ada", role: "member" },
    { player_tag: BEA, name: "Bea", role: "coLeader" },
  ]);
  const r = await api(h, c, "POST", DRAFT, {});
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "model_key_owner_left");
  assert.equal(
    h.anthropic.state.calls.filter((x) => x[0] === "write").length,
    0,
  );
  h.mcp.state.players = [
    player({ player_tag: BEA, name: "Bea", clan_role: "coLeader" }),
  ];
  const bea = await signedIn(h);
  const s = await api(h, bea, "GET", MODEL);
  assert.equal(s.body.owner_leads, false);
  assert.equal(s.body.usable, false);
  await api(h, bea, "PUT", MODEL, { key: OTHER });
  const drafted = await api(h, bea, "POST", DRAFT, {});
  assert.equal(drafted.status, 200, JSON.stringify(drafted.body));
  assert.equal(h.anthropic.state.calls.at(-1)[1], OTHER);
});

test("model: uses are capped per day, and a key Anthropic stops accepting is marked", async () => {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  for (let i = 0; i < USES_PER_DAY; i += 1)
    assert.equal((await api(h, c, "POST", DRAFT, {})).status, 200);
  const capped = await api(h, c, "POST", DRAFT, {});
  assert.equal(capped.status, 429);
  assert.equal(capped.body.error, "model_daily_limit");
  h.clock.t += 24 * 3600_000;
  h.anthropic.state.write = () => ({
    ok: false,
    status: 401,
    code: "authentication_error",
  });
  const refused = await api(h, c, "POST", DRAFT, {});
  assert.equal(refused.body.error, "model_key_refused");
  const s = await api(h, c, "GET", MODEL);
  assert.ok(s.body.refused_at);
  assert.equal(s.body.usable, false);
  // Removing it leaves the record of its uses.
  await api(h, c, "DELETE", MODEL);
  const gone = await api(h, c, "GET", MODEL);
  assert.equal(gone.body.set, false);
  assert.ok(gone.body.uses.month.count > USES_PER_DAY);
});

test("model: a sealed key opens only for its clan and the person who added it, under the same secret", () => {
  const a = sealer("secret-one");
  const box = a.seal(GOOD, "#2PQRJ8LV|#20QQL8CCRU");
  assert.equal(a.open(box, "#2PQRJ8LV|#20QQL8CCRU"), GOOD);
  assert.equal(a.open(box, "#OTHERCLAN|#20QQL8CCRU"), null);
  assert.equal(a.open(box, "#2PQRJ8LV|#8QCV"), null);
  assert.equal(sealer("secret-two").open(box, "#2PQRJ8LV|#20QQL8CCRU"), null);
  assert.ok(!JSON.stringify(box).includes(GOOD));
});

test("model: a leader drafts an open action's Leader Message in the clan's voice; the model never sees the member's name", async () => {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  const card = {
    card_id: "promo1",
    clan_tag: "#2PQRJ8LV",
    type: "promotion",
    status: "proposed",
    player_tag: "#8QCV",
    player_name: "Secretname",
    raised_at: "2026-09-25T11:00:00.000Z",
    evidence: {
      message: {
        title: "Congrats, new Elder!",
        body: "Secretname is now an Elder. Thank you for showing up.",
      },
    },
  };
  await h.ledger.putCard("#2PQRJ8LV", card);
  await h.ledger.putCard("#2PQRJ8LV", {
    ...card,
    card_id: "done1",
    status: "done",
  });
  h.anthropic.state.write = (key, request) => ({
    ok: true,
    model: request.model,
    usage: { input_tokens: 300, output_tokens: 40 },
    input: {
      title: "A new Elder & a toast",
      body: "Three cheers for {name}, our newest Elder. See you in war!",
    },
  });
  const path = "/api/clans/2PQRJ8LV/actions/promo1/draft";
  const r = await api(h, c, "POST", path, { note: "keep it short" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.title, "A new Elder and a toast");
  assert.equal(
    r.body.body,
    "Three cheers for Secretname, our newest Elder. See you in war!",
  );
  assert.deepEqual(r.body.warnings, []);
  const [, , sent] = h.anthropic.state.calls.at(-1);
  assert.equal(sent.tool.name, "write_leader_message");
  assert.doesNotMatch(sent.prompt, /Secretname/, "names never reach the model");
  assert.match(sent.prompt, /keep it short/);
  const log = await h.ledger.actionLog("#2PQRJ8LV", "promo1");
  assert.ok(log.some((e) => e.kind === "drafted"));
  const s = await api(h, c, "GET", MODEL);
  assert.equal(s.body.uses.recent[0].purpose, "leader_message");
  // A closed action, or one without a Leader Message, is not drafted.
  const closed = await api(
    h,
    c,
    "POST",
    "/api/clans/2PQRJ8LV/actions/done1/draft",
    {},
  );
  assert.equal(closed.status, 409);
});

test("model: only leaders draft Leader Messages", async () => {
  const h = harness({
    players: [player({ player_tag: BEA, name: "Bea", clan_role: "elder" })],
  });
  const c = await signedIn(h);
  const r = await api(h, c, "POST", "/api/clans/2PQRJ8LV/actions/x/draft", {});
  assert.equal(r.status, 403);
});

test("model: award recipients stay local and oversized legacy announcements refuse before spending", async () => {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  const card = {
    card_id: "awards1",
    clan_tag: "#2PQRJ8LV",
    type: "awards_announcement",
    status: "proposed",
    player_tag: null,
    player_name: null,
    evidence: {
      season_id: 135,
      awards: [
        { name: "Cup", winners: ["Secretname", "Anotherwinner", "Ab Cdef"] },
      ],
      grant_refs: ["135:cup:#8QCV", "135:cup:#P0LYQ"],
      message: {
        title: "Season 135 awards",
        body: "Cup: Secretname, Anotherwinner",
      },
    },
  };
  await h.ledger.putCard("#2PQRJ8LV", card);
  h.anthropic.state.write = (key, request) => ({
    ok: true,
    model: request.model,
    input: { title: "Awards", body: "Well played! {winners}" },
  });
  const r = await api(
    h,
    c,
    "POST",
    "/api/clans/2PQRJ8LV/actions/awards1/draft",
    {
      note: "Celebrate Secretname, Anotherwinner and #8QCV and #P0LYQ and Ab-Cdef and 8QCV",
    },
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.body, /Cup: Secretname, Anotherwinner/);
  assert.doesNotMatch(
    h.anthropic.state.calls.at(-1)[2].prompt,
    /Secretname|Anotherwinner|8QCV|P0LYQ|Ab.Cdef/,
  );
  const calls = h.anthropic.state.calls.length;
  await h.ledger.putCard("#2PQRJ8LV", {
    ...card,
    card_id: "oversized",
    evidence: {
      ...card.evidence,
      awards: [{ name: "Cup", winners: ["x".repeat(181)] }],
    },
  });
  const refused = await api(
    h,
    c,
    "POST",
    "/api/clans/2PQRJ8LV/actions/oversized/draft",
    {},
  );
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "awards_need_segments");
  assert.equal(h.anthropic.state.calls.length, calls);
});

test("model: welcome and removal chat drafts disclose no member evidence and leave the action proposed", async () => {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  for (const type of ["welcome", "removal"]) {
    await h.ledger.putCard("#2PQRJ8LV", {
      card_id: type,
      clan_tag: "#2PQRJ8LV",
      type,
      status: "proposed",
      player_tag: BEA,
      player_name: "Secretname",
      evidence: {
        days_idle: 999,
        facts: [{ value: "Private evidence" }],
        score: 0.1234,
      },
    });
    h.anthropic.state.write = (key, request) => ({
      ok: true,
      model: request.model,
      input: { line: "Welcome back, {name}!" },
    });
    const r = await api(
      h,
      c,
      "POST",
      `/api/clans/2PQRJ8LV/actions/${type}/draft`,
      { note: "gentle" },
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.line, "Welcome back, Secretname!");
    const [, , request] = h.anthropic.state.calls.at(-1);
    assert.equal(request.tool.name, "write_chat_message");
    assert.doesNotMatch(
      request.prompt,
      /Secretname|8QCV|999|Private evidence|0\.1234/,
    );
    assert.match(request.prompt, /Steady wars, friendly chat/);
    assert.equal((await h.ledger.card("#2PQRJ8LV", type)).status, "proposed");
  }
  const invalidNote = await api(
    h,
    c,
    "POST",
    "/api/clans/2PQRJ8LV/actions/welcome/draft",
    { note: "be kind to Ab Cdef, 8QCV; idle 999 days" },
  );
  assert.equal(invalidNote.status, 400);
  assert.equal(invalidNote.body.error, "bad_draft_tone");
  assert.equal(
    h.anthropic.state.calls.filter(([type]) => type === "write").length,
    2,
  );
  const writes = h.anthropic.state.calls.filter(
    ([type]) => type === "write",
  ).length;
  await h.ledger.putCard("#2PQRJ8LV", {
    card_id: "unsupported",
    type: "departure",
    status: "proposed",
  });
  assert.equal(
    (
      await api(
        h,
        c,
        "POST",
        "/api/clans/2PQRJ8LV/actions/unsupported/draft",
        {},
      )
    ).status,
    409,
  );
  assert.equal(
    (await api(h, c, "POST", "/api/clans/GQ08RJPL/actions/welcome/draft", {}))
      .status,
    403,
  );
  assert.equal(
    h.anthropic.state.calls.filter(([type]) => type === "write").length,
    writes,
  );
});

test("model: unverified leaders and verified elders cannot spend on either chat action", async () => {
  for (const identity of [
    player({ claim_status: "unverified" }),
    player({ clan_role: "elder" }),
  ]) {
    const h = harness({ players: [identity] });
    const c = await signedIn(h);
    for (const type of ["welcome", "removal"]) {
      await h.ledger.putCard("#2PQRJ8LV", {
        card_id: type,
        type,
        status: "proposed",
      });
      const r = await api(
        h,
        c,
        "POST",
        `/api/clans/2PQRJ8LV/actions/${type}/draft`,
        {},
      );
      assert.equal(r.status, 403, JSON.stringify(r.body));
    }
    assert.equal(h.anthropic.state.calls.length, 0);
  }
});

test("model: welcome drafting uses only its frozen detail with the original provenance", async () => {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  const welcome = {
    kind: "career_wins",
    value: 12456,
    fact: "12,000+ career wins.",
    source_as_of: "2026-09-24T12:00:00Z",
    private_note: "Private evidence",
  };
  const card = {
    card_id: "frozen",
    type: "welcome",
    status: "proposed",
    player_tag: BEA,
    player_name: "Secretname",
    evidence: {
      joined_at: "2026-09-25T10:00:00Z",
      welcome,
      score: 0.1234,
      notes: "Private evidence",
    },
  };
  await h.ledger.putCard("#2PQRJ8LV", card);
  h.clock.t += 2 * 86400000;
  h.anthropic.state.write = (key, request) => ({
    ok: true,
    model: request.model,
    input: { line: "Welcome, {name}! 12,000+ career wins." },
  });
  const response = await api(
    h,
    c,
    "POST",
    "/api/clans/2PQRJ8LV/actions/frozen/draft",
    { expected_draft_version: draftContextVersion(card) },
  );
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.match(response.body.line, /Secretname.*12,000\+ career wins/);
  assert.equal(response.body.draft_context_version, draftContextVersion(card));
  const request = h.anthropic.state.calls.at(-1)[2];
  assert.match(request.prompt, /12,000\+ career wins/);
  assert.match(request.prompt, /2026-09-24T12:00:00.000Z/);
  assert.doesNotMatch(
    JSON.stringify(request),
    /Secretname|8QCV|Private evidence|0\.1234|12456/,
  );
  assert.deepEqual(await h.ledger.card("#2PQRJ8LV", card.card_id), card);
  assert.equal(
    h.mcp.calls.filter(([name]) => name === "players_profile").length,
    0,
  );
});

test("model: confirmed kick and leave guide departure drafts; unconfirmed and ignored do not spend", async () => {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  for (const classification of ["member_left", "member_kicked"]) {
    const card = {
      card_id: classification,
      type: "departure",
      status: "done",
      player_tag: BEA,
      player_name: "Secretname",
      decided_by: ADA,
      decided_at: "2026-09-25T11:00:00Z",
      decision_note: "Private reason",
      outcome: { classification, verified_at: "2026-09-25T11:00:00Z" },
      evidence: {
        left_at: "2026-09-24T12:00:00Z",
        tenure_days: 38,
        days_idle: 999,
        removal_state: "recommended",
        phrase: "Private evidence",
      },
    };
    await h.ledger.putCard("#2PQRJ8LV", card);
    h.anthropic.state.write = (key, request) => ({
      ok: true,
      model: request.model,
      input: { line: "Wishing you well, {name}." },
    });
    const response = await api(
      h,
      c,
      "POST",
      `/api/clans/2PQRJ8LV/actions/${classification}/draft`,
      { expected_draft_version: draftContextVersion(card) },
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.line, "Wishing you well, Secretname.");
    const request = h.anthropic.state.calls.at(-1)[2];
    assert.match(
      request.prompt,
      classification === "member_left" ? /member left/ : /member was kicked/,
    );
    assert.match(request.prompt, /recorded tenure 38 days/);
    assert.doesNotMatch(
      JSON.stringify(request),
      /Secretname|8QCV|Private reason|Private evidence|999|recommended/,
    );
    assert.deepEqual(await h.ledger.card("#2PQRJ8LV", card.card_id), card);
  }
  const writes = h.anthropic.state.calls.filter(
    ([type]) => type === "write",
  ).length;
  for (const extra of [
    { status: "proposed" },
    {
      status: "done",
      decided_by: ADA,
      decided_at: "2026-09-25T11:00:00Z",
      outcome: { classification: "ignored" },
    },
    { status: "done", outcome: { classification: "member_left" } },
  ]) {
    await h.ledger.putCard("#2PQRJ8LV", {
      card_id: "unknown",
      type: "departure",
      ...extra,
    });
    const response = await api(
      h,
      c,
      "POST",
      "/api/clans/2PQRJ8LV/actions/unknown/draft",
      {},
    );
    assert.equal(response.status, 409);
    assert.equal(response.body.error, "departure_unconfirmed");
  }
  assert.equal(
    h.anthropic.state.calls.filter(([type]) => type === "write").length,
    writes,
  );
});

test("model: a stale context refuses before spending and a confirmation change during a draft rejects its result", async () => {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  const card = {
    card_id: "changing",
    type: "departure",
    status: "done",
    decided_by: ADA,
    decided_at: "2026-09-25T11:00:00Z",
    outcome: { classification: "member_left" },
    evidence: {},
  };
  await h.ledger.putCard("#2PQRJ8LV", card);
  const stale = await api(
    h,
    c,
    "POST",
    "/api/clans/2PQRJ8LV/actions/changing/draft",
    { expected_draft_version: "old" },
  );
  assert.equal(stale.body.error, "draft_changed");
  assert.equal(
    h.anthropic.state.calls.filter(([type]) => type === "write").length,
    0,
  );
  h.anthropic.state.write = async (key, request) => {
    await h.ledger.putCard("#2PQRJ8LV", {
      ...card,
      outcome: { classification: "member_kicked" },
    });
    return {
      ok: true,
      model: request.model,
      input: { line: "A stale farewell" },
    };
  };
  const changed = await api(
    h,
    c,
    "POST",
    "/api/clans/2PQRJ8LV/actions/changing/draft",
    { expected_draft_version: draftContextVersion(card) },
  );
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error, "draft_changed");
  assert.equal(
    h.anthropic.state.calls.filter(([type]) => type === "write").length,
    1,
  );
  assert.equal(
    (await h.ledger.actionLog("#2PQRJ8LV", card.card_id)).filter(
      (entry) => entry.kind === "drafted",
    ).length,
    0,
  );
});

test("model: an uncertain dispatch is counted and tells a leader to check uses before another draft", async () => {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  h.anthropic.state.write = () => {
    throw new Error("lost transport");
  };
  const r = await api(h, c, "POST", DRAFT, {});
  assert.equal(r.status, 502);
  assert.match(r.body.message, /outcome is unknown.*attempt is counted/);
  const status = await api(h, c, "GET", MODEL);
  assert.equal(status.body.uses.today, 1);
  assert.equal(status.body.uses.recent[0].code, "outcome_unknown");
});
