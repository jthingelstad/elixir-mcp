/**
 * The clan's activity in its own Discord channel (2026-10-10), over the
 * real handler: leaders alone connect it; the policy's defaults and its
 * ruled-out category hold; the editor needs the clan's own key; and the
 * model's unattended use is bounded, recorded and never throws for the
 * clan's state. Anthropic and the store are scripted; no key or webhook
 * here is real.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "@elixir-mcp/clan/handler.mjs";
import { createMemoryLedger } from "@elixir-mcp/clan-state";
import {
  editorPreviewRequest,
  editorRequest,
  editorStory,
} from "@elixir-mcp/clan-engine";
import { createActivityService } from "@elixir-mcp/clan/manage/activity.mjs";
import { fetchRoster } from "@elixir-mcp/clan/manage/service.mjs";
import {
  ACTIVITY_USES_PER_DAY,
  createModelService,
} from "@elixir-mcp/clan/manage/model.mjs";
import {
  cookieHeader,
  createTestAccount,
  fakeMcp,
  ledgerWithPolicy,
  player,
  req,
  rosterBody,
  signIn,
} from "./fakes.mjs";

const GOOD = `sk-ant-api03-${"a".repeat(40)}WXYZ`;
const ADA = "#20QQL8CCRU";
const TAG = "#2PQRJ8LV";
const PATH = "/api/clans/2PQRJ8LV/activity-discord";
const MODEL = "/api/clans/2PQRJ8LV/model";

function fakeAnthropic() {
  const state = { calls: [], write: null };
  return {
    state,
    async models() {
      return {
        ok: true,
        models: state.models ?? [
          { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
          { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
          { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
          { id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
        ],
      };
    },
    async write(key, request) {
      state.calls.push(["write", key, request]);
      if (state.write) return state.write(key, request);
      return {
        ok: true,
        model: request.model,
        usage: { input_tokens: 300, output_tokens: 60 },
        input: { posts: [{ key: "tl_1", text: "Ada joined!" }] },
      };
    },
    async turn(key, request) {
      state.calls.push(["turn", key, request]);
      const usage = { input_tokens: 2000, output_tokens: 150 };
      // A first round looks something up; a later one answers.
      if (request.messages.length === 1)
        return {
          ok: true,
          model: request.model,
          usage,
          calls: [{ id: "c1", name: "channel_recent", input: {} }],
          content: [
            { type: "tool_use", id: "c1", name: "channel_recent", input: {} },
          ],
        };
      return {
        ok: true,
        model: request.model,
        usage,
        answer: { posts: [{ keys: ["tl_1"], text: "Ada joined!" }], skips: [] },
      };
    },
  };
}

/** The connection store as syndication keeps it, in memory. */
function fakeStore() {
  const rows = new Map();
  return {
    rows,
    async read(tag) {
      return rows.get(tag) ?? null;
    },
    async save(tag, change, { who }) {
      const was = rows.get(tag);
      if (change.url === "bad") return { error: "webhook_invalid" };
      if (!was && !change.url) return { error: "webhook_required" };
      const categories = { ...(was?.categories ?? {}) };
      for (const [k, v] of Object.entries(change.categories ?? {}))
        if (v === null) delete categories[k];
        else categories[k] = v;
      const row = {
        enabled: change.enabled ?? was?.enabled ?? true,
        webhook: "discord.com/api/webhooks/1…",
        categories,
        rewrite: change.rewrite ?? was?.rewrite ?? false,
        voice: change.voice ?? was?.voice ?? "",
        set_by: who.player_tag,
      };
      rows.set(tag, row);
      return { view: row };
    },
    async remove(tag) {
      return rows.delete(tag);
    },
    previews: [],
    async preview(tag, { voice }) {
      this.previews.push({ tag, voice });
      if (!rows.get(tag)) return { empty: true, reason: "not_connected" };
      return {
        empty: false,
        posts: STORIES.map((st) => ({
          key: st.key,
          kind: st.kind,
          at: "2026-10-10T11:00:00Z",
          elixir: st.render,
        })),
        stories: STORIES,
        request: editorPreviewRequest({
          context: `${CONTEXT}\nHow its leaders want it to sound: ${voice ?? "saved"}`,
          stories: STORIES,
        }),
      };
    },
  };
}

