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
  MODELS_REFRESH_MS,
  PENDING_MS,
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

const HAIKU_45 = "claude-haiku-4-5-20251001";
const HAIKU_55 = "claude-haiku-5-5";
const OPUS_55 = "claude-opus-5-5";
const SONNET_55 = "claude-sonnet-5-5";
const SONNET = { id: "claude-sonnet-5", name: "Claude Sonnet 5" };
const H45 = { id: HAIKU_45, name: "Claude Haiku 4.5" };
const H55 = { id: HAIKU_55, name: "Claude Haiku 5.5" };
const O55 = { id: OPUS_55, name: "Claude Opus 5.5" };
const S55 = { id: SONNET_55, name: "Claude Sonnet 5.5" };

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

/** What the record knows, as `clanStoryFacts` gathers it: the clan and
 *  one member (who missed week 3 and played week 4). */
const STORY = (tags) => ({
  clan: {
    name: "Example Clan",
    members: 40,
    war: [{ season_id: 135, section_index: 3, rank: 2, trophy_change: 40 }],
  },
  members: Object.fromEntries(
    tags
      .filter((t) => t === BEA)
      .map((t) => [
        t,
        {
          name: "Secretname",
          role: "member",
          trophies: 8000,
          best_trophies: 8400,
          arena: "Legendary Arena",
          joined_at: "2026-08-16T00:00:00Z",
          tenure_days: 40,
          stints_before: 1,
          last_left_at: "2026-05-01T00:00:00Z",
          war: [
            { season_id: 135, section_index: 3, decks_used: 16, points: 2900 },
            { season_id: 135, section_index: 2, decks_used: 0, points: 0 },
          ],
          moments: [
            {
              at: "2026-09-20T00:00:00Z",
              text: "Secretname reached a new best.",
            },
          ],
        },
      ]),
  ),
});

