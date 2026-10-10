import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDiscordWebhook,
  validateTimelineDiscordMessage,
  webhookDisplay,
  webhookFingerprint,
  timelineDiscordStateKey,
  timelineDiscordStatusKey,
  outboxKey,
} from "../dist/index.js";

const ID = "123456789012345678";
const TOKEN =
  "abcDEF_ghi-JKLmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXyz12";
const URL = `https://discord.com/api/webhooks/${ID}/${TOKEN}`;

test("a Discord webhook is normalized to discord.com, whatever spelling Discord handed out", () => {
  for (const s of [
    URL,
    `${URL}/`,
    `  ${URL}  `,
    `https://discordapp.com/api/webhooks/${ID}/${TOKEN}`,
    `https://canary.discord.com/api/webhooks/${ID}/${TOKEN}`,
    `https://ptb.discordapp.com/api/v10/webhooks/${ID}/${TOKEN}`,
  ])
    assert.deepEqual(parseDiscordWebhook(s), {
      url: URL,
      id: ID,
      token: TOKEN,
    });
});

test("anything but Discord's own webhook address is refused, so nothing else is ever called", () => {
  for (const s of [
    undefined,
    "",
    "not a url",
    `http://discord.com/api/webhooks/${ID}/${TOKEN}`,
    `https://discord.com.evil.example/api/webhooks/${ID}/${TOKEN}`,
    `https://evil.example/api/webhooks/${ID}/${TOKEN}`,
    `https://user:pw@discord.com/api/webhooks/${ID}/${TOKEN}`,
    `https://discord.com:8443/api/webhooks/${ID}/${TOKEN}`,
    `https://discord.com/api/webhooks/${ID}`,
    `https://discord.com/api/webhooks/abc/${TOKEN}`,
    `https://discord.com/api/webhooks/${ID}/short`,
    `https://discord.com/api/webhooks/${ID}/${TOKEN}/slack`,
    `https://discord.com/api/webhooks/${ID}/${TOKEN}?thread_id=1`,
    `https://discord.com/api/webhooks/${ID}/${TOKEN}#x`,
    `https://discord.com/api/channels/${ID}/${TOKEN}`,
  ])
    assert.equal(parseDiscordWebhook(s), null, String(s));
});

test("the console shows the webhook id and the token's last four, never the token", () => {
  const shown = webhookDisplay(URL);
  assert.equal(shown, `discord.com/api/webhooks/${ID}/…${TOKEN.slice(-4)}`);
  assert.ok(!shown.includes(TOKEN.slice(0, 20)));
  assert.match(webhookFingerprint(URL), /^[a-f0-9]{16}$/);
});

test("a timeline Discord message is validated before the relay acts on it", () => {
  const box = { v: 1, iv: "aXY=", tag: "dGFn", ct: "Y3Q=" };
  const ok = {
    v: 1,
    kind: "timeline",
    account_id: "0b6b5a59-0e4f-4f39-9d55-58e41b6a3e7a",
    webhook: box,
    posts: [{ key: "tl_0123456789abcdef0123", revision: 3, content: "a line" }],
  };
  assert.equal(validateTimelineDiscordMessage(ok).ok, true);
  assert.equal(
    validateTimelineDiscordMessage({
      ...ok,
      kind: "hello",
      posts: [
        {
          key: "hello-6f1d2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
          revision: 1,
          content: "hi",
        },
      ],
    }).ok,
    true,
  );
  // The webhook travels sealed; a bare address is refused.
  const bad = validateTimelineDiscordMessage({
    ...ok,
    webhook: URL,
    posts: [{ key: "x", revision: 0, content: "y".repeat(2001) }],
  });
  assert.deepEqual(bad.errors, [
    "webhook:invalid",
    "posts[0].key:invalid",
    "posts[0].revision:invalid",
    "posts[0].content:invalid",
  ]);
  assert.deepEqual(
    validateTimelineDiscordMessage({ ...ok, posts: [] }).errors,
    ["posts:invalid"],
  );
});

test("the relay's own records sit outside the notified timeline-discord/ prefix", () => {
  assert.equal(outboxKey("timeline-discord", "x"), "timeline-discord/x.json");
  assert.equal(outboxKey("timeline-sync", "x"), "timeline-sync/x.json");
  const state = timelineDiscordStateKey("acct", "f".repeat(16), "tl_x");
  assert.ok(!state.startsWith("timeline-discord/"));
  assert.ok(!timelineDiscordStatusKey("acct").startsWith("timeline-discord/"));
});
