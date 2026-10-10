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

test("the rewrite: lines the model may post are its own, the rest keep Elixir's words", async () => {
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
  const out = await sync(T + 12 * H, {
    rewrite: async (_db, tag, req) => {
      request = req;
      assert.equal(tag, CLAN);
      const lines = req.prompt
        .split("\n")
        .filter((l) => l.startsWith("{"))
        .map((l) => JSON.parse(l));
      return {
        ok: true,
        input: {
          posts: [
            { key: lines[0].key, text: "Joiner steps up to Elder! 🔥" },
            // A number the line never gave is refused.
            { key: lines[1].key, text: "Joiner departed after 400 wins." },
          ],
        },
      };
    },
  });
  assert.equal(request.purpose, "discord_activity");
  assert.match(request.prompt, /Hype and short\./);
  assert.doesNotMatch(request.prompt, /#PYL0Q2G8/, "no tags reach the model");
  assert.equal(out.posted, 2);
  assert.equal(out.rewritten, 1);
  assert.deepEqual(out.refused, { number_invented: 1 });
  const [promo, gone] = out.sent[0].message.posts;
  assert.match(promo.content, /Joiner steps up to Elder! 🔥/);
  assert.match(promo.content, /^<t:\d+:/, "the stamp is Elixir's");
  assert.match(gone.content, /departed/);
  assert.doesNotMatch(gone.content, /400 wins/);
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
