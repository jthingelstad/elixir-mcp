import { test } from "node:test";
import assert from "node:assert/strict";
import { underCaptureNote } from "../src/coverage.mjs";

test("underCaptureNote names members whose battles went mostly uncaptured (#196)", () => {
  const capture = new Map([
    ["#0JL99P2UR", { expected: 38, captured: 1, ratio: 1 / 38 }],
    ["#FINE", { expected: 40, captured: 39, ratio: 39 / 40 }],
    ["#QUIET", { expected: 2, captured: 0, ratio: 0 }],
  ]);
  const note = underCaptureNote(capture, (t) =>
    t === "#0JL99P2UR" ? "kiruba" : null,
  );
  assert.match(note, /kiruba #0JL99P2UR \(1 of 38, 3%\)/);
  assert.match(note, /capture gap, not inactivity/);
  assert.doesNotMatch(note, /#FINE|#QUIET/);
  assert.equal(
    underCaptureNote(new Map([["#FINE", capture.get("#FINE")]]), () => null),
    null,
  );
});