function harness({
  policy = { war_intent: "not_participating" },
  role = "leader",
  ratings = null,
} = {}) {
  const clock = { t: Date.parse("2026-10-10T12:00:00Z") };
  const now = () => clock.t;
  const ledger = createMemoryLedger();
  if (policy) ledgerWithPolicy(ledger, TAG, policy);
  const mcp = fakeMcp({
    players: [player({ clan_role: role })],
    roster: rosterBody([
      { player_tag: ADA, name: "Ada", role, trophies: 9000 },
    ]),
  });
  const anthropic = fakeAnthropic();
  const model = createModelService({
    ledger,
    anthropic,
    secret: "test-secret",
    rosterFor: (token, clanTag) => fetchRoster(mcp, token, clanTag),
    now,
  });
  const store = fakeStore();
  const handler = createHandler({
    mcp,
    ...createTestAccount(),
    model,
    activity: createActivityService({ ledger, store, model, ratings }),
    appUrl: "https://elixir.test/clan",
    elixirUrl: "https://elixir.test",
    now,
    log: { info() {}, warn() {}, error() {} },
  });
  return { clock, ledger, anthropic, model, store, handler };
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

test("activity: the policy sets the defaults and rules war out; a leader's switch holds, null returns to the default", async () => {
  const h = harness();
  const c = await signedIn(h);
  const view = await api(h, c, "GET", PATH);
  assert.equal(view.status, 200, JSON.stringify(view.body));
  assert.equal(view.body.connection, null);
  assert.equal(view.body.policy.ready, true);
  assert.deepEqual(view.body.policy.defaults, {
    members: true,
    milestones: true,
    war: false,
  });
  assert.match(view.body.policy.ruled_out.war, /does not take part/);
  assert.deepEqual(
    view.body.categories.map((x) => x.key),
    ["members", "milestones", "war"],
  );
  assert.equal(view.body.editor_runs_per_day, ACTIVITY_USES_PER_DAY);

  const none = await api(h, c, "PUT", PATH, { enabled: true });
  assert.equal(none.status, 400);
  assert.equal(none.body.error, "webhook_required");
  const bad = await api(h, c, "PUT", PATH, { url: "bad" });
  assert.equal(bad.body.error, "webhook_invalid");

  const on = await api(h, c, "PUT", PATH, { url: "https://discord.com/x" });
  assert.equal(on.status, 200);
  assert.deepEqual(on.body.in_effect, {
    members: true,
    milestones: true,
    war: false,
  });
  const war = await api(h, c, "PUT", PATH, { categories: { war: true } });
  assert.equal(war.status, 409);
  assert.equal(war.body.error, "ruled_out");
  const off = await api(h, c, "PUT", PATH, {
    categories: { milestones: false },
  });
  assert.equal(off.body.in_effect.milestones, false);
  const back = await api(h, c, "PUT", PATH, {
    categories: { milestones: null },
  });
  assert.equal(back.body.in_effect.milestones, true);
  const unknown = await api(h, c, "PUT", PATH, { categories: { chat: true } });
  assert.equal(unknown.status, 400);

  const gone = await api(h, c, "DELETE", PATH);
  assert.equal(gone.body.connection, null);
});

test("activity: no policy, nothing is on", async () => {
  const h = harness({ policy: null });
  const c = await signedIn(h);
  const on = await api(h, c, "PUT", PATH, { url: "https://discord.com/x" });
  assert.equal(on.body.policy.ready, false);
  assert.deepEqual(on.body.in_effect, {
    members: false,
    milestones: false,
    war: false,
  });
});

test("activity: the rewrite asks for the clan's key first; the voice is tidied", async () => {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", PATH, { url: "https://discord.com/x" });
  const before = await api(h, c, "GET", PATH);
  assert.deepEqual(before.body.model, {
    available: true,
    set: false,
    refused: false,
    name: "Claude Sonnet 5.5",
  });
  const nokey = await api(h, c, "PUT", PATH, { rewrite: true });
  assert.equal(nokey.status, 409);
  assert.equal(nokey.body.error, "no_model_key");
  assert.match(nokey.body.message, /The clan's own model/);

  assert.equal((await api(h, c, "PUT", MODEL, { key: GOOD })).status, 200);
  const on = await api(h, c, "PUT", PATH, {
    rewrite: true,
    voice: "  Loud <and> proud @here https://x.example ",
  });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.equal(on.body.connection.rewrite, true);
  assert.equal(on.body.connection.voice, "Loud and proud here");
  assert.ok(!JSON.stringify(on.body).includes(GOOD));
});

test("activity: only a leader or co-leader", async () => {
  const h = harness({ role: "elder" });
  const c = await signedIn(h);
  const r = await api(h, c, "GET", PATH);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "leaders_only");
});

test("activity: a leader rates a post of the channel; the page shows their ratings; an elder may not", async () => {
  const POST = "aaaaaaaa-0000-4000-8000-000000000001";
  const rated = [];
  const ratings = {
    async rate(input) {
      rated.push(input);
      return { ok: true, feedback_id: "7", rating: input.rating };
    },
    async mine(ids) {
      return ids.includes(POST) ? { [POST]: { rating: "down" } } : {};
    },
  };
  const h = harness({ ratings });
  const c = await signedIn(h);
  await api(h, c, "PUT", PATH, { url: "https://discord.com/api/webhooks/1/x" });
  const saved = await h.store.read(TAG);
  saved.deliveries = [
    { at: "2026-10-10T11:00:00Z", outcome: "posted", ledger_id: POST },
  ];
  const view = await api(h, c, "GET", PATH);
  assert.deepEqual(view.body.ratings, { [POST]: { rating: "down" } });
  const r = await api(h, c, "POST", `${PATH}/rate`, {
    ledger_id: POST,
    rating: "down",
    note: "Too long.",
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(rated, [
    {
      feature: "clan_activity",
      clanTag: TAG,
      postId: POST,
      rating: "down",
      note: "Too long.",
    },
  ]);

  const elder = harness({ role: "elder", ratings });
  const e = await api(elder, await signedIn(elder), "POST", `${PATH}/rate`, {
    ledger_id: POST,
    rating: "up",
  });
  assert.equal(e.status, 403);
  assert.equal(rated.length, 1);

  const none = harness();
  const n = await api(none, await signedIn(none), "POST", `${PATH}/rate`, {
    ledger_id: POST,
    rating: "up",
  });
  assert.equal(n.status, 503);
});

const CONTEXT = "THE CLAN\nName: Example Clan";
const story = (key, kind, facts, render) => ({
  ...editorStory({
    key,
    revision: 1,
    story: { key, items: [{ id: key, kind, revision: 1, facts }] },
    render,
  }),
  kind,
});
const STORIES = [
  story("tl_1", "member_joined", { name: "Ada" }, "Ada joined Example Clan."),
  story(
    "tl_2",
    "trophy_milestone",
    { name: "Bo", trophies: 9000 },
    "Bo reached 9,000 trophies.",
  ),
  story("tl_3", "member_joined", { name: "Cy" }, "Cy joined Example Clan."),
  story("tl_4", "member_left", { name: "Di" }, "Di departed Example Clan."),
  story(
    "tl_5",
    "career_wins_step",
    { name: "Eve", wins: 1000, step: 1000 },
    "Eve passed 1,000 career wins.",
  ),
];
const request = () =>
  editorPreviewRequest({ context: CONTEXT, stories: STORIES.slice(0, 1) });

test("writeUnattended: recorded apart from the drafts, under its own day's cap", async () => {
  const h = harness();
  const c = await signedIn(h);
  const leads = async () => true;
  const nokey = await h.model.writeUnattended(TAG, request(), {
    ownerLeads: leads,
  });
  assert.deepEqual(nokey, { ok: false, code: "no_model_key" });
  await api(h, c, "PUT", MODEL, { key: GOOD });

  const r = await h.model.writeUnattended(TAG, request(), {
    ownerLeads: leads,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.input.posts[0], { key: "tl_1", text: "Ada joined!" });
  const [, key, sent] = h.anthropic.state.calls.at(-1);
  assert.equal(key, GOOD);
  // The rewrites run on Elixir Clan's model for them, Sonnet 5.5.
  assert.equal(sent.model, "claude-sonnet-5-5");
  const [call] = await h.ledger.modelCalls(TAG);
  assert.equal(call.model, "claude-sonnet-5-5");
  assert.equal(call.purpose, "discord_activity");
  assert.equal(call.by, null);
  assert.equal(call.ok, true);
  assert.equal(call.input_tokens, 300);

  const status = await api(h, c, "GET", MODEL);
  assert.equal(status.body.uses.today, 0, "not a leader's draft");
  assert.equal(status.body.uses.activity_today, 1);

  for (let i = 1; i < ACTIVITY_USES_PER_DAY; i += 1)
    await h.model.writeUnattended(TAG, request(), { ownerLeads: leads });
  const capped = await h.model.writeUnattended(TAG, request(), {
    ownerLeads: leads,
  });
  assert.deepEqual(capped, { ok: false, code: "model_daily_limit" });
  h.clock.t += 86_400_000;
  assert.equal(
    (await h.model.writeUnattended(TAG, request(), { ownerLeads: leads })).ok,
    true,
    "a new day",
  );
});

test("writeUnattended: the editor's rounds are one run against the day's cap, each round recorded", async () => {
  const h = harness();
  const c = await signedIn(h);
  const leads = async () => true;
  await api(h, c, "PUT", MODEL, { key: GOOD });
  const first = editorRequest({
    context: CONTEXT,
    stories: [{ key: "tl_1", packet: "STORY tl_1 (member joined)" }],
  });
  const looked = await h.model.writeUnattended(TAG, first, {
    ownerLeads: leads,
    run: "clan-2PQRJ8LV.1",
    round: 1,
  });
  assert.equal(looked.ok, true);
  assert.deepEqual(looked.calls, [
    { id: "c1", name: "channel_recent", input: {} },
  ]);
  const [kind, , sent] = h.anthropic.state.calls.at(-1);
  assert.equal(kind, "turn");
  assert.equal(sent.model, "claude-sonnet-5-5");
  assert.equal(sent.answer, "write_posts");
  assert.ok(sent.tools.every((t) => t.strict === true));
  const answered = await h.model.writeUnattended(
    TAG,
    {
      ...first,
      messages: [
        ...first.messages,
        { role: "assistant", content: looked.content },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "c1", content: "-" }],
        },
      ],
    },
    { ownerLeads: leads, run: "clan-2PQRJ8LV.1", round: 2 },
  );
  assert.deepEqual(answered.answer.posts, [
    { keys: ["tl_1"], text: "Ada joined!" },
  ]);
  const calls = await h.ledger.modelCalls(TAG);
  assert.deepEqual(
    calls
      .map((x) => [x.run, x.round, x.ok, x.input_tokens])
      .sort((a, b) => a[1] - b[1]),
    [
      ["clan-2PQRJ8LV.1", 1, true, 2000],
      ["clan-2PQRJ8LV.1", 2, true, 2000],
    ],
  );
  const status = await api(h, c, "GET", MODEL);
  assert.equal(status.body.uses.activity_today, 1, "two rounds, one run");

  // A day's cap of runs: a new run past it is refused; a run under way
  // finishes its rounds.
  for (let i = 1; i < ACTIVITY_USES_PER_DAY; i += 1)
    await h.model.writeUnattended(TAG, first, {
      ownerLeads: leads,
      run: `clan-2PQRJ8LV.r${i}`,
      round: 1,
    });
  assert.deepEqual(
    await h.model.writeUnattended(TAG, first, {
      ownerLeads: leads,
      run: "clan-2PQRJ8LV.next",
      round: 1,
    }),
    { ok: false, code: "model_daily_limit" },
  );
  assert.equal(
    (
      await h.model.writeUnattended(TAG, first, {
        ownerLeads: leads,
        run: "clan-2PQRJ8LV.r1",
        round: 2,
      })
    ).ok,
    true,
    "its next round",
  );
});

test("writeUnattended: Sonnet 5.5 out of reach takes the next 5.5 model; none in reach keeps Elixir's own lines", async () => {
  const h = harness();
  const c = await signedIn(h);
  const leads = async () => true;
  await api(h, c, "PUT", MODEL, { key: GOOD });
  const stored = await h.ledger.modelKey(TAG);
  await h.ledger.saveModelKey(TAG, {
    ...stored,
    models: stored.models.filter((m) => m.id !== "claude-sonnet-5-5"),
  });
  assert.equal(
    (await h.model.writeUnattended(TAG, request(), { ownerLeads: leads })).ok,
    true,
  );
  assert.equal(h.anthropic.state.calls.at(-1)[2].model, "claude-opus-5-5");
  // Only an older generation in reach: refused before anything is sent,
  // and the caller posts Elixir's own lines.
  await h.ledger.saveModelKey(TAG, {
    ...stored,
    models: [{ id: "claude-sonnet-5", name: "Claude Sonnet 5" }],
  });
  const writes = h.anthropic.state.calls.length;
  assert.deepEqual(
    await h.model.writeUnattended(TAG, request(), { ownerLeads: leads }),
    { ok: false, code: "model_unavailable" },
  );
  assert.equal(h.anthropic.state.calls.length, writes, "never sent");
  assert.equal((await h.ledger.modelCalls(TAG)).length, 1, "not a use");
});

test("writeUnattended: the leaders' monthly cap stops it too", async () => {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  const leads = async () => true;
  assert.equal(
    (await h.model.writeUnattended(TAG, request(), { ownerLeads: leads })).ok,
    true,
  );
  const stored = await h.ledger.modelKey(TAG);
  await h.ledger.saveModelKey(TAG, { ...stored, spend_cap_usd: 0.000001 });
  const capped = await h.model.writeUnattended(TAG, request(), {
    ownerLeads: leads,
  });
  assert.deepEqual(capped, { ok: false, code: "model_spend_cap" });
  assert.equal(
    (await h.ledger.modelCalls(TAG)).length,
    1,
    "a capped rewrite is not a use",
  );
});

test("writeUnattended: an owner who left, or one unconfirmed, is not used; Anthropic's refusal marks the key", async () => {
  const h = harness();
  const c = await signedIn(h);
  await api(h, c, "PUT", MODEL, { key: GOOD });
  assert.deepEqual(
    await h.model.writeUnattended(TAG, request(), {
      ownerLeads: async () => false,
    }),
    { ok: false, code: "model_key_owner_left" },
  );
  assert.deepEqual(
    await h.model.writeUnattended(TAG, request(), {
      ownerLeads: async () => null,
    }),
    { ok: false, code: "model_owner_unconfirmed" },
  );
  assert.equal(
    h.anthropic.state.calls.filter((x) => x[0] === "write").length,
    0,
  );

  h.anthropic.state.write = async () => {
    throw new Error("socket");
  };
  const unknown = await h.model.writeUnattended(TAG, request(), {
    ownerLeads: async () => true,
  });
  // Sent with no answer: about what it may have cost, by the estimate
  // (the quality ledger, 0222).
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "outcome_unknown");
  assert.equal(unknown.cost.estimated, true);
  assert.ok(unknown.cost.usd > 0);

  h.anthropic.state.write = async () => ({ ok: false, status: 401 });
  const refused = await h.model.writeUnattended(TAG, request(), {
    ownerLeads: async () => true,
  });
  assert.deepEqual(refused, { ok: false, code: "model_key_refused" });
  assert.equal((await h.model.summary(TAG)).refused, true);
  assert.deepEqual(
    await h.model.writeUnattended(TAG, request(), {
      ownerLeads: async () => true,
    }),
    { ok: false, code: "model_key_refused" },
  );

  await assert.rejects(
    h.model.writeUnattended(
      TAG,
      { ...request(), purpose: "recruit_pitch" },
      { ownerLeads: async () => true },
    ),
    (e) => e.code === "unknown_purpose",
  );
});

