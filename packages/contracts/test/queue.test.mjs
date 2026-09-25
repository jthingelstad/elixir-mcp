import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCT_EMAIL_KINDS,
  isProductEmailKind,
  validateEmailMessage,
  EMAIL_KIND_CLASS,
  unsubscribeHeaders,
  validateResultMessage,
  crBattleTime,
  OWNER_NOTIFY_KINDS,
  outboxKey,
  outboxObjects,
} from "../dist/index.js";

test("owner_notify carries an optional, closed notify_kind", () => {
  const base = { v: 1, kind: "owner_notify", to: "o@x.com", note: "n" };
  assert.equal(validateEmailMessage(base).ok, true, "pre-2026-09-09 shape");
  for (const notify_kind of OWNER_NOTIFY_KINDS)
    assert.equal(
      validateEmailMessage({ ...base, notify_kind }).ok,
      true,
      notify_kind,
    );
  const bad = validateEmailMessage({ ...base, notify_kind: "party" });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors, ["notify_kind:invalid"]);
});

test("a result may carry the collector's observed/filtered counts; the filter speaks the API's battleTime", () => {
  const base = {
    v: 1,
    job: { endpoint: "player_battlelog", entity_key: "#2PPLQQ", lane: "bulk" },
    gateway_id: "g",
    fetched_at: "2026-09-11T12:00:00Z",
    status: "ok",
    body_gzip_b64: "e30=",
  };
  assert.equal(validateResultMessage(base).ok, true, "counts are optional");
  assert.equal(
    validateResultMessage({ ...base, observed: 25, filtered: 20 }).ok,
    true,
  );
  assert.equal(
    validateResultMessage({ ...base, observed: 0, filtered: 0 }).ok,
    true,
  );
  for (const bad of [
    { observed: -1 },
    { observed: 1.5 },
    { filtered: "3" },
    { observed: 3, filtered: 4 },
  ]) {
    const r = validateResultMessage({ ...base, ...bad });
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
  // The lease's filter is the API's own spelling of battleTime, so a
  // collector compares strings and never parses a date.
  assert.equal(crBattleTime("2026-09-11T12:34:56Z"), "20260911T123456.000Z");
  assert.equal(
    crBattleTime("2026-09-11T12:34:56.000Z"),
    "20260911T123456.000Z",
  );
  assert.ok("20260911T123457.000Z" > crBattleTime("2026-09-11T12:34:56Z"));
});

test("mail policy: every kind is classified; bulk needs one-click unsubscribe, transactional refuses it", () => {
  // Three transactional kinds; every product kind is bulk (docs/EMAIL.md).
  for (const kind of ["login", "welcome", "owner_notify"])
    assert.equal(EMAIL_KIND_CLASS[kind], "transactional", `${kind}`);
  for (const kind of PRODUCT_EMAIL_KINDS)
    assert.equal(EMAIL_KIND_CLASS[kind], "bulk", `${kind} is bulk`);
  assert.equal(
    Object.keys(EMAIL_KIND_CLASS).length,
    3 + PRODUCT_EMAIL_KINDS.length,
    "every kind is classified, none twice",
  );
  const login = { v: 1, kind: "login", to: "a@b.c", code: "123456" };
  assert.equal(validateEmailMessage(login).ok, true);
  assert.deepEqual(
    unsubscribeHeaders(login),
    [],
    "a sign-in code carries no unsubscribe",
  );
  const mislabelled = { ...login, unsubscribe: { url: "https://x/u" } };
  const r = validateEmailMessage(mislabelled);
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes("unsubscribe:transactional"));
  // A product kind arrives rendered and carries its one-click URL.
  const report = {
    v: 1,
    kind: "clan_report",
    to: "a@b.c",
    subject: "POAP KINGS, Sep 7 – 14",
    text: "the text",
    html: "<p>the html</p>",
    unsubscribe: { url: "https://x/u?t=1" },
  };
  assert.equal(validateEmailMessage(report).ok, true);
  assert.deepEqual(unsubscribeHeaders(report), [
    { name: "List-Unsubscribe", value: "<https://x/u?t=1>" },
    { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
  ]);
  const bare = validateEmailMessage({ ...report, unsubscribe: undefined });
  assert.equal(bare.ok, false);
  assert.ok(bare.errors.includes("unsubscribe:missing"));
  const http = validateEmailMessage({
    ...report,
    unsubscribe: { url: "http://x/u" },
  });
  assert.ok(
    !http.ok && http.errors.includes("unsubscribe:missing"),
    "https only",
  );
  const unrendered = validateEmailMessage({
    ...report,
    subject: undefined,
    text: "",
  });
  assert.ok(!unrendered.ok && unrendered.errors.includes("subject:missing"));
  assert.ok(unrendered.errors.includes("text:missing"));
  assert.ok(isProductEmailKind("milestone") && !isProductEmailKind("login"));
});

test("outbox: an S3 notification names its objects; a test event names none; a plain message is not one", () => {
  assert.equal(outboxKey("email", "abc"), "email/abc.json");
  const notification = JSON.stringify({
    Records: [
      {
        eventSource: "aws:s3",
        s3: {
          bucket: { name: "elixir-mcp-outbox-1" },
          object: { key: "email/a%2Bb+c.json" },
        },
      },
    ],
  });
  assert.deepEqual(outboxObjects(notification), [
    { bucket: "elixir-mcp-outbox-1", key: "email/a+b c.json" },
  ]);
  assert.deepEqual(
    outboxObjects(
      JSON.stringify({ Service: "Amazon S3", Event: "s3:TestEvent" }),
    ),
    [],
  );
  assert.equal(outboxObjects(JSON.stringify({ v: 1, kind: "login" })), null);
  assert.equal(outboxObjects("not json"), null);
  assert.equal(
    outboxObjects(JSON.stringify({ Records: [{ eventSource: "aws:sns" }] })),
    null,
  );
});
