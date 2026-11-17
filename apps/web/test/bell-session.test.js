/**
 * A cheer on a sitting opens the session's own page (2026-11-16); a
 * moment still opens its battle. Invented players only.
 */
import { test, expect } from "vitest";
import { reactionRow } from "../src/shell/bell-logic.js";

const PATH =
  "/home/player/0QQG0JVQQ/session/tl_0000000000000000c001?at=2026-11-16T15%3A02%3A00.000Z";

test("a sitting's row opens its session page, before any battle", () => {
  expect(
    reactionRow({
      item_id: "tl_0000000000000000c001",
      cheers: { fire: 2 },
      total: 2,
      session_path: PATH,
      battle_url: "https://elixir.poapkings.com/battle/a1b2c3d4e5f6",
    }).to,
  ).toBe(PATH);
});

test("a path that is not a session page is never opened", () => {
  const row = reactionRow({
    item_id: "tl_x",
    cheers: {},
    session_path: "https://evil.example/home/player/0QQG0JVQQ/session/x",
  });
  expect(row.to).toBeNull();
});
