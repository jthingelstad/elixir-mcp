/**
 * A clan's activity in its own Discord channel (2026-10-10): connected
 * with a hello, posted from the moment it was turned on, by the
 * categories in effect, a departure edited (never posted again) when a
 * leader says it was a kick, the clan's model rewriting lines it may and
 * Elixir's own words where it may not, woken by the clan's tags, and off
 * when Discord says the webhook is gone. On a scratch database (golden
 * rule 9).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import {
  validateTimelineDiscordMessage,
  webhookFingerprint,
} from "@elixir-mcp/contracts";
import { createBox } from "../../clan/src/sealed.mjs";
import { emitEvent } from "../../ingest/src/events.mjs";
import {
  CLAN_ACTIVITY_PURPOSE,
  clanActivityRowView,
  clanActivitySeal,
  clanChannelsInTimeline,
  clanEditorPreview,
  clansToWake,
  readClanActivity,
  removeClanActivity,
  saveClanActivity,
  syncClan,
  wakeSyndication,
} from "../src/index.mjs";

const CLAN = "#J2RGCRVG";
const JOINER = "#PYL0Q2G8";
const LEAVER = "#PYL0Q2G9";
const STAYER = "#PYL0Q2GR";
const HOOK = `https://discord.com/api/webhooks/123456789012345678/${"b".repeat(68)}`;
const HOOK2 = `https://discord.com/api/webhooks/223456789012345678/${"c".repeat(68)}`;
const T = Date.parse("2026-10-05T12:00:00Z");
const H = 3_600_000;
const MIN = 60_000;
const at = (ms) => new Date(ms).toISOString();
const { seal, open } = clanActivitySeal(
  createBox("clan-activity-test-secret", CLAN_ACTIVITY_PURPOSE),
);
const WHO = { player_tag: STAYER, name: "Stayer" };
const PARTICIPATING = { values: { war_intent: "participating" } };

let ctx;
let db;
let policy = PARTICIPATING;
const policyFor = async () => policy;

function recorder() {
  const sent = [];
  const outbox = async (lane, message, opts = {}) => {
    sent.push({ lane, message, opts });
  };
  return { sent, outbox };
}

const sync = (now, extra = {}) => {
  const r = recorder();
  return syncClan(db, CLAN, {
    outbox: r.outbox,
    policyFor,
    now,
    ...extra,
  }).then((out) => ({ ...out, sent: r.sent }));
};

async function clanEvent(type, player, ms, extra = {}) {
  await db.query(
    `insert into clan_event (clan_tag, event_type, timing, window_start, window_end, player_tag, role_before, role_after)
     values ($1, $2, 'estimated', $3, $4, $5, $6, $7)`,
    [
      CLAN,
      type,
      at(ms - 10 * MIN),
      at(ms),
      player,
      extra.before ?? null,
      extra.after ?? null,
    ],
  );
}

before(async () => {
  ctx = await scratchDb("clan_activity");
  db = ctx.db;
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'POAP KINGS')`,
    [CLAN],
  );
  for (const [tag, name] of [
    [JOINER, "Joiner"],
    [LEAVER, "Le_aver"],
    [STAYER, "Stayer"],
  ])
    await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
      tag,
      name,
    ]);
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, role, joined_observed_at)
     values ($1, $2, 'member', $3), ($1, $4, 'leader', $3)`,
    [CLAN, LEAVER, at(T - 60 * 24 * H), STAYER],
  );
});

after(async () => ctx?.drop());

test("connecting seals the webhook to its channel and says hello; nothing earlier is posted", async () => {
  // Something from before the connection.
  await clanEvent("member_joined", JOINER, T - 2 * H);
  const { sent, outbox } = recorder();
  const r = await saveClanActivity(
    db,
    CLAN,
    { url: HOOK },
    { seal, outbox, who: WHO, clanName: "POAP KINGS", now: T },
  );
  assert.equal(r.hello, true);
  assert.equal(sent.length, 1);
  const hello = sent[0].message;
  assert.equal(sent[0].lane, "timeline-discord");
  assert.equal(hello.kind, "clan_hello");
  assert.equal(validateTimelineDiscordMessage(hello).ok, true);
  assert.equal(hello.account_id, r.row.channel_id);
  assert.equal(open(hello.webhook, r.row.channel_id), HOOK);
  assert.equal(
    open(hello.webhook, "0b6b5a59-0e4f-4f39-9d55-58e41b6a3e7a"),
    null,
  );
  assert.match(hello.posts[0].content, /POAP KINGS's activity to this channel/);
  assert.match(hello.posts[0].content, /not endorsed by Supercell/);

  const view = clanActivityRowView(await readClanActivity(db, CLAN));
  assert.equal(view.enabled, true);
  assert.deepEqual(view.deliveries, [], "nothing delivered yet");
  assert.equal(view.not_delivered, 0);
  const told = clanActivityRowView(await readClanActivity(db, CLAN), null, {
    entries: [
      { at: at(T), outcome: "posted", excerpt: "Ada joined", rewritten: true },
    ],
    missed: { [at(T).slice(0, 10)]: 2 },
  });
  assert.equal(told.deliveries[0].rewritten, true);
  assert.equal(told.not_delivered, 2);
  assert.ok(!JSON.stringify(view).includes("b".repeat(68)), "never the URL");
  assert.equal(view.webhook_sealed, undefined);

  const out = await sync(T + H);
  assert.equal(out.posted, 0, "the join before the connection is not posted");
});

test("a join is posted once, as members read it, with no backfill on a second run", async () => {
  await clanEvent("member_joined", JOINER, T + 2 * H);
  const out = await sync(T + 3 * H);
  assert.equal(out.posted, 1);
  const msg = out.sent[0].message;
  assert.equal(msg.kind, "clan_activity");
  assert.equal(validateTimelineDiscordMessage(msg).ok, true);
  assert.match(msg.posts[0].content, /Joiner joined/);
  // An hour old: Discord's own post time says when (2026-10-11).
  assert.match(msg.posts[0].content, /^Joiner joined/);
  assert.doesNotMatch(msg.posts[0].content, /<t:/);
  const again = await sync(T + 3 * H + 10 * MIN);
  assert.equal(again.posted, 0);
  assert.equal(again.sent.length, 0);
});

test("a departure says departed; a leader's kick edits that post to say removed", async () => {
  await clanEvent("member_left", LEAVER, T + 4 * H);
  const left = await sync(T + 5 * H);
  assert.equal(left.posted, 1);
  const post = left.sent[0].message.posts[0];
  assert.match(post.content, /departed/);
  assert.doesNotMatch(post.content, /\bleft\b/);

  await db.query(
    `insert into attested_fact
       (subject_kind, clan_tag, player_tag, fact_type, detail, visibility,
        source, source_ref, occurred_at, recorded_at)
     values ('clan', $1, $2, 'departure_classified', '{"kind":"kick"}',
             'clan', 'clan.poapkings.com', 'clan-activity-1', $3, $3)`,
    [CLAN, LEAVER, at(T + 6 * H)],
  );
  const kicked = await sync(T + 7 * H);
  assert.equal(kicked.posted, 1);
  const edit = kicked.sent[0].message.posts[0];
  assert.equal(edit.key, post.key, "the departure's own message is edited");
  assert.ok(edit.revision > post.revision);
  assert.match(edit.content, /was removed/);
  assert.doesNotMatch(edit.content, /<t:/, "the edit gains no time");

  const again = await sync(T + 7 * H + 10 * MIN);
  assert.equal(again.posted, 0, "the classification is told once");
});

test("categories: a leader's off holds, the policy's ruled-out category never posts, and no policy posts nothing", async () => {
  await saveClanActivity(
    db,
    CLAN,
    { categories: { members: false } },
    { seal, who: WHO, now: T + 8 * H },
  );
  await clanEvent("member_joined", LEAVER, T + 8 * H + 10 * MIN);
  const off = await sync(T + 9 * H);
  assert.equal(off.posted, 0);
  assert.equal(off.skipped, undefined, "milestones and war are still on");

  await saveClanActivity(
    db,
    CLAN,
    { categories: { members: null } },
    { seal, who: WHO, now: T + 9 * H },
  );
  const row = await readClanActivity(db, CLAN);
  assert.deepEqual(
    row.categories,
    {},
    "null goes back to the policy's default",
  );
  const later = await sync(T + 9 * H + 10 * MIN);
  assert.equal(later.posted, 0, "the pointer moved on: no backfill");

  policy = null;
  const none = await sync(T + 10 * H);
  assert.equal(none.skipped, "nothing_on");
  policy = PARTICIPATING;
});

test("the editor's run: sent to its own queue, then each story's packet carries the clan, the facts and the member; it may look things up; the model is asked outside the sync's transaction", async () => {
  await saveClanActivity(
    db,
    CLAN,
    { rewrite: true, voice: "Hype and short." },
    { seal, who: WHO, now: T + 11 * H },
  );
  await clanEvent("role_changed", JOINER, T + 11 * H + 10 * MIN, {
    before: "member",
    after: "elder",
  });
  await clanEvent("member_left", JOINER, T + 11 * H + 20 * MIN);
  const toldCount = async () =>
    (
      await db.query(
        `select count(*)::int as n from clan_activity_discord_told where clan_tag = $1`,
        [CLAN],
      )
    ).rows[0].n;
  const before = await toldCount();
  // On the sync's queue, a clan whose model edits is sent to the
  // editor's: nothing is written there.
  const sent = await sync(T + 12 * H, {
    rewrite: async () => assert.fail("not on the sync's queue"),
  });
  assert.equal(sent.editor, "queued");
  assert.equal(sent.ready, 2);
  assert.deepEqual(
    sent.sent.map((x) => [x.lane, x.message, x.opts.once]),
    [["timeline-editor", { v: 1, clan_tag: CLAN }, true]],
  );
  assert.equal(await toldCount(), before);

  const requests = [];
  const asked = [];
  let saved = null;
  const out = await sync(T + 12 * H, {
    editor: true,
    readHistory: async () => ({
      entries: [
        {
          at: at(T + 11 * H),
          outcome: "posted",
          // As the relay keeps it: escaped for Discord.
          excerpt: "Le\\_aver unlocked Rune Giant.",
        },
      ],
    }),
    rewrite: async (_db, tag, req, opts) => {
      requests.push(req);
      asked.push(opts);
      assert.equal(tag, CLAN);
      // A leader's save is not held up while the model writes: no row
      // lock and no transaction are held across the wait.
      const other = new pg.Client({ connectionString: ctx.url });
      await other.connect();
      try {
        await other.query("set lock_timeout = '1s'");
        saved = await other.query(
          `update clan_activity_discord set categories = categories where clan_tag = $1`,
          [CLAN],
        );
      } finally {
        await other.end();
      }
      if (opts.round === 1)
        return {
          ok: true,
          calls: [
            { id: "c1", name: "channel_recent", input: {} },
            { id: "c2", name: "member_record", input: { name: "Stayer" } },
          ],
          content: [
            { type: "tool_use", id: "c1", name: "channel_recent", input: {} },
            {
              type: "tool_use",
              id: "c2",
              name: "member_record",
              input: { name: "Stayer" },
            },
          ],
        };
      const keys = [
        ...req.messages[0].content.matchAll(/^STORY (tl_[a-f0-9]{20})/gm),
      ].map((m) => m[1]);
      return {
        ok: true,
        answer: {
          posts: [
            { keys: [keys[0]], text: "Joiner steps up to Elder! 🔥" },
            // A number the post was never given is refused.
            { keys: [keys[1]], text: "Joiner departed after 400 wins." },
          ],
          skips: [],
        },
      };
    },
  });
  assert.equal(saved.rowCount, 1);
  // One run, two rounds, each asked as that run's round.
  assert.equal(requests.length, 2);
  assert.equal(asked[0].run, asked[1].run);
  assert.deepEqual(
    asked.map((a) => a.round),
    [1, 2],
  );
  const [request, second] = requests;
  assert.equal(request.purpose, "discord_activity");
  assert.equal(request.effort, "low");
  assert.ok(request.tools.every((t) => t.strict === true));
  assert.equal(request.answer, "write_posts");
  assert.match(request.context, /^THE CLAN\nName: POAP KINGS/);
  assert.match(
    request.context,
    /How its leaders want it to sound: Hype and short\./,
  );
  const packet = request.messages[0].content;
  assert.match(
    packet,
    /^STORY tl_[a-f0-9]{20} \(member role changed\)\nElixir's version: Joiner was promoted/m,
  );
  assert.match(packet, /- role_after: elder/);
  assert.match(
    packet,
    /\(member left\)\nA departure: keep this sentence word for word, and give no reason: Joiner departed the clan\.\n/,
  );
  assert.doesNotMatch(packet, /#PYL0Q2G8/, "no tags reach the model");
  // The lookups' answers, read-only, as the second round's tool results.
  const results = second.messages[2].content;
  assert.deepEqual(
    results.slice(0, 2).map((r) => r.tool_use_id),
    ["c1", "c2"],
  );
  assert.match(results[0].content, /: Le_aver unlocked Rune Giant\.$/m);
  assert.match(results[0].content, /a couple of hours ago/);
  assert.match(results[1].content, /^MEMBER: Stayer/);
  assert.match(results[2].text, /Round 2 of 3/);

  assert.equal(out.posted, 2);
  assert.equal(out.rewritten, 1);
  assert.equal(out.rounds, 2);
  assert.equal(out.lookups, 2);
  assert.deepEqual(out.refused, { number_invented: 1 });
  const [promo, gone] = out.sent[0].message.posts;
  assert.match(promo.content, /Joiner steps up to Elder! 🔥/);
  assert.match(gone.content, /departed/);
  assert.doesNotMatch(gone.content, /400 wins/);
  // Its delivery says the clan's model wrote it; Elixir's own does not.
  assert.equal(promo.rewritten, true);
  assert.equal("rewritten" in gone, false);
});

test("a model the clan cannot use, or one that never answers in time, posts Elixir's own stories; a run under way sends the next after the hold", async () => {
  await clanEvent("member_joined", JOINER, T + 13 * H);
  // Another run holds the clan: this one waits for the hold queue.
  const other = new pg.Client({ connectionString: ctx.url });
  await other.connect();
  try {
    await other.query("select pg_advisory_lock($1, hashtext($2))", [
      0x636c616e,
      CLAN,
    ]);
    const busy = await sync(T + 14 * H, { editor: true });
    assert.equal(busy.skipped, "busy");
    assert.deepEqual(
      busy.sent.map((x) => [x.lane, x.message, x.opts.once]),
      [["timeline-hold", { v: 1, clan_tag: CLAN }, true]],
    );
  } finally {
    await other.end();
  }
  const out = await sync(T + 14 * H, {
    editor: true,
    rewrite: async () => ({ ok: false, code: "no_key" }),
  });
  assert.equal(out.posted, 1);
  assert.equal(out.rewritten, 0);
  assert.equal(out.rewrite_code, "no_key");
  assert.match(out.sent[0].message.posts[0].content, /Joiner joined/);
  const thrown = await sync(T + 15 * H, {
    editor: true,
    rewrite: async () => {
      throw new Error("bridge");
    },
  });
  assert.equal(thrown.posted, 0);

  // A model that only looks things up is out of rounds after three; a
  // run without the time for a round asks nothing.
  await clanEvent("member_joined", STAYER, T + 15 * H + 5 * MIN);
  let rounds = 0;
  const looking = await sync(T + 15 * H + 15 * MIN, {
    editor: true,
    rewrite: async (_db, _tag, req) => {
      rounds += 1;
      if (rounds === 3)
        assert.match(
          req.messages.at(-1).content.at(-1).text,
          /no more lookups/,
        );
      return {
        ok: true,
        calls: [{ id: `c${rounds}`, name: "channel_recent", input: {} }],
        content: [
          {
            type: "tool_use",
            id: `c${rounds}`,
            name: "channel_recent",
            input: {},
          },
        ],
      };
    },
  });
  assert.equal(rounds, 3);
  assert.equal(looking.rewrite_code, "no_answer");
  assert.equal(looking.posted, 1);
  assert.match(looking.sent[0].message.posts[0].content, /^Stayer joined/);

  await clanEvent("member_joined", JOINER, T + 15 * H + 16 * MIN);
  const late = await sync(T + 15 * H + 25 * MIN, {
    editor: true,
    remainingMs: () => 10_000,
    rewrite: async () => assert.fail("no time for a round"),
  });
  assert.equal(late.rewrite_code, "deadline");
  assert.equal(late.rounds, 0);
  assert.equal(late.posted, 1);

  // A leader turns the connection off while the model writes: the run
  // writes nothing, and nothing is told.
  await clanEvent("member_joined", STAYER, T + 15 * H + 30 * MIN);
  const changed = await sync(T + 15 * H + 40 * MIN, {
    editor: true,
    rewrite: async (client) => {
      await saveClanActivity(
        client,
        CLAN,
        { enabled: false },
        { seal, who: WHO, now: T + 15 * H + 40 * MIN },
      );
      return { ok: false, code: "no_key" };
    },
  });
  assert.equal(changed.skipped, "changed");
  assert.deepEqual(changed.sent ?? [], []);
  const { rows: told } = await db.query(
    `select 1 from clan_activity_discord_told
      where clan_tag = $1 and player_tag = $2 and kind = 'member_joined'
        and item_at >= $3`,
    [CLAN, STAYER, at(T + 15 * H + 30 * MIN)],
  );
  assert.equal(told.length, 0);
  await saveClanActivity(
    db,
    CLAN,
    { enabled: true },
    { seal, who: WHO, now: T + 15 * H + 50 * MIN },
  );
});

test("the clan's tag and its members' wake it; a former member's for a day", async () => {
  assert.deepEqual(await clansToWake(db, CLAN), [CLAN]);
  assert.deepEqual(await clansToWake(db, STAYER), [CLAN]);
  assert.deepEqual(await clansToWake(db, "#QQQQQQQQ"), []);
  const { sent, outbox } = recorder();
  await wakeSyndication(db, STAYER, { outbox, now: T });
  const wake = sent.find((s) => s.message.clan_tag === CLAN);
  assert.deepEqual(wake.message, { v: 1, clan_tag: CLAN });
  assert.equal(wake.lane, "timeline-sync");
  assert.equal(wake.opts.once, true);
  assert.match(wake.opts.id, /^clan-J2RGCRVG\.\d+$/);
});

test("Discord's word that the webhook is gone turns it off; a new webhook starts over", async () => {
  const row = await readClanActivity(db, CLAN);
  const out = await sync(T + 16 * H, {
    readStatus: async (id) =>
      id === row.channel_id
        ? {
            state: "gone",
            webhook: webhookFingerprint(HOOK),
            at: at(T + 16 * H),
          }
        : null,
  });
  assert.deepEqual(out.disabled, "webhook_gone");
  const off = await readClanActivity(db, CLAN);
  assert.equal(off.enabled, false);
  assert.equal(off.disabled_reason, "webhook_gone");
  assert.equal((await clansToWake(db, CLAN)).length, 0, "off is never woken");

  const { sent, outbox } = recorder();
  const r = await saveClanActivity(
    db,
    CLAN,
    { url: HOOK2 },
    { seal, outbox, who: WHO, now: T + 17 * H },
  );
  assert.notEqual(r.row.channel_id, row.channel_id);
  assert.equal(r.row.enabled, true);
  assert.equal(r.row.disabled_reason, null);
  assert.equal(sent[0].message.kind, "clan_hello");
  const { rows } = await db.query(
    `select count(*)::int as n from clan_activity_discord_told where clan_tag = $1`,
    [CLAN],
  );
  assert.equal(rows[0].n, 0);
});

async function award(player, name, ms) {
  await db.query(
    `insert into attested_fact
       (subject_kind, clan_tag, player_tag, fact_type, detail, visibility,
        source, source_ref, occurred_at, recorded_at)
     values ('clan', $1, $2, 'award_granted', $3, 'clan', 'clan.poapkings.com', $4, $5, $5)`,
    [
      CLAN,
      player,
      // T is in season 137: the clan's awards for 136, announced.
      JSON.stringify({ award: name, season_id: 136 }),
      `award-${player}-${ms}`,
      at(ms),
    ],
  );
}

test("same-kind milestones are one story under its first item's key; a refused post tells Elixir's own story", async () => {
  await award(JOINER, "Cup", T + 18 * H);
  await award(STAYER, "Cup", T + 18 * H + MIN);
  let packet = null;
  const out = await sync(T + 19 * H, {
    editor: true,
    rewrite: async (_db, _tag, req) => {
      packet = req.messages[0].content;
      const key = /^STORY (tl_[a-f0-9]{20})/m.exec(packet)[1];
      return {
        ok: true,
        answer: {
          posts: [
            { keys: [key], text: "Cups for Joiner and Stayer this season!" },
          ],
          skips: [],
        },
      };
    },
  });
  assert.match(packet, /^STORY tl_[a-f0-9]{20} \(award granted; 2 moments\)$/m);
  assert.match(packet, /Facts of moment 2:/);
  // Each member's ABOUT block names the awards the clan announced.
  assert.match(
    packet,
    /ABOUT: Joiner\n(?:- .*\n)*- Awards they hold in this clan: Cup \(season 136\)/,
  );
  assert.equal(out.posted, 1);
  assert.equal(out.rewritten, 1);
  const [post] = out.sent[0].message.posts;
  assert.match(post.content, /Cups for Joiner and Stayer this season!/);
  // Both items are told: neither posts again.
  const again = await sync(T + 19 * H + 10 * MIN, {
    editor: true,
    rewrite: async () => assert.fail("nothing to rewrite"),
  });
  assert.equal(again.posted, 0);

  await award(JOINER, "Shield", T + 20 * H);
  await award(STAYER, "Shield", T + 20 * H + MIN);
  const refused = await sync(T + 21 * H, {
    editor: true,
    // A group that drops a member's name is refused.
    rewrite: async (_db, _tag, req) => ({
      ok: true,
      answer: {
        posts: [
          {
            keys: [
              /^STORY (tl_[a-f0-9]{20})/m.exec(req.messages[0].content)[1],
            ],
            text: "Shields for Joiner!",
          },
        ],
        skips: [],
      },
    }),
  });
  assert.equal(refused.posted, 1);
  assert.deepEqual(refused.refused, { name_changed: 1 });
  // Refused, the story is Elixir's own: one sentence naming both, with
  // no time and no link (2026-10-11, the editor).
  const story = refused.sent[0].message.posts[0].content;
  assert.equal(
    story,
    "Joiner and Stayer took the clan's Shield for season 136.",
  );
  assert.equal("rewritten" in refused.sent[0].message.posts[0], false);
  // The ledger keeps the refusal with the words the checks stopped, and
  // the post as Elixir's own, a fallback of the run.
  const {
    rows: [run],
  } = await db.query(
    "select refusals, fallbacks, posts, raw_key from discord_run where run_id = $1",
    [`clan-${CLAN.slice(1)}.${T + 21 * H}`],
  );
  assert.equal(run.refusals[0].why, "name_changed");
  assert.equal(run.refusals[0].text, "Shields for Joiner!");
  assert.equal(run.fallbacks, 1);
  assert.equal(run.posts, 0);
  assert.equal(run.raw_key, null, "nowhere to keep the raw run: none named");
  const {
    rows: [fallback],
  } = await db.query(
    "select mode, run_id from discord_post where post_id = $1",
    [refused.sent[0].message.posts[0].ledger_id],
  );
  assert.equal(fallback.mode, "code");
  assert.equal(fallback.run_id, `clan-${CLAN.slice(1)}.${T + 21 * H}`);

  // A departure is told only time here and weeks played: never awards.
  await clanEvent("member_left", JOINER, T + 21 * H + 30 * MIN);
  let departing = null;
  await sync(T + 21 * H + 40 * MIN, {
    editor: true,
    rewrite: async (_db, _tag, req) => {
      departing = req.messages[0].content;
      return { ok: false, code: "no_key" };
    },
  });
  assert.match(
    departing,
    /\(member left\)\nA departure: keep this sentence word for word, and give no reason: Joiner departed the clan\.\n/,
  );
  assert.doesNotMatch(departing, /Awards they hold|Cup|Shield/);
});

test("a leader's word on a departure edits the departure it is about, not the member's latest", async () => {
  const TWICE = "#PYL0Q2GQ";
  await db.query(`insert into player (player_tag, name) values ($1, 'Twice')`, [
    TWICE,
  ]);
  await clanEvent("member_left", TWICE, T + 22 * H);
  const first = await sync(T + 22 * H + 10 * MIN);
  const firstKey = first.sent[0].message.posts[0].key;
  await clanEvent("member_joined", TWICE, T + 30 * H);
  await clanEvent("member_left", TWICE, T + 90 * H);
  const second = await sync(T + 90 * H + 10 * MIN);
  const secondKey = second.sent[0].message.posts.find((p) =>
    /departed/.test(p.content),
  ).key;
  assert.notEqual(firstKey, secondKey);
  // The word about the FIRST departure arrives after the second.
  await db.query(
    `insert into attested_fact
       (subject_kind, clan_tag, player_tag, fact_type, detail, visibility,
        source, source_ref, occurred_at, recorded_at)
     values ('clan', $1, $2, 'departure_classified', $3,
             'clan', 'clan.poapkings.com', 'twice-1', $4, $4)`,
    [
      CLAN,
      TWICE,
      JSON.stringify({ kind: "leave", left_at: at(T + 22 * H) }),
      at(T + 91 * H),
    ],
  );
  const word = await sync(T + 92 * H);
  assert.equal(word.posted, 1);
  const edit = word.sent[0].message.posts[0];
  assert.equal(edit.key, firstKey, "the earlier departure's post");
  assert.match(edit.content, /left/);
  // A word nowhere near any departure edits nothing.
  await db.query(
    `insert into attested_fact
       (subject_kind, clan_tag, player_tag, fact_type, detail, visibility,
        source, source_ref, occurred_at, recorded_at)
     values ('clan', $1, $2, 'departure_classified', $3,
             'clan', 'clan.poapkings.com', 'twice-2', $4, $4)`,
    [
      CLAN,
      TWICE,
      JSON.stringify({ kind: "kick", left_at: at(T + 56 * H) }),
      at(T + 93 * H),
    ],
  );
  const stray = await sync(T + 94 * H);
  assert.equal(stray.posted, 0);
});

test("the editor: a badge level-up below the top is skipped with its reason; a story is held until quiet, then posted once with no time or link", async () => {
  const badge = (name, level, max, ms) =>
    emitEvent(db, "badge_earned", {
      tag: STAYER,
      windowStart: at(ms - MIN),
      windowEnd: at(ms),
      payload: { name, level, prior_level: level - 1, max_level: max },
    });
  await badge("MasteryHog", 5, 10, T + 96 * H);
  await badge("Played2Years", 2, 2, T + 96 * H);
  const early = await sync(T + 96 * H + MIN);
  assert.equal(early.posted, 0, "a minute old: held");
  assert.equal(early.held, 1);
  assert.equal(early.skips, 1);
  const told = early.sent.find((s) => s.lane === "timeline-discord");
  assert.equal(validateTimelineDiscordMessage(told.message).ok, true);
  assert.deepEqual(told.message.posts, [], "nothing posted yet");
  const [skip] = told.message.skipped;
  assert.equal(skip.reason, "A badge level-up below its top level.");
  assert.match(skip.excerpt, /^Stayer took Hog Mastery to level 5\.$/);
  // The hold queue brings the clan back: one wake a minute.
  const hold = early.sent.find((s) => s.lane === "timeline-hold");
  assert.deepEqual(hold.message, { v: 1, clan_tag: CLAN });
  assert.equal(hold.opts.once, true);
  assert.match(hold.opts.id, /^clan-J2RGCRVG\.\d+$/);

  const quiet = await sync(T + 96 * H + 6 * MIN);
  assert.equal(quiet.posted, 1);
  assert.equal(quiet.skips, 0, "a skip is handed over once");
  const [post] = quiet.sent[0].message.posts;
  assert.match(post.content, /^Stayer took .+ to its top level, 2\.$/);
  assert.doesNotMatch(post.content, /<t:|https?:/, "no time and no link");
  assert.equal(quiet.sent.length, 1, "no further hold");

  const again = await sync(T + 96 * H + 12 * MIN);
  assert.equal(again.posted, 0);
  assert.deepEqual(again.sent, []);
  const { rows } = await db.query(
    `select skipped, skip_reason, story_key = item_id as own
       from clan_activity_discord_told
      where clan_tag = $1 and kind = 'badge_earned' order by item_at, skipped`,
    [CLAN],
  );
  assert.deepEqual(
    rows.map((r) => [r.skipped, r.skip_reason, r.own]),
    [
      [false, null, true],
      [true, "badge_level", true],
    ],
  );
});

test("a leader's preview: the newest stories as the editor's packets, in one request without lookups, in the voice being tried; nothing is posted or told", async () => {
  const count = async () =>
    Number(
      (
        await db.query(
          `select count(*) from clan_activity_discord_told where clan_tag = $1`,
          [CLAN],
        )
      ).rows[0].count,
    );
  const told = await count();
  const p = await clanEditorPreview(db, CLAN, {
    policyFor,
    voice: "Pirate talk.",
    now: T + 95 * H,
  });
  assert.equal(p.empty, false);
  assert.ok(p.posts.length > 0 && p.posts.length <= 5);
  const keys = [...p.request.prompt.matchAll(/^STORY (tl_[a-f0-9]{20})/gm)].map(
    (m) => m[1],
  );
  assert.deepEqual(
    keys,
    p.posts.map((x) => x.key),
  );
  assert.deepEqual(
    p.stories.map((st) => st.key),
    keys,
  );
  assert.equal(p.request.tool.name, "write_posts");
  assert.equal(p.request.tools, undefined, "no lookups");
  for (const x of p.posts) assert.ok(x.elixir && x.kind && x.at);
  assert.match(p.request.context, /Name: POAP KINGS/);
  assert.match(p.request.context, /Pirate talk\./);
  assert.equal(p.request.effort, "low");
  assert.equal(await count(), told, "nothing told");
  const quiet = await clanEditorPreview(db, CLAN, {
    policyFor,
    now: T + 400 * H,
  });
  assert.deepEqual(quiet, { empty: true, reason: "nothing_recent" });
});

test("the editor may tell two stories in one post and skip one with its reason; neither is told again", async () => {
  const NEWBIE = "#PYL0Q2GU";
  await db.query(
    `insert into player (player_tag, name) values ($1, 'Newbie')`,
    [NEWBIE],
  );
  await clanEvent("member_joined", NEWBIE, T + 100 * H);
  await emitEvent(db, "badge_earned", {
    tag: STAYER,
    windowStart: at(T + 100 * H - MIN),
    windowEnd: at(T + 100 * H),
    payload: { name: "Played3Years", level: 3, prior_level: 2, max_level: 3 },
  });
  await award(STAYER, "Star", T + 100 * H + MIN);
  let packet = null;
  const captured = [];
  const out = await sync(T + 101 * H, {
    editor: true,
    captureRun: async (key, body) => {
      captured.push({ key, body });
    },
    rewrite: async (_db, _tag, req) => {
      packet = req.messages[0].content;
      const key = (kind) =>
        new RegExp(`^STORY (tl_[a-f0-9]{20}) \\(${kind}\\)`, "m").exec(
          packet,
        )[1];
      return {
        ok: true,
        model: "a-model",
        cost: { usd: 0.0042, estimated: false },
        answer: {
          posts: [
            {
              keys: [key("award granted"), key("member joined")],
              text: "Welcome Newbie! And Stayer took the clan's Star for season 136.",
            },
          ],
          skips: [
            {
              key: key("badge earned"),
              reason: "Badges are told on Sundays here.",
            },
          ],
        },
      };
    },
  });
  assert.equal(out.posted, 1);
  assert.equal(out.rewritten, 1);
  assert.equal(out.merged, 1);
  assert.equal(out.model_skips, 1);
  const { message } = out.sent.find((x) => x.lane === "timeline-discord");
  assert.equal(validateTimelineDiscordMessage(message).ok, true);
  const join = /^STORY (tl_[a-f0-9]{20}) \(member joined\)/m.exec(packet)[1];
  const badge = /^STORY (tl_[a-f0-9]{20}) \(badge earned\)/m.exec(packet)[1];
  // One post under the first of its stories.
  assert.deepEqual(
    message.posts.map((p) => [p.key, p.rewritten]),
    [[join, true]],
  );
  assert.match(message.posts[0].content, /^Welcome Newbie!/);
  // The skip is in the delivery history, as the model's.
  assert.deepEqual(message.skipped, [
    {
      key: badge,
      reason: "Badges are told on Sundays here.",
      excerpt: message.skipped[0].excerpt,
      rewritten: true,
      ledger_id: message.skipped[0].ledger_id,
    },
  ]);
  assert.match(
    message.skipped[0].excerpt,
    /^Stayer took .+ to its top level, 3\.$/,
  );
  const { rows } = await db.query(
    `select kind, story_key, skipped, skip_reason
       from clan_activity_discord_told
      where clan_tag = $1 and told_at = $2 order by kind`,
    [CLAN, at(T + 101 * H)],
  );
  assert.deepEqual(
    rows.map((r) => [r.kind, r.story_key, r.skipped, r.skip_reason]),
    [
      ["award_granted", join, false, null],
      ["badge_earned", badge, true, "editor"],
      ["member_joined", join, false, null],
    ],
  );
  // The quality ledger (0222): the post with both stories' items, the
  // model's skip with its reason, both under the run; the run itself,
  // and its raw record in the archive.
  const run = `clan-${CLAN.slice(1)}.${T + 101 * H}`;
  const { rows: ledger } = await db.query(
    `select post_id, feature, clan_tag, destination, action, mode, items,
            content, skip_reason, outcome, run_id
       from discord_post where run_id = $1 order by action`,
    [run],
  );
  assert.deepEqual(
    ledger.map((r) => [r.action, r.mode, r.outcome]),
    [
      ["post", "model", null],
      ["skip", "model", "skipped"],
    ],
  );
  assert.equal(ledger[0].post_id, message.posts[0].ledger_id);
  assert.equal(ledger[0].feature, "clan_activity");
  assert.equal(ledger[0].clan_tag, CLAN);
  assert.equal(ledger[0].content, message.posts[0].content);
  assert.deepEqual(ledger[0].items.map((i) => i.kind).sort(), [
    "award_granted",
    "member_joined",
  ]);
  assert.equal(ledger[1].skip_reason, "Badges are told on Sundays here.");
  assert.equal(ledger[1].post_id, message.skipped[0].ledger_id);
  const {
    rows: [runRow],
  } = await db.query("select * from discord_run where run_id = $1", [run]);
  assert.equal(runRow.model, "a-model");
  assert.equal(runRow.outcome, "ok");
  assert.equal(runRow.rounds, 1);
  assert.equal(runRow.posts, 1);
  assert.equal(runRow.merged, 1);
  assert.equal(runRow.model_skips, 1);
  assert.equal(Number(runRow.cost_usd), 0.0042);
  assert.equal(captured.length, 1);
  assert.equal(runRow.raw_key, captured[0].key);
  assert.match(captured[0].key, /^discord-runs\/2026-10-\d\d\/clan-/);
  assert.equal(captured[0].body.run_id, run);
  assert.equal(captured[0].body.stories.length, 3);
  assert.equal(captured[0].body.rounds[0].answer.posts.length, 1);
  const again = await sync(T + 101 * H + 10 * MIN, {
    editor: true,
    rewrite: async () => assert.fail("nothing to tell"),
  });
  assert.equal(again.posted, 0);
});

test("refusals and removal", async () => {
  await removeClanActivity(db, CLAN);
  assert.deepEqual(
    await saveClanActivity(db, CLAN, { enabled: true }, { seal, who: WHO }),
    { error: "webhook_required" },
  );
  assert.deepEqual(
    await saveClanActivity(
      db,
      CLAN,
      { url: "https://example.com/hook" },
      { seal, who: WHO },
    ),
    { error: "webhook_invalid" },
  );
  assert.equal(await readClanActivity(db, CLAN), null);
  assert.equal(await removeClanActivity(db, CLAN), false);
});

test("a member's timeline page learns its own clan posts its activity; nobody else's", async () => {
  await saveClanActivity(
    db,
    CLAN,
    { url: HOOK, enabled: true },
    { seal, who: WHO, now: T + 40 * H },
  );
  const account = async (hash) =>
    (
      await db.query(
        `insert into account (email_hash, status) values ($1, 'approved')
         returning account_id`,
        [hash],
      )
    ).rows[0].account_id;
  const member = await account("activity-member");
  const follower = await account("activity-follower");
  for (const [id, status] of [
    [member, "verified"],
    [follower, "unverified"],
  ]) {
    await db.query(
      `insert into claim (account_id, player_tag, status, is_primary, relationship, notify)
       values ($1, $2, $3, true, 'primary', true)`,
      [id, STAYER, status],
    );
    await db.query(
      `insert into account_clan (account_id, clan_tag, scope, notify)
       values ($1, $2, 'comprehensive', true)`,
      [id, CLAN],
    );
  }
  assert.deepEqual(await clanChannelsInTimeline(db, member), [
    { clan_tag: CLAN, name: "POAP KINGS" },
  ]);
  assert.deepEqual(
    await clanChannelsInTimeline(db, follower),
    [],
    "a claim not verified says nothing about the clan",
  );
  await saveClanActivity(
    db,
    CLAN,
    { enabled: false },
    { seal, who: WHO, now: T + 41 * H },
  );
  assert.deepEqual(await clanChannelsInTimeline(db, member), []);
  await db.query(`delete from account_clan where account_id = any($1)`, [
    [member, follower],
  ]);
  await db.query(`delete from claim where account_id = any($1)`, [
    [member, follower],
  ]);
});
