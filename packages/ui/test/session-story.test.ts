import { expect, test } from "vitest";
import {
  compactSitting,
  sessionHeadline,
  sessionPath,
  sessionPathOf,
} from "../src/session-story.ts";

const item = {
  id: "tl_0000000000000000c001",
  kind: "battle_session",
  evidence: { kind: "session" },
  facts: { player_tag: "#0QQG0JVQQ", started_at: "2026-11-16T15:02:00.000Z" },
};

test("a sitting's page: its player without the hash, its id, its start", () => {
  expect(sessionPathOf(item)).toBe(
    "/home/player/0QQG0JVQQ/session/tl_0000000000000000c001?at=2026-11-16T15%3A02%3A00.000Z",
  );
  expect(sessionPath("#0QQG0JVQQ", "tl_x")).toBe(
    "/home/player/0QQG0JVQQ/session/tl_x",
  );
});

test("no page for another kind, or an old row missing a part", () => {
  expect(sessionPathOf({ ...item, kind: "battle_highlight" })).toBeNull();
  expect(sessionPathOf({ ...item, evidence: null })).toBeNull();
  expect(sessionPathOf({ ...item, id: "" })).toBeNull();
  expect(sessionPathOf({ ...item, facts: { started_at: "x" } })).toBeNull();
  expect(sessionPathOf(null)).toBeNull();
});

test("the headline is the facts, never a verdict; two battles are compact", () => {
  expect(
    sessionHeadline({
      battles: 12,
      won: 8,
      lost: 4,
      won_in_a_row: 5,
      by_mode: { ladder: 12 },
    }),
  ).toBe("Won 8 of 12 on Trophy Road, 5 in a row");
  expect(
    sessionHeadline({ battles: 3, won: 0, lost: 3, by_mode: { ranked: 3 } }),
  ).toBe("3 battles in Ranked");
  expect(compactSitting({ battles: 2 })).toBe(true);
  expect(compactSitting({ battles: 3 })).toBe(false);
});