test("preview: a leader's own use, counted with the drafts; each story comes back posted, told in another's post, skipped or kept with why, and nothing is posted", async () => {
  const h = harness();
  const c = await signedIn(h);
  const PREVIEW = `${PATH}/preview`;
  const nothing = await api(h, c, "POST", PREVIEW, {});
  assert.equal(nothing.status, 200);
  assert.deepEqual(nothing.body, {
    empty: true,
    reason: "not_connected",
    posts: [],
  });
  await api(h, c, "PUT", PATH, { url: "https://discord.com/x" });
  const nokey = await api(h, c, "POST", PREVIEW, {});
  assert.equal(nokey.status, 409);
  assert.equal(nokey.body.error, "no_model_key");
  await api(h, c, "PUT", MODEL, { key: GOOD });
  h.anthropic.state.write = (_key, req) => ({
    ok: true,
    model: req.model,
    usage: { input_tokens: 400, output_tokens: 80 },
    input: {
      posts: [
        { keys: ["tl_3", "tl_1"], text: "Welcome aboard, Ada and Cy! 🎉" },
        // A number the packet never held is refused, as in the channel.
        { keys: ["tl_2"], text: "Bo hit 9,500 trophies!" },
      ],
      skips: [
        { key: "tl_5", reason: "A small step." },
        // A departure is always told.
        { key: "tl_4", reason: "Old news." },
      ],
    },
  });
  const r = await api(h, c, "POST", PREVIEW, { voice: "  Hype <and> short " });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(h.store.previews.at(-1).voice, "Hype and short");
  assert.equal(r.body.model, "claude-sonnet-5-5");
  assert.deepEqual(r.body.posts[0], {
    key: "tl_1",
    kind: "member_joined",
    at: "2026-10-10T11:00:00Z",
    elixir: "Ada joined Example Clan.",
    post: "Welcome aboard, Ada and Cy! 🎉",
    with: ["tl_3"],
    told_in: null,
    skipped: null,
    refused: null,
  });
  assert.deepEqual(
    r.body.posts
      .slice(1)
      .map((p) => [p.key, p.post, p.told_in, p.skipped, p.refused]),
    [
      ["tl_2", null, null, null, "number_invented"],
      ["tl_3", null, "tl_1", null, null],
      ["tl_4", null, null, null, "skip_refused"],
      ["tl_5", null, null, "A small step.", null],
    ],
  );
  const [kind, , sent] = h.anthropic.state.calls.at(-1);
  assert.equal(kind, "write", "one request, no lookups");
  assert.equal(sent.model, "claude-sonnet-5-5");
  assert.equal(sent.effort, "low");
  assert.match(JSON.stringify(sent), /Hype and short/);
  // Counted as a leader's use, apart from the channel's own runs.
  const [call] = await h.ledger.modelCalls(TAG);
  assert.equal(call.purpose, "discord_activity");
  assert.equal(call.preview, true);
  assert.equal(call.by, ADA);
  const status = await api(h, c, "GET", MODEL);
  assert.equal(status.body.uses.today, 1);
  assert.equal(status.body.uses.activity_today, 0);
  assert.equal(status.body.uses.recent[0].preview, true);
});

test("preview: only a leader or co-leader", async () => {
  const h = harness({ role: "elder" });
  const c = await signedIn(h);
  const r = await api(h, c, "POST", `${PATH}/preview`, {});
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "leaders_only");
  assert.equal(h.store.previews.length, 0);
});
