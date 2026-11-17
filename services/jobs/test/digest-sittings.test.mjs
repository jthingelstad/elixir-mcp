/** The digest's sittings (2026-11-16): a person's biggest few, told newest
 *  first, each as its facts and its own page, never the timeline's
 *  sentence. Pure; invented tags. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { digestSitting, pickSittings } from "../src/email/build-digest.mjs";

const TAG = "#0QQG0JVQQ";
const sitting = (n, battles, at, extra = {}) => ({
  id: `tl_s${n}`,
  kind: battles >= 8 ? "session_standout" : "battle_session",
  at,
  sort_at: at,
  text: `Rapid Clear played ${battles} battles.`,
  subject_tag: TAG,
  evidence: { kind: "session" },
  facts: {
    player_tag: TAG,
    battles,
    won: battles - 1,
    lost: 1,
    by_mode: { ladder: battles },
    started_at: at,
    ended_at: at,
    ...extra,
  },
});

test("the three biggest, told newest first; the rest counted; nobody else's", () => {
  const items = [
    sitting(1, 1, "2026-11-10T10:00:00.000Z"),
    sitting(2, 12, "2026-11-09T10:00:00.000Z"),
    sitting(3, 2, "2026-11-08T10:00:00.000Z"),
    sitting(4, 5, "2026-11-07T10:00:00.000Z"),
    sitting(5, 1, "2026-11-06T10:00:00.000Z"),
    {
      ...sitting(6, 30, "2026-11-10T11:00:00.000Z"),
      facts: { player_tag: "#0YRL2GQP", battles: 30 },
    },
    {
      id: "tl_h",
      kind: "battle_highlight",
      subject_tag: TAG,
      facts: { player_tag: TAG },
    },
  ];
  const { shown, more } = pickSittings(items, TAG);
  assert.deepEqual(
    shown.map((s) => s.id),
    ["tl_s2", "tl_s3", "tl_s4"],
  );
  assert.equal(more, 2);
});

test("a sitting carries its facts and its page, never its sentence", () => {
  const out = digestSitting(
    sitting(2, 12, "2026-11-09T10:00:00.000Z", {
      won_in_a_row: 5,
      trophy_net: 87,
      nickname: "Moth",
    }),
  );
  assert.equal(
    out.path,
    "/home/player/0QQG0JVQQ/session/tl_s2?at=2026-11-09T10%3A00%3A00.000Z",
  );
  assert.equal(out.kind, "session_standout");
  assert.equal(out.facts.won_in_a_row, 5);
  assert.equal(out.facts.trophy_net, 87);
  // Only the named facts: no sentence, no nickname, no tag.
  assert.equal(out.text, undefined);
  assert.equal(out.facts.nickname, undefined);
  assert.equal(out.facts.player_tag, undefined);
  // An old row with no session evidence has no page.
  assert.equal(
    digestSitting({
      ...sitting(3, 2, "2026-11-08T10:00:00.000Z"),
      evidence: null,
    }).path,
    null,
  );
});
