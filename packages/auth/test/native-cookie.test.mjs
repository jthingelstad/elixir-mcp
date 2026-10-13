import { test } from "node:test";
import assert from "node:assert/strict";
import { readSessionCookie } from "../src/session.mjs";

test("native Cookie headers find the host session among other cookies", () => {
  for (const separator of ["; ", ";", ";  "]) {
    assert.equal(
      readSessionCookie({
        headers: {
          cookie: `other=value${separator}__Host-elixir_session=session${separator}last=last`,
        },
      }),
      "session",
    );
  }
  assert.equal(readSessionCookie({ headers: {} }), "");
  assert.equal(readSessionCookie({ headers: { cookie: "other=value" } }), "");
});
