import { test } from "node:test";
import assert from "node:assert/strict";
import { cheerableItems } from "../src/tools/elixir/cheers.mjs";

// Codex on #849: a window past the timeline's 150-item cap kept only the
// newest in `timeline`; cheers on the rest were never counted.
test("elixir_cheers counts items past the timeline's presentation cap", () => {
  const id = (n) => `tl_${String(n).padStart(20, "0")}`;
  const built = {
    timeline: [{ id: id(1), section: "battles", kind: "battle_session" }],
    timeline_dropped: [
      { id: id(2), section: "battles", kind: "battle_session" },
      { id: id(3), section: "account", kind: "sign_in" },
      { id: "not-an-item-id", section: "battles", kind: "x" },
    ],
  };
  assert.deepEqual(
    cheerableItems(built).map((it) => it.id),
    [id(1), id(2)],
  );
  assert.deepEqual(cheerableItems({}), []);
});
