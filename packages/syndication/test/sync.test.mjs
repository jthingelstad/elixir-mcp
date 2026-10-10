/**
 * The cross-posted timeline (2026-10-10): posted once, edited in place
 * as a sitting grows and when it closes, never before it was turned on,
 * woken by the tags it reaches, and off when Discord says the webhook is
 * gone. On a scratch database (golden rule 9).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ingestBattlelog } from "../../ingest/src/battles.mjs";
import { fixture, scratchDb, seedReceipt } from "../../ingest/test/helpers.mjs";
import {
  validateTimelineDiscordMessage,
  webhookDisplay,
  webhookFingerprint,
} from "@elixir-mcp/contracts";
import { createBox } from "../../clan/src/sealed.mjs";
import {
  syncAccount,
  accountsToWake,
  wakeSyndication,
  saveDiscordSetting,
  readDiscordSetting,
} from "../src/index.mjs";
import { settingView } from "../src/settings.mjs";
import { webhookSeal, WEBHOOK_PURPOSE } from "../src/seal.mjs";

const OBSERVER = "#UVQ8RJYG9"; // the battlelog fixture's own player
const CLAN = "#J2RGCRVG";
const HOOK = `https://discord.com/api/webhooks/123456789012345678/${"a".repeat(68)}`;
const { seal, open } = webhookSeal(
  createBox("synd-test-secret", WEBHOOK_PURPOSE),
);
let ctx;
let person;

const told = async (accountId) =>
  (
    await ctx.db.query(
      `select item_id, revision, open_from from timeline_discord_told
        where account_id = $1 order by told_at, item_id`,
      [accountId],
    )
  ).rows;

function recorder() {
  const sent = [];
  const outbox = async (lane, message, opts = {}) => {
    sent.push({ lane, message, opts });
  };
  return { sent, outbox };
}

async function enable(accountId, at) {
  await ctx.db.query(
    `insert into timeline_discord (account_id, webhook_sealed, webhook_fp,
       webhook_display, enabled_at, synced_to, updated_at)
     values ($1, $2, $3, $4, $5, $5, $5)
     on conflict (account_id) do update set enabled = true, enabled_at = $5,
       synced_to = $5, updated_at = $5, disabled_reason = null`,
    [
      accountId,
      seal(HOOK, accountId),
      webhookFingerprint(HOOK),
      webhookDisplay(HOOK),
      at,
    ],
  );
  await ctx.db.query(
    `delete from timeline_discord_told where account_id = $1`,
    [accountId],
  );
}

before(async () => {
  ctx = await scratchDb("syndication");
  const db = ctx.db;
  const receiptId = await seedReceipt(db, { entityKey: OBSERVER });
  await ingestBattlelog(db, {
    observerTag: OBSERVER,
    receiptId,
    payload: await fixture("player_battlelog/with_path_of_legend.json"),
  });
  // Learned five minutes after each was played, as collectors capture.
  await db.query(
    `update battle set created_at = battle_time + interval '5 minutes'`,
  );
  person = (
    await db.query(
      `insert into account (email_hash, status, timezone)
       values ('synd-person', 'approved', 'America/Chicago') returning account_id`,
    )
  ).rows[0].account_id;
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship, notify)
     values ($1, $2, 'unverified', true, 'primary', true)`,
    [person, OBSERVER],
  );
});

after(async () => ctx?.drop());

test("a sitting is posted once, edited as it grows, and edited once more when it closes", async () => {
  await enable(person, "2026-09-02T17:00Z");
  const { sent, outbox } = recorder();
  // 18:15: the 17:46 sitting has five battles learned and is still open.
  await syncAccount(ctx.db, person, {
    outbox,
    now: Date.parse("2026-09-02T18:15Z"),
  });
  assert.equal(sent.length, 1);
  const first = sent[0].message;
  assert.equal(sent[0].lane, "timeline-discord");
  assert.equal(validateTimelineDiscordMessage(first).ok, true);
  // Copied sealed; only the relay's key opens it.
  assert.equal(open(first.webhook, person), HOOK);
  assert.equal(
    open(first.webhook, "0b6b5a59-0e4f-4f39-9d55-58e41b6a3e7a"),
    null,
  );
  assert.equal(first.posts.length, 1);
  const sitting = first.posts[0];
  assert.match(
    sitting.content,
    /^<t:\d+:t> .* played a session of 5 battles .*still going\./,
  );
  assert.match(
    sitting.content,
    /\]\(<https:\/\/elixir\.poapkings\.com\/console\/explore\/player\/UVQ8RJYG9>\)$/,
    "links are masked around an angle-bracketed address, which Discord never previews",
  );
  const [row] = await told(person);
  assert.equal(row.item_id, sitting.key);
  assert.equal(row.open_from.toISOString(), "2026-09-02T17:46:25.000Z");

  // 18:40: more battles of the same sitting, read from its start, so the
  // edit tells all of it under the same key at a higher revision.
  await syncAccount(ctx.db, person, {
    outbox,
    now: Date.parse("2026-09-02T18:40Z"),
  });
  assert.equal(sent.length, 2);
  const grown = sent[1].message.posts;
  assert.equal(grown.length, 1);
  assert.equal(grown[0].key, sitting.key);
  assert.ok(grown[0].revision > sitting.revision);
  assert.match(grown[0].content, /a session of 10 battles .*still going/);

  // Nothing new: nothing is written.
  await syncAccount(ctx.db, person, {
    outbox,
    now: Date.parse("2026-09-02T18:41Z"),
  });
  assert.equal(sent.length, 2);

  // 20:30: the sitting closed with no new battle, and is edited once to
  // drop "still going"; the 19:20 battle is a sitting of its own.
  await syncAccount(ctx.db, person, {
    outbox,
    now: Date.parse("2026-09-02T20:30Z"),
  });
  const closing = sent[2].message.posts;
  const edit = closing.find((p) => p.key === sitting.key);
  assert.ok(edit.revision > grown[0].revision);
  assert.match(edit.content, /a session of 10 battles \(7W-3L; 10 ranked\)\./);
  assert.doesNotMatch(edit.content, /still going/);
  assert.equal(closing.length, 2);
  assert.ok(
    (await told(person)).every((r) => r.open_from === null),
    "a closed sitting is not read again",
  );
});

test("turning it on never backfills: what was observed before is not posted", async () => {
  // The 19:20 battle was learned at 19:25, before it was turned on.
  await enable(person, "2026-09-02T20:00Z");
  const { sent, outbox } = recorder();
  await syncAccount(ctx.db, person, {
    outbox,
    now: Date.parse("2026-09-02T20:30Z"),
  });
  assert.equal(sent.length, 0);
  const {
    rows: [d],
  } = await ctx.db.query(
    `select synced_to from timeline_discord where account_id = $1`,
    [person],
  );
  assert.equal(d.synced_to.toISOString(), "2026-09-02T20:30:00.000Z");
});

test("off, or a webhook Discord says is gone, posts nothing", async () => {
  await enable(person, "2026-09-02T17:00Z");
  const { sent, outbox } = recorder();
  const fp = webhookFingerprint(HOOK);
  // A gone status from before the webhook was saved is about an older
  // save, and is ignored.
  const stale = { state: "gone", webhook: fp, at: "2026-09-02T16:00:00Z" };
  await syncAccount(ctx.db, person, {
    outbox,
    readStatus: async () => stale,
    now: Date.parse("2026-09-02T18:15Z"),
  });
  assert.equal(sent.length, 1);
  const gone = { state: "gone", webhook: fp, at: "2026-09-02T18:20:00Z" };
  const out = await syncAccount(ctx.db, person, {
    outbox,
    readStatus: async () => gone,
    now: Date.parse("2026-09-02T18:40Z"),
  });
  assert.deepEqual(out, { disabled: "webhook_gone" });
  assert.equal(sent.length, 1);
  const row = await readDiscordSetting(ctx.db, person);
  assert.equal(row.enabled, false);
  assert.equal(row.disabled_reason, "webhook_gone");
  assert.equal(settingView(row).disabled_reason, "webhook_gone");
  assert.deepEqual(
    await syncAccount(ctx.db, person, {
      outbox,
      now: Date.parse("2026-09-02T19:00Z"),
    }),
    { skipped: "off" },
  );
  assert.equal(sent.length, 1);
});

test("an admission wakes the accounts its tag reaches, once a minute each", async () => {
  await enable(person, "2026-09-02T17:00Z");
  const db = ctx.db;
  const agent = (
    await db.query(
      `insert into account (email_hash, status, kind, owned_by_account_id)
       values (null, 'approved', 'agent', $1) returning account_id`,
      [person],
    )
  ).rows[0].account_id;
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'POAP KINGS') on conflict do nothing`,
    [CLAN],
  );
  await db.query(
    `insert into account_clan (account_id, clan_tag, scope, notify) values ($1, $2, 'comprehensive', true)`,
    [agent, CLAN],
  );
  await enable(agent, "2026-09-02T17:00Z");
  // The player's own admission reaches the person who follows them; the
  // clan's reaches the agent that follows it.
  assert.deepEqual(await accountsToWake(db, OBSERVER), [person]);
  assert.deepEqual(await accountsToWake(db, CLAN), [agent]);
  // A member's battles reach the clan's followers too.
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at)
     values ($1, $2, now())`,
    [CLAN, OBSERVER],
  );
  assert.deepEqual(
    new Set(await accountsToWake(db, OBSERVER)),
    new Set([person, agent]),
  );
  assert.deepEqual(
    new Set(await accountsToWake(db, CLAN)),
    new Set([person, agent]),
  );
  await db.query(
    `update timeline_discord set enabled = false where account_id = $1`,
    [agent],
  );
  assert.deepEqual(await accountsToWake(db, CLAN), [person]);
  assert.deepEqual(await accountsToWake(db, "#NOBODY"), []);

  const { sent, outbox } = recorder();
  const now = Date.parse("2026-10-10T12:00:30Z");
  assert.equal(await wakeSyndication(db, OBSERVER, { outbox, now }), 1);
  assert.deepEqual(sent, [
    {
      lane: "timeline-sync",
      message: { v: 1, account_id: person },
      opts: { id: `${person}.${Math.floor(now / 60_000)}`, once: true },
    },
  ]);
  assert.equal(await wakeSyndication(db, OBSERVER, { outbox: null, now }), 0);
});

test("the setting: a Discord webhook only, a hello on each new start, never the URL shown whole", async () => {
  const db = ctx.db;
  const owner = (
    await db.query(
      `insert into account (email_hash, status) values ('synd-setting', 'approved') returning account_id`,
    )
  ).rows[0].account_id;
  const { sent, outbox } = recorder();
  const now = Date.parse("2026-10-10T12:00:00Z");
  assert.deepEqual(
    await saveDiscordSetting(
      db,
      owner,
      { url: "https://example.com/hook", enabled: true },
      { outbox, seal, now },
    ),
    { error: "webhook_invalid" },
  );
  assert.deepEqual(
    await saveDiscordSetting(
      db,
      owner,
      { enabled: true },
      { outbox, seal, now },
    ),
    { error: "webhook_required" },
  );
  const on = await saveDiscordSetting(
    db,
    owner,
    { url: HOOK.replace("discord.com", "discordapp.com"), enabled: true },
    { outbox, seal, now },
  );
  assert.equal(
    open(on.row.webhook_sealed, owner),
    HOOK,
    "stored normalized, sealed",
  );
  assert.equal(on.row.webhook_fp, webhookFingerprint(HOOK));
  assert.equal(sent.length, 1);
  const hello = sent[0].message;
  assert.equal(validateTimelineDiscordMessage(hello).ok, true);
  assert.equal(hello.kind, "hello");
  assert.match(hello.posts[0].content, /not endorsed by Supercell/);
  const view = settingView(on.row);
  assert.equal(view.enabled, true);
  assert.ok(
    !JSON.stringify(view).includes("a".repeat(20)),
    "the token never reaches the view",
  );

  // Saving it again unchanged sends nothing; off, then on, starts again.
  await saveDiscordSetting(
    db,
    owner,
    { enabled: true },
    { outbox, seal, now: now + 1000 },
  );
  assert.equal(sent.length, 1);
  const off = await saveDiscordSetting(
    db,
    owner,
    { enabled: false },
    { outbox, seal, now: now + 2000 },
  );
  assert.equal(off.row.enabled, false);
  assert.equal(off.row.disabled_reason, "owner");
  const again = await saveDiscordSetting(
    db,
    owner,
    { enabled: true },
    { outbox, seal, now: now + 3000 },
  );
  assert.equal(again.row.enabled, true);
  assert.equal(again.row.disabled_reason, null);
  assert.equal(
    again.row.enabled_at.getTime(),
    now + 3000,
    "a new start: nothing earlier is posted",
  );
  assert.equal(sent.length, 2);
  // A new webhook while on is a new start too.
  const moved = await saveDiscordSetting(
    db,
    owner,
    {
      url: `https://discord.com/api/webhooks/223456789012345678/${"b".repeat(68)}`,
      enabled: true,
    },
    { outbox, seal, now: now + 4000 },
  );
  assert.equal(moved.row.enabled_at.getTime(), now + 4000);
  assert.equal(sent.length, 3);
  assert.notEqual(open(sent[2].message.webhook, owner), HOOK);
});
