import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEmailMessage, OWNER_NOTIFY_KINDS } from "../dist/index.js";

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
