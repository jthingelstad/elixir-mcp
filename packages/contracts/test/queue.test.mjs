import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateEmailMessage,
  EMAIL_KIND_CLASS,
  unsubscribeHeaders,
  validateResultMessage,
  crBattleTime,
  OWNER_NOTIFY_KINDS,
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
  for (const kind of Object.keys(EMAIL_KIND_CLASS))
    assert.equal(
      EMAIL_KIND_CLASS[kind],
      "transactional",
      `${kind} is transactional today`,
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
  // A bulk kind, were one added: the headers the relay would send.
  const digest = {
    v: 1,
    kind: "digest",
    to: "a@b.c",
    unsubscribe: { url: "https://x/u?t=1" },
  };
  const saved = EMAIL_KIND_CLASS.digest;
  EMAIL_KIND_CLASS.digest = "bulk";
  try {
    assert.equal(validateEmailMessage(digest).ok, true);
    assert.deepEqual(unsubscribeHeaders(digest), [
      { name: "List-Unsubscribe", value: "<https://x/u?t=1>" },
      { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
    ]);
    const bare = validateEmailMessage({ ...digest, unsubscribe: undefined });
    assert.equal(bare.ok, false);
    assert.ok(bare.errors.includes("unsubscribe:missing"));
    const http = validateEmailMessage({
      ...digest,
      unsubscribe: { url: "http://x/u" },
    });
    assert.ok(
      !http.ok && http.errors.includes("unsubscribe:missing"),
      "https only",
    );
  } finally {
    if (saved === undefined) delete EMAIL_KIND_CLASS.digest;
    else EMAIL_KIND_CLASS.digest = saved;
  }
});
