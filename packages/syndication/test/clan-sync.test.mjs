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
import {
  CLAN_ACTIVITY_PURPOSE,
  clanActivityRowView,
  clanActivitySeal,
  clanChannelsInTimeline,
  clanRewritePreview,
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
  assert.match(msg.posts[0].content, /^<t:\d+:/);
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

test("the rewrite: each post's packet carries the clan, the facts and the member; the model is asked outside the sync's transaction", async () => {
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
  let request = null;
  let saved = null;
  const out = await sync(T + 12 * H, {
    rewrite: async (_db, tag, req) => {
      request = req;
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
      const keys = [...req.prompt.matchAll(/^POST (tl_[a-f0-9]{20})/gm)].map(
        (m) => m[1],
      );
      return {
        ok: true,
        input: {
          posts: [
            { key: keys[0], text: "Joiner steps up to Elder! 🔥" },
            // A number the post was never given is refused.
            { key: keys[1], text: "Joiner departed after 400 wins." },
          ],
        },
      };
    },
  });
  assert.equal(saved.rowCount, 1);
  assert.equal(request.purpose, "discord_activity");
  assert.equal(request.effort, "low");
  assert.equal(request.tool.strict, true);
  assert.match(request.context, /^THE CLAN\nName: POAP KINGS/);
  assert.match(
    request.context,
    /How its leaders want it to sound: Hype and short\./,
  );
  assert.match(
    request.prompt,
    /\(member_role_changed\)\nElixir's line: Joiner was promoted/,
  );
  assert.match(request.prompt, /- role_after: elder/);
  assert.match(
    request.prompt,
    /\(member_left\)\nElixir's line: Joiner departed/,
  );
  assert.doesNotMatch(request.prompt, /#PYL0Q2G8/, "no tags reach the model");
  assert.equal(out.posted, 2);
  assert.equal(out.rewritten, 1);
  assert.deepEqual(out.refused, { number_invented: 1 });
  const [promo, gone] = out.sent[0].message.posts;
  assert.match(promo.content, /Joiner steps up to Elder! 🔥/);
  assert.match(promo.content, /^<t:\d+:/, "the stamp is Elixir's");
  assert.match(gone.content, /departed/);
  assert.doesNotMatch(gone.content, /400 wins/);
  // Its delivery says the clan's model wrote it; Elixir's own does not.
  assert.equal(promo.rewritten, true);
  assert.equal("rewritten" in gone, false);
});

test("a rewrite the model cannot make posts Elixir's own lines", async () => {
  await clanEvent("member_joined", JOINER, T + 13 * H);
  const out = await sync(T + 14 * H, {
    rewrite: async () => ({ ok: false, code: "no_key" }),
  });
  assert.equal(out.posted, 1);
  assert.equal(out.rewritten, 0);
  assert.equal(out.rewrite_code, "no_key");
  assert.match(out.sent[0].message.posts[0].content, /Joiner joined/);
  const thrown = await sync(T + 15 * H, {
    rewrite: async () => {
      throw new Error("bridge");
    },
  });
  assert.equal(thrown.posted, 0);

  // A leader turns the connection off while the model writes: the run
  // writes nothing, and nothing is told.
  await clanEvent("member_joined", STAYER, T + 15 * H + 10 * MIN);
  const changed = await sync(T + 15 * H + 20 * MIN, {
    rewrite: async (client) => {
      await saveClanActivity(
        client,
        CLAN,
        { enabled: false },
        { seal, who: WHO, now: T + 15 * H + 20 * MIN },
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
    [CLAN, STAYER, at(T + 15 * H)],
  );
  assert.equal(told.length, 0);
  await saveClanActivity(
    db,
    CLAN,
    { enabled: true },
    { seal, who: WHO, now: T + 15 * H + 30 * MIN },
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

test("with the rewrite on, a run of same-kind milestones is one post under its first item's key; refused, it stacks Elixir's lines", async () => {
  await award(JOINER, "Cup", T + 18 * H);
  await award(STAYER, "Cup", T + 18 * H + MIN);
  let packet = null;
  const out = await sync(T + 19 * H, {
    rewrite: async (_db, _tag, req) => {
      packet = req.prompt;
      const key = /^POST (tl_[a-f0-9]{20})/m.exec(req.prompt)[1];
      return {
        ok: true,
        input: {
          posts: [{ key, text: "Cups for Joiner and Stayer this season!" }],
        },
      };
    },
  });
  assert.match(packet, /2 moments of this kind together; write ONE post/);
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
    rewrite: async () => assert.fail("nothing to rewrite"),
  });
  assert.equal(again.posted, 0);

  await award(JOINER, "Shield", T + 20 * H);
  await award(STAYER, "Shield", T + 20 * H + MIN);
  const refused = await sync(T + 21 * H, {
    // A group that drops a member's name is refused.
    rewrite: async (_db, _tag, req) => ({
      ok: true,
      input: {
        posts: [
          {
            key: /^POST (tl_[a-f0-9]{20})/m.exec(req.prompt)[1],
            text: "Shields for Joiner!",
          },
        ],
      },
    }),
  });
  assert.equal(refused.posted, 1);
  assert.deepEqual(refused.refused, { name_changed: 1 });
  const lines = refused.sent[0].message.posts[0].content.split("\n");
  assert.equal(lines.length, 2, "Elixir's two lines, one post");
  assert.match(lines[0], /^<t:\d+:.*Joiner/);
  assert.match(lines[1], /^<t:\d+:.*Stayer/);

  // A departure is told only time here and weeks played: never awards.
  await clanEvent("member_left", JOINER, T + 21 * H + 30 * MIN);
  let departing = null;
  await sync(T + 21 * H + 40 * MIN, {
    rewrite: async (_db, _tag, req) => {
      departing = req.prompt;
      return { ok: false, code: "no_key" };
    },
  });
  assert.match(departing, /\(member_left\)/);
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

test("a leader's preview: the newest shareable items as packets, in the voice being tried; nothing is posted or told", async () => {
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
  const p = await clanRewritePreview(db, CLAN, {
    policyFor,
    voice: "Pirate talk.",
    now: T + 95 * H,
  });
  assert.equal(p.empty, false);
  assert.ok(p.posts.length > 0 && p.posts.length <= 5);
  const keys = [...p.request.prompt.matchAll(/^POST (tl_[a-f0-9]{20})/gm)].map(
    (m) => m[1],
  );
  assert.deepEqual(
    keys,
    p.posts.map((x) => x.key),
  );
  assert.deepEqual(
    p.lines.map((l) => l.key),
    keys,
  );
  for (const x of p.posts) assert.ok(x.elixir && x.kind && x.at);
  assert.match(p.request.context, /Name: POAP KINGS/);
  assert.match(p.request.context, /Pirate talk\./);
  assert.equal(p.request.effort, "low");
  assert.equal(await count(), told, "nothing told");
  const quiet = await clanRewritePreview(db, CLAN, {
    policyFor,
    now: T + 400 * H,
  });
  assert.deepEqual(quiet, { empty: true, reason: "nothing_recent" });
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