function fakeAnthropic() {
  const state = { calls: [], write: null };
  return {
    state,
    async models(key) {
      state.calls.push(["models", key]);
      if (state.modelsFn) return state.modelsFn(key);
      if (key !== GOOD && key !== OTHER) return { ok: false, status: 401 };
      return {
        ok: true,
        models: state.models ?? [H45, SONNET, O55, S55, H55],
      };
    },
    // The bridge's start/collect, when a test turns them on (`deferred`):
    // a started write answers only when `state.replies` holds its reply.
    get start() {
      if (!state.deferred) return undefined;
      return async (key, request) => {
        state.calls.push(["write", key, request]);
        const id = `00000000-0000-4000-8000-${String(state.calls.length).padStart(12, "0")}`;
        state.started = id;
        return { ok: true, id };
      };
    },
    get collect() {
      if (!state.deferred) return undefined;
      return async (id) => (state.replies ?? {})[id] ?? null;
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
      storyFor: async (clanTag, tags) => STORY(tags),
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
  // Elixir Clan's model for each use, never one the leader picked.
  assert.equal(put.body.model_for.recruit_pitch.id, OPUS_55);
  assert.equal(put.body.model_for.discord_activity.id, SONNET_55);
  const s = await api(h, c, "GET", MODEL);
  assert.equal(s.body.set, true);
  assert.equal(s.body.hint, "sk-ant-…WXYZ");
  assert.equal(s.body.set_by, ADA);
  assert.equal(s.body.usable, true);
  assert.equal(s.body.owner_leads, true);
  assert.deepEqual(s.body.model_for.leader_message, {
    id: OPUS_55,
    name: "Claude Opus 5.5",
  });
  for (const gone of ["model", "models", "model_listed"])
    assert.equal(gone in s.body, false, gone);
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
  assert.equal(view.body.model.set, true);
  assert.equal(view.body.model.refused, false);
  assert.equal(view.body.model.model_for.recruit_pitch.id, OPUS_55);
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
  assert.equal(sent.model, OPUS_55, "the leaders' drafts run on Opus 5.5");
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

test("model: a leader drafts an open action's Leader Message with what Elixir knows: the member by name, the rule's evidence, the note as written", async () => {
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
      phrase: "played every war deck for three weeks",
      facts: [
        {
          key: "war_decks",
          label: "War decks",
          value: "48 of 48",
          window: "last 3 weeks",
        },
      ],
      rationale: { headline: "INTERNAL HEADLINE" },
      days_idle: 0,
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
  await h.ledger.putGrant("#2PQRJ8LV", {
    season_id: 134,
    award_id: "cup",
    name: "Cup",
    player_tag: "#8QCV",
    player_name: "Secretname",
    metric_value: 3100,
    metric_unit: "points",
    note: "PRIVATE GRANT NOTE",
    granted_at: "2026-09-01T10:00:00Z",
  });
  h.anthropic.state.write = (key, request) => ({
    ok: true,
    model: request.model,
    usage: { input_tokens: 300, output_tokens: 40 },
    input: {
      title: "A new Elder & a toast",
      body: "Three cheers for Secretname, our newest Elder: 2,900 points in week 4. See you in war!",
    },
  });
  const path = "/api/clans/2PQRJ8LV/actions/promo1/draft";
  const r = await api(h, c, "POST", path, {
    note: "mention Secretname's war week",
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.title, "A new Elder and a toast");
  assert.equal(
    r.body.body,
    "Three cheers for Secretname, our newest Elder: 2,900 points in week 4. See you in war!",
  );
  assert.deepEqual(r.body.warnings, []);
  const [, , sent] = h.anthropic.state.calls.at(-1);
  assert.equal(sent.tool.name, "write_leader_message");
  assert.equal(sent.tool.strict, true);
  assert.equal(sent.tool.input_schema.additionalProperties, false);
  assert.equal(sent.effort, "medium");
  // The clan is the cached prefix; the moment and the member the packet.
  assert.match(sent.context, /^THE CLAN\nName: Example Clan/);
  assert.match(sent.context, /Its tagline: Steady wars, friendly chat/);
  assert.match(sent.context, /season 135 week 4: place 2/);
  assert.match(sent.prompt, /MEMBER: Secretname/);
  assert.match(sent.prompt, /War decks: 48 of 48 \(last 3 weeks\)/);
  assert.match(sent.prompt, /In short: played every war deck/);
  assert.match(sent.prompt, /Trophies: 8,000; best ever 8,400/);
  assert.match(sent.prompt, /season 135 week 4: 16 decks, 2,900 points/);
  assert.match(sent.prompt, /Cup \(season 134, 3,100 points\)/);
  assert.match(sent.prompt, /THE LEADER'S NOTE.*mention Secretname's war week/);
  assert.doesNotMatch(
    JSON.stringify(sent),
    /INTERNAL HEADLINE|PRIVATE GRANT NOTE|fame|8QCV/,
  );
  const log = await h.ledger.actionLog("#2PQRJ8LV", "promo1");
  assert.ok(log.some((e) => e.kind === "drafted"));
  const s = await api(h, c, "GET", MODEL);
  assert.equal(s.body.uses.recent[0].purpose, "leader_message");
  // A number or a name the model was not given is flagged, never dropped.
  h.anthropic.state.write = (key, request) => ({
    ok: true,
    model: request.model,
    input: {
      title: "New Elder",
      body: "Secretname beat Jotaro with 4,100 points.",
    },
  });
  const flagged = await api(h, c, "POST", path, {});
  assert.equal(flagged.status, 200, JSON.stringify(flagged.body));
  assert.match(flagged.body.warnings.join(" "), /4,100 is not in anything/);
  assert.match(flagged.body.warnings.join(" "), /Jotaro is not a name/);
  h.anthropic.state.write = (key, request) => ({
    ok: true,
    model: request.model,
    input: {
      title: "A new Elder & a toast",
      body: "Three cheers for {name}, our newest Elder. See you in war!",
    },
  });
  const chat = await api(h, c, "POST", path, { channel: "clan_chat" });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  assert.deepEqual(chat.body.lines, [
    "A new Elder and a toast: Three cheers for Secretname, our newest Elder. See you in war!",
  ]);
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

test("model: an awards draft names its winners with their numbers; Elixir still writes the complete list, and oversized announcements refuse before spending", async () => {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  for (const [tag, name, value] of [
    ["#8QCV", "Secretname", 3100],
    ["#P0LYQ", "Anotherwinner", 2900],
  ])
    await h.ledger.putGrant("#2PQRJ8LV", {
      season_id: 135,
      award_id: "cup",
      name: "Cup",
      player_tag: tag,
      player_name: name,
      metric_value: value,
      metric_unit: "points",
      granted_at: "2026-10-06T10:00:00Z",
    });
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
    { note: "Celebrate Secretname" },
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.body, /Cup: Secretname, Anotherwinner, Ab Cdef/);
  const sent = h.anthropic.state.calls.at(-1)[2];
  assert.match(sent.prompt, /Season 135 closed/);
  assert.match(sent.prompt, /- Cup: Secretname \(3,100 points\)/);
  assert.match(sent.prompt, /- Cup: Anotherwinner \(2,900 points\)/);
  assert.match(sent.prompt, /Celebrate Secretname/);
  assert.match(sent.system, /\{winners\}/);
  assert.doesNotMatch(sent.prompt, /8QCV|P0LYQ/);
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

test("model: a welcome tells the member's record; a removal only their time and what they gave, never inactivity; both leave the action proposed", async () => {
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
    assert.equal(request.tool.strict, true);
    assert.equal(request.effort, "medium");
    assert.match(request.prompt, /MEMBER: Secretname/);
    assert.match(request.prompt, /Gentle and respectful/);
    assert.match(request.context, /Steady wars, friendly chat/);
    assert.doesNotMatch(
      JSON.stringify(request),
      /8QCV|999|Private evidence|0\.1234/,
    );
    if (type === "welcome") {
      assert.match(request.prompt, /Trophies: 8,000; best ever 8,400/);
      assert.match(request.prompt, /Their recent moments/);
    } else {
      // Contribution only: no trophies, no moments, no week they missed.
      assert.doesNotMatch(request.prompt, /Trophies|moments|0 decks|week 3/);
      assert.match(request.prompt, /season 135 week 4: 16 decks, 2,900 points/);
      assert.match(request.prompt, /Time in the clan: 40 days/);
      assert.match(
        request.system + request.prompt,
        /Never mention numbers about their inactivity/,
      );
    }
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

test("model: a returning member's welcome says so, from the Action and the record's earlier stint", async () => {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  const card = {
    card_id: "frozen",
    type: "welcome",
    status: "proposed",
    player_tag: BEA,
    player_name: "Secretname",
    evidence: {
      joined_at: "2026-09-25T10:00:00Z",
      welcome: { returning: true, source_as_of: "2026-09-24T12:00:00Z" },
      score: 0.1234,
      notes: "Private evidence",
    },
  };
  await h.ledger.putCard("#2PQRJ8LV", card);
  h.clock.t += 2 * 86400000;
  h.anthropic.state.write = (key, request) => ({
    ok: true,
    model: request.model,
    input: { line: "Welcome back, Secretname! Good to see you again." },
  });
  const response = await api(
    h,
    c,
    "POST",
    "/api/clans/2PQRJ8LV/actions/frozen/draft",
    { expected_draft_version: draftContextVersion(card) },
  );
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(
    response.body.line,
    "Welcome back, Secretname! Good to see you again.",
  );
  assert.equal(response.body.draft_context_version, draftContextVersion(card));
  const request = h.anthropic.state.calls.at(-1)[2];
  assert.match(request.prompt, /A member came back/);
  assert.match(request.prompt, /1 earlier stint, the last ending 2026-05-01/);
  assert.match(request.prompt, /welcoming this member back/);
  assert.doesNotMatch(JSON.stringify(request), /8QCV|Private evidence|0\.1234/);
  assert.deepEqual(await h.ledger.card("#2PQRJ8LV", card.card_id), card);
});

test("model: confirmed kick and leave guide departure drafts with tenure and contribution; unconfirmed and ignored do not spend", async () => {
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
      classification === "member_left"
        ? /left the clan on their own/
        : /was removed from the clan/,
    );
    assert.match(request.prompt, /Time in the clan: 38 days/);
    assert.match(request.prompt, /16 decks, 2,900 points/);
    assert.doesNotMatch(
      JSON.stringify(request),
      /8QCV|Private reason|Private evidence|999|recommended|Trophies/,
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

test("model: each use runs on the first of its 5.5 models the key reaches", async () => {
  const h = harness();
  // Opus 5.5 out of this key's reach: the drafts take Sonnet 5.5.
  h.anthropic.state.models = [H45, SONNET, S55, H55];
  const c = await signedIn(h);
  const put = await api(h, c, "PUT", MODEL, { key: GOOD });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.model_for.recruit_pitch.id, SONNET_55);
  const r = await api(h, c, "POST", DRAFT, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.model, SONNET_55);
  assert.equal(h.anthropic.state.calls.at(-1)[2].model, SONNET_55);
  const s = await api(h, c, "GET", MODEL);
  assert.equal(s.body.uses.recent[0].model, SONNET_55, "the use names it");
  // Only Haiku 5.5 in reach: every use runs on it.
  const only = harness();
  only.anthropic.state.models = [H45, H55];
  const o = await signedIn(only);
  await api(only, o, "PUT", MODEL, { key: GOOD });
  await api(only, o, "POST", DRAFT, {});
  assert.equal(only.anthropic.state.calls.at(-1)[2].model, HAIKU_55);
});

test("model: a key that reaches no 5.5 model is refused when added, and a use none of whose models it reaches refuses before spending", async () => {
  const h = harness();
  h.anthropic.state.models = [H45, SONNET];
  const c = await signedIn(h);
  const put = await api(h, c, "PUT", MODEL, { key: GOOD });
  assert.equal(put.status, 400);
  assert.equal(put.body.error, "no_models");
  assert.match(put.body.message, /Claude Opus 5\.5/);
  assert.equal((await api(h, c, "GET", MODEL)).body.set, false);
  // A key whose list no longer reaches the generation (as a refresh can
  // find it): nothing older stands in.
  h.anthropic.state.models = undefined;
  await api(h, c, "PUT", MODEL, { key: GOOD });
  const stored = await h.ledger.modelKey("#2PQRJ8LV");
  await h.ledger.saveModelKey("#2PQRJ8LV", { ...stored, models: [H45] });
  const s = await api(h, c, "GET", MODEL);
  assert.equal(s.body.model_for.recruit_pitch, null);
  const r = await api(h, c, "POST", DRAFT, {});
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "model_unavailable");
  assert.match(r.body.message, /cannot reach the models Elixir Clan uses/);
  assert.equal(
    h.anthropic.state.calls.filter(([t]) => t === "write").length,
    0,
    "never sent",
  );
  assert.equal((await api(h, c, "GET", MODEL)).body.uses.today, 0);
});

test("model: the leader's choice of model is retired; a model saved before it is never read", async () => {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  // As saved before 2026-10-11: the clan had picked Haiku 4.5.
  const stored = await h.ledger.modelKey("#2PQRJ8LV");
  await h.ledger.saveModelKey("#2PQRJ8LV", { ...stored, model: HAIKU_45 });
  const chosen = await api(h, c, "PUT", MODEL, { model: HAIKU_55 });
  assert.equal(chosen.status, 410);
  assert.equal(chosen.body.error, "model_choice_retired");
  assert.match(chosen.body.message, /Elixir Clan chooses the model/);
  // A key sent with a model is added; the model is ignored.
  const withModel = await api(h, c, "PUT", MODEL, {
    key: OTHER,
    model: HAIKU_45,
  });
  assert.equal(withModel.status, 200, JSON.stringify(withModel.body));
  await h.ledger.saveModelKey("#2PQRJ8LV", {
    ...(await h.ledger.modelKey("#2PQRJ8LV")),
    model: HAIKU_45,
  });
  const r = await api(h, c, "POST", DRAFT, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(h.anthropic.state.calls.at(-1)[2].model, OPUS_55);
  assert.equal(
    (await h.ledger.modelKey("#2PQRJ8LV")).model,
    HAIKU_45,
    "left as it was, harmless",
  );
});

test("model: a refusal or a cut-off answer is an error with its own code, never a draft", async () => {
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
        body: "Secretname is an Elder.",
      },
    },
  };
  await h.ledger.putCard("#2PQRJ8LV", card);
  const action = "/api/clans/2PQRJ8LV/actions/promo1/draft";
  for (const [code, status, error] of [
    ["refusal", 422, "model_refused"],
    ["max_tokens", 502, "model_cut_off"],
  ]) {
    h.clock.t += 60_000;
    h.anthropic.state.write = () => ({
      ok: false,
      status: 200,
      code,
      message: `scripted ${code}`,
      usage: { input_tokens: 600, output_tokens: 1600 },
    });
    const pitch = await api(h, c, "POST", DRAFT, {});
    assert.equal(pitch.status, status, JSON.stringify(pitch.body));
    assert.equal(pitch.body.error, error);
    assert.equal(pitch.body.message, `scripted ${code}`);
    assert.equal(pitch.body.draft, undefined);
    for (const channel of ["leader_message", "clan_chat"]) {
      const words = await api(h, c, "POST", action, { channel });
      assert.equal(words.status, status, JSON.stringify(words.body));
      assert.equal(words.body.error, error);
      assert.equal(words.body.title, undefined);
      assert.equal(words.body.lines, undefined);
    }
    const uses = (await api(h, c, "GET", MODEL)).body.uses.recent;
    assert.equal(uses[0].code, code, "the use log names it");
    assert.equal(uses[0].ok, false);
    assert.equal(uses[0].output_tokens, 1600);
  }
  assert.equal(
    (await h.ledger.actionLog("#2PQRJ8LV", "promo1")).filter(
      (e) => e.kind === "drafted",
    ).length,
    0,
  );
});

// ---------------------------------------------------- the key's model list

const REFRESH = "/api/clans/2PQRJ8LV/model/refresh";
const modelsCalls = (h) =>
  h.anthropic.state.calls.filter(([type]) => type === "models").length;
const listedIds = async (h) =>
  ((await h.ledger.modelKey("#2PQRJ8LV")).models ?? []).map((m) => m.id);

/** A clan whose key was read before refreshing existed: `models` as then. */
async function oldKey({ models = [H45, SONNET] } = {}) {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  const stored = await h.ledger.modelKey("#2PQRJ8LV");
  const before = { ...stored };
  delete before.models_checked_at;
  delete before.models_refreshed_at;
  delete before.models_refresh_error;
  await h.ledger.saveModelKey("#2PQRJ8LV", {
    ...before,
    model: HAIKU_45,
    models,
  });
  return { h, c };
}

test("model list: a key read before the 5.5 models is due; one refresh puts its uses on them", async () => {
  const { h, c } = await oldKey();
  const before = await api(h, c, "GET", MODEL);
  assert.equal(before.body.refresh_due, true);
  assert.equal(before.body.models_refreshed_at, null);
  assert.equal(before.body.model_for.recruit_pitch, null);
  assert.equal(modelsCalls(h), 1, "reading the status never calls Anthropic");
  assert.equal(
    (await api(h, c, "POST", DRAFT, {})).body.error,
    "model_unavailable",
  );
  h.anthropic.state.models = [H45, H55, SONNET];
  const r = await api(h, c, "POST", REFRESH);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.refreshed, true);
  const after = await api(h, c, "GET", MODEL);
  assert.deepEqual(await listedIds(h), [HAIKU_45, HAIKU_55, "claude-sonnet-5"]);
  assert.equal(after.body.model_for.recruit_pitch.id, HAIKU_55);
  assert.equal(after.body.model_for.discord_activity.id, HAIKU_55);
  assert.equal(after.body.refresh_due, false);
  assert.equal(after.body.models_refreshed_at, "2026-09-25T12:00:00.000Z");
  assert.equal(after.body.models_refresh_error, null);
  await api(h, c, "POST", DRAFT, {});
  assert.equal(h.anthropic.state.calls.at(-1)[2].model, HAIKU_55);
  // Bounded: not again within the day, then due again.
  const again = await api(h, c, "POST", REFRESH);
  assert.equal(again.body.refreshed, false);
  assert.equal(again.body.reason, "not_due");
  assert.equal(modelsCalls(h), 2);
  h.clock.t += MODELS_REFRESH_MS;
  assert.equal((await api(h, c, "GET", MODEL)).body.refresh_due, true);
  h.anthropic.state.models = [H55, O55];
  assert.equal((await api(h, c, "POST", REFRESH)).body.refreshed, true);
  assert.equal(modelsCalls(h), 3);
  assert.equal(
    (await api(h, c, "GET", MODEL)).body.model_for.clan_chat.id,
    OPUS_55,
    "a model the key gains is used as soon as the list shows it",
  );
});

test("model list: a failed refresh keeps the old list, is recorded, and never blocks drafting", async () => {
  for (const [name, fn, code] of [
    [
      "busy",
      () => ({ ok: false, status: 429, code: "rate_limit_error" }),
      "rate_limit_error",
    ],
    [
      "unknown",
      () => ({ ok: false, status: 0, code: "outcome_unknown" }),
      "outcome_unknown",
    ],
    [
      "thrown",
      () => {
        throw new Error("lost transport");
      },
      "outcome_unknown",
    ],
    ["empty", () => ({ ok: true, status: 200, models: [] }), "no_models"],
    [
      "no claude",
      () => ({ ok: true, status: 200, models: [{ id: "other", name: "x" }] }),
      "no_models",
    ],
  ]) {
    const { h, c } = await oldKey({ models: [H45, H55] });
    h.anthropic.state.modelsFn = fn;
    const r = await api(h, c, "POST", REFRESH);
    assert.equal(r.status, 200, `${name} ${JSON.stringify(r.body)}`);
    assert.equal(r.body.refreshed, false, name);
    assert.equal(r.body.reason, "failed", name);
    const s = await api(h, c, "GET", MODEL);
    assert.deepEqual(
      await listedIds(h),
      [HAIKU_45, HAIKU_55],
      `${name}: the old list stays`,
    );
    assert.equal(s.body.models_refresh_error.code, code, name);
    assert.equal(s.body.refused_at, null, name);
    assert.equal(s.body.usable, true, name);
    assert.equal(s.body.refresh_due, false, `${name}: bounded`);
    assert.equal(s.body.model_for.recruit_pitch.id, HAIKU_55, name);
    const draft = await api(h, c, "POST", DRAFT, {});
    assert.equal(draft.status, 200, `${name}: drafting goes on`);
    assert.equal(
      (await api(h, c, "POST", REFRESH)).body.reason,
      "not_due",
      `${name}: not retried within the day`,
    );
  }
});

test("model list: a 401 or 403 on refresh marks the key refused, as a draft does, and keeps the list", async () => {
  for (const status of [401, 403]) {
    const { h, c } = await oldKey({ models: [H45, H55] });
    h.anthropic.state.modelsFn = () => ({
      ok: false,
      status,
      code: "authentication_error",
    });
    const r = await api(h, c, "POST", REFRESH);
    assert.equal(r.body.refreshed, false);
    assert.equal(r.body.reason, "key_refused");
    const s = await api(h, c, "GET", MODEL);
    assert.ok(s.body.refused_at, String(status));
    assert.equal(s.body.usable, false);
    assert.equal(s.body.refresh_due, false);
    assert.deepEqual(await listedIds(h), [HAIKU_45, HAIKU_55]);
    const draft = await api(h, c, "POST", DRAFT, {});
    assert.equal(draft.body.error, "model_key_refused");
    // A refused key is not read again until a leader adds one.
    h.clock.t += MODELS_REFRESH_MS;
    assert.equal((await api(h, c, "POST", REFRESH)).body.reason, "key_refused");
    assert.equal(modelsCalls(h), 2);
  }
});

test("model list: a cap a leader sets during a refresh is not written over", async () => {
  const { h, c } = await oldKey();
  h.anthropic.state.modelsFn = async () => {
    const cur = await h.ledger.modelKey("#2PQRJ8LV");
    await h.ledger.saveModelKey("#2PQRJ8LV", { ...cur, spend_cap_usd: 7 });
    return { ok: true, status: 200, models: [H45, H55, SONNET] };
  };
  assert.equal((await api(h, c, "POST", REFRESH)).body.refreshed, true);
  const stored = await h.ledger.modelKey("#2PQRJ8LV");
  assert.equal(stored.spend_cap_usd, 7);
  assert.equal(stored.models.length, 3);
});

test("model list: drafting never reads the list; a model Anthropic no longer serves is dropped at once and the next draft takes the next", async () => {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  for (let i = 0; i < 3; i += 1) await api(h, c, "POST", DRAFT, {});
  assert.equal(modelsCalls(h), 1, "only adding the key read it");
  assert.equal((await api(h, c, "GET", MODEL)).body.refresh_due, false);
  h.anthropic.state.write = (key, request) =>
    request.model === OPUS_55
      ? { ok: false, status: 404, code: "not_found_error" }
      : {
          ok: true,
          model: request.model,
          usage: { input_tokens: 700, output_tokens: 180 },
          input: { tagline: "Hi", about: "A clan.", points: [] },
        };
  const gone = await api(h, c, "POST", DRAFT, {});
  assert.equal(gone.status, 409);
  assert.equal(gone.body.error, "model_unavailable");
  assert.match(gone.body.message, /no longer serves Claude Opus 5\.5/);
  assert.equal(modelsCalls(h), 1, "the failing draft does not wait on a read");
  assert.ok(!(await listedIds(h)).includes(OPUS_55), "off the list at once");
  const s = await api(h, c, "GET", MODEL);
  assert.equal(s.body.refresh_due, true);
  assert.equal(s.body.model_for.recruit_pitch.id, SONNET_55);
  const next = await api(h, c, "POST", DRAFT, {});
  assert.equal(next.status, 200, JSON.stringify(next.body));
  assert.equal(h.anthropic.state.calls.at(-1)[2].model, SONNET_55);
});

test("model list: a 404 that empties the list leaves nothing reachable; the next use refuses before spending", async () => {
  const h = harness();
  h.anthropic.state.models = [H45, O55];
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  h.anthropic.state.write = () => ({
    ok: false,
    status: 404,
    code: "not_found_error",
  });
  const gone = await api(h, c, "POST", DRAFT, {});
  assert.equal(gone.body.error, "model_unavailable");
  assert.deepEqual(await listedIds(h), [HAIKU_45]);
  const writes = () =>
    h.anthropic.state.calls.filter(([t]) => t === "write").length;
  const sent = writes();
  const today = (await api(h, c, "GET", MODEL)).body.uses.today;
  const again = await api(h, c, "POST", DRAFT, {});
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "model_unavailable");
  assert.equal(writes(), sent, "not sent again");
  assert.equal((await api(h, c, "GET", MODEL)).body.uses.today, today);
  // Emptied outright: known, and reaches nothing.
  await h.ledger.saveModelKey("#2PQRJ8LV", {
    ...(await h.ledger.modelKey("#2PQRJ8LV")),
    models: [],
  });
  assert.equal(
    (await api(h, c, "GET", MODEL)).body.model_for.recruit_pitch,
    null,
  );
  assert.equal(
    (await api(h, c, "POST", DRAFT, {})).body.error,
    "model_unavailable",
  );
  assert.equal(writes(), sent);
});

test("model list: only leaders refresh, and only while the key's owner leads", async () => {
  const { h } = await oldKey();
  h.mcp.state.roster = rosterBody([
    { player_tag: ADA, name: "Ada", role: "member" },
    { player_tag: BEA, name: "Bea", role: "coLeader" },
  ]);
  h.mcp.state.players = [
    player({ player_tag: BEA, name: "Bea", clan_role: "coLeader" }),
  ];
  const bea = await signedIn(h);
  const r = await api(h, bea, "POST", REFRESH);
  assert.equal(r.body.refreshed, false);
  assert.equal(r.body.reason, "owner_unconfirmed");
  assert.equal(modelsCalls(h), 1);
  h.mcp.state.players = [
    player({ player_tag: BEA, name: "Bea", clan_role: "elder" }),
  ];
  const elder = await signedIn(h);
  assert.equal((await api(h, elder, "POST", REFRESH)).status, 403);
});

// ------------------------------------------------- spend and the monthly cap

test("model spend: each use is priced at list rates; the month is summed", async () => {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  await api(h, c, "POST", DRAFT, {});
  await api(h, c, "POST", DRAFT, {});
  const s = await api(h, c, "GET", MODEL);
  // 700 in and 180 out on Opus 5.5 ($4 / $20 per million): $0.0064 each.
  assert.equal(s.body.uses.recent[0].model, OPUS_55);
  assert.equal(s.body.uses.recent[0].spend_usd, 0.0064);
  assert.equal(s.body.uses.month.spend_usd, 0.0128);
  assert.equal(s.body.uses.month.spend_estimated, false);
  assert.equal(s.body.spend_cap_usd, null);
  assert.equal(s.body.cap_reached, false);
  assert.match(s.body.prices_as_of, /^\d{4}-\d{2}-\d{2}$/);
});

test("model spend: drafting stops at the clan's monthly cap, until it is raised, removed or the month turns", async () => {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  const set = await api(h, c, "PUT", MODEL, { spend_cap_usd: 0.02 });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.spend_cap_usd, 0.02);
  // $0.0064 a draft: the fourth starts at $0.0192, still under the cap.
  for (let i = 0; i < 4; i += 1)
    assert.equal((await api(h, c, "POST", DRAFT, {})).status, 200, `#${i}`);
  const writes = () =>
    h.anthropic.state.calls.filter(([t]) => t === "write").length;
  assert.equal(writes(), 4);
  const stopped = await api(h, c, "POST", DRAFT, {});
  assert.equal(stopped.status, 429);
  assert.equal(stopped.body.error, "model_spend_cap");
  assert.equal(writes(), 4, "a capped draft never reaches Anthropic");
  const s = await api(h, c, "GET", MODEL);
  assert.equal(s.body.cap_reached, true);
  assert.equal(s.body.uses.month.count, 4, "a capped draft is not a use");
  assert.equal(s.body.spend_cap_set_by_name, "Ada");
  // Raised, it drafts again; removed, it drafts again.
  await api(h, c, "PUT", MODEL, { spend_cap_usd: 1 });
  assert.equal((await api(h, c, "POST", DRAFT, {})).status, 200);
  await api(h, c, "PUT", MODEL, { spend_cap_usd: 0.01 });
  assert.equal((await api(h, c, "POST", DRAFT, {})).status, 429);
  await api(h, c, "PUT", MODEL, { spend_cap_usd: null });
  assert.equal((await api(h, c, "GET", MODEL)).body.spend_cap_usd, null);
  assert.equal((await api(h, c, "POST", DRAFT, {})).status, 200);
  // A new month (UTC) starts from nothing under the same cap.
  await api(h, c, "PUT", MODEL, { spend_cap_usd: 0.01 });
  assert.equal((await api(h, c, "POST", DRAFT, {})).status, 429);
  h.clock.t = Date.parse("2026-10-01T00:00:00Z");
  assert.equal((await api(h, c, "POST", DRAFT, {})).status, 200);
});

test("model spend: a cap is dollars to the cent, set by leaders, and outlives the key", async () => {
  const h = harness();
  const c = await signedIn(h);
  assert.equal(
    (await api(h, c, "PUT", MODEL, { spend_cap_usd: 5 })).body.error,
    "no_model_key",
  );
  await api(h, c, "PUT", MODEL, { key: GOOD });
  for (const bad of [0, -1, 0.001, 1000.01, "five", true, {}])
    assert.equal(
      (await api(h, c, "PUT", MODEL, { spend_cap_usd: bad })).body.error,
      "bad_spend_cap",
      JSON.stringify(bad),
    );
  for (const good of [0.29, "2.50", 1000]) {
    const r = await api(h, c, "PUT", MODEL, { spend_cap_usd: good });
    assert.equal(r.status, 200, JSON.stringify(good));
    assert.equal(r.body.spend_cap_usd, Number(good));
  }
  await api(h, c, "PUT", MODEL, { spend_cap_usd: 3 });
  // Replacing the key keeps the clan's cap.
  await api(h, c, "PUT", MODEL, { key: OTHER });
  assert.equal((await api(h, c, "GET", MODEL)).body.spend_cap_usd, 3);
  // An elder cannot see or change it.
  h.mcp.state.players = [
    player({ player_tag: BEA, name: "Bea", clan_role: "elder" }),
  ];
  const elder = await signedIn(h);
  assert.equal(
    (await api(h, elder, "PUT", MODEL, { spend_cap_usd: 100 })).status,
    403,
  );
  assert.equal((await h.ledger.modelKey("#2PQRJ8LV")).spend_cap_usd, 3);
});

test("model: a draft that outlasts the request is collected by its id, once recorded; past its time it counts at its estimate (#455)", async () => {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  const card = {
    card_id: "promo1",
    clan_tag: "#2PQRJ8LV",
    type: "promotion",
    status: "proposed",
    player_tag: BEA,
    player_name: "Secretname",
    evidence: {
      message: { title: "New Elder", body: "Secretname is now an Elder." },
    },
  };
  await h.ledger.putCard("#2PQRJ8LV", card);
  await h.ledger.putCard("#2PQRJ8LV", { ...card, card_id: "promo2" });
  h.anthropic.state.deferred = true;
  const path = "/api/clans/2PQRJ8LV/actions/promo1/draft";
  const started = await api(h, c, "POST", path, {});
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const id = started.body.pending;
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(started.body.draft_context_version, draftContextVersion(card));
  // Asked again before it lands: still pending, nothing spent twice.
  const again = await api(h, c, "POST", path, { pending: id });
  assert.equal(again.body.pending, id);
  // Only the leader who started it collects it.
  h.mcp.state.players = [
    player({ player_tag: BEA, name: "Bea", clan_role: "coLeader" }),
  ];
  h.mcp.state.roster = rosterBody([
    { player_tag: ADA, name: "Ada", role: "leader" },
    { player_tag: BEA, name: "Bea", role: "coLeader" },
  ]);
  const bea = await signedIn(h);
  assert.equal(
    (await api(h, bea, "POST", path, { pending: id })).body.error,
    "not_yours",
  );
  assert.equal(
    (
      await api(h, bea, "POST", path, {
        pending: "00000000-0000-4000-8000-999999999999",
      })
    ).body.error,
    "no_pending_draft",
  );
  h.mcp.state.players = [player()];
  h.anthropic.state.replies = {
    [id]: {
      ok: true,
      model: OPUS_55,
      usage: { input_tokens: 900, output_tokens: 60 },
      input: { title: "New Elder", body: "Cheers, Secretname!" },
    },
  };
  const done = await api(h, c, "POST", path, { pending: id });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.body, "Cheers, Secretname!");
  const writes = h.anthropic.state.calls.filter(([t]) => t === "write");
  assert.equal(writes.length, 1, "one request to the model");
  let s = await api(h, c, "GET", MODEL);
  assert.equal(s.body.uses.recent.length, 1);
  assert.equal(s.body.uses.recent[0].ok, true);
  assert.equal(s.body.uses.recent[0].input_tokens, 900);
  assert.equal(s.body.uses.recent[0].spend_estimated, false);
  // A draft that never lands: unknown past its time, and counted at its
  // reservation's estimate, never free.
  h.clock.t += 60_000;
  const lost = await api(
    h,
    c,
    "POST",
    "/api/clans/2PQRJ8LV/actions/promo2/draft",
    {},
  );
  const lostId = lost.body.pending;
  assert.ok(lostId);
  h.clock.t += PENDING_MS + 1;
  const unknown = await api(
    h,
    c,
    "POST",
    "/api/clans/2PQRJ8LV/actions/promo2/draft",
    { pending: lostId },
  );
  assert.equal(unknown.status, 502);
  assert.equal(unknown.body.error, "model_failed");
  assert.match(unknown.body.message, /outcome is unknown/);
  s = await api(h, c, "GET", MODEL);
  const last = s.body.uses.recent[0];
  assert.equal(last.code, "outcome_unknown");
  assert.equal(last.input_tokens, null);
  assert.ok(last.spend_usd > 0, "an unknown outcome is priced");
  assert.equal(last.spend_estimated, true);
  assert.equal(s.body.uses.month.spend_estimated, true);
  assert.ok(s.body.uses.month.spend_usd > s.body.uses.recent[1].spend_usd);
});

test("model: a started draft settles on the key that sent it; a key replaced or removed since is never marked (#492)", async () => {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  const card = {
    card_id: "promo1",
    clan_tag: "#2PQRJ8LV",
    type: "promotion",
    status: "proposed",
    player_tag: BEA,
    player_name: "Secretname",
    evidence: {
      message: { title: "New Elder", body: "Secretname is now an Elder." },
    },
  };
  await h.ledger.putCard("#2PQRJ8LV", card);
  h.anthropic.state.deferred = true;
  const path = "/api/clans/2PQRJ8LV/actions/promo1/draft";
  const first = (await api(h, c, "POST", path, {})).body.pending;
  assert.ok(first);
  // A leader puts in a new key while the old key's request is out, and
  // the old request comes back refused: the new key is not marked.
  h.clock.t += 1000;
  await api(h, c, "PUT", MODEL, { key: OTHER });
  h.anthropic.state.replies = { [first]: { ok: false, status: 401 } };
  const refused = await api(h, c, "POST", path, { pending: first });
  assert.equal(refused.body.error, "model_key_refused");
  const after = await h.ledger.modelKey("#2PQRJ8LV");
  assert.equal(after.refused_at ?? null, null, "the new key is untouched");
  assert.equal((await api(h, c, "GET", MODEL)).body.refused_at, null);
  // The key is removed while a request is out: its paid answer is still
  // collected and recorded.
  const second = (await api(h, c, "POST", path, {})).body.pending;
  assert.ok(second);
  await api(h, c, "DELETE", MODEL);
  h.anthropic.state.replies = {
    [second]: {
      ok: true,
      model: OPUS_55,
      usage: { input_tokens: 900, output_tokens: 60 },
      input: { title: "New Elder", body: "Cheers, Secretname!" },
    },
  };
  const done = await api(h, c, "POST", path, { pending: second });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.body, "Cheers, Secretname!");
  const uses = await h.ledger.modelCalls(
    "#2PQRJ8LV",
    new Date(h.clock.t).toISOString().slice(0, 7),
  );
  const call = uses.find((u) => u.request_id === second);
  assert.equal(call.ok, true);
  assert.equal(call.input_tokens, 900);
});
