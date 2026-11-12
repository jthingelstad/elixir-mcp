/**
 * What the bell works out away from the drawing (2026-11-12): its count,
 * what opening it clears, and its rows. Invented players only.
 */
import { test, expect } from "vitest";
import {
  accountRows,
  answerRows,
  bellCount,
  bellLabel,
  bellSeenAt,
  followerRows,
  reactionRow,
} from "../src/shell/bell-logic.js";

test("the count is what needs you plus what came since the bell was opened", () => {
  expect(bellCount(0, undefined)).toBe(0);
  expect(bellCount(2, { new: 3 })).toBe(5);
  expect(bellLabel("Notifications", 0)).toBe("Notifications");
  expect(bellLabel("Notifications", 4)).toBe("Notifications, 4 new");
});

test("opening the bell clears reactions and followers; an unread answer stays new", () => {
  const bell = {
    seen_at: null,
    new: 3,
    reactions: { new: 1, items: [{ item_id: "a", new: true }] },
    followers: { new: 1, unnamed: 0, players: [{ tag: "#2P", new: true }] },
    answers: { new: 1, items: [{ id: 1, new: true }] },
  };
  const after = bellSeenAt(bell, "2026-11-12T12:00:00.000Z");
  expect(after.seen_at).toBe("2026-11-12T12:00:00.000Z");
  expect(after.new).toBe(1);
  expect(after.reactions.items[0].new).toBe(false);
  expect(after.followers.players[0].new).toBe(false);
  expect(after.answers.items[0].new).toBe(true);
});

test("a reaction row: counts in the picker's order, never who, and a battle path only", () => {
  const row = reactionRow({
    item_id: "tl_1",
    text: "A first",
    cheers: { royal: 1, well_played: 2 },
    total: 3,
    battle_url: "https://elixir.example/battle/x1",
    new: true,
  });
  expect(row.counts.map((c) => [c.key, c.count])).toEqual([
    ["well_played", 2],
    ["royal", 1],
  ]);
  expect(row.words).toBe("Well played 2, Royal 1");
  expect(row.to).toBe("/battle/x1");
  expect(JSON.stringify(row)).not.toMatch(/account|email|who/);
  expect(reactionRow({ item_id: "tl_2", cheers: {} }).to).toBeNull();
  expect(
    reactionRow({ item_id: "tl_3", battle_url: "https://evil.example/x" }).to,
  ).toBeNull();
});

test("followers: named by their verified player, the rest one counted line", () => {
  const { rows, counted } = followerRows({
    unnamed: 1,
    players: [
      { tag: "#2PP", name: "Invented Fan", followed_tag: "#2QQ", new: false },
    ],
  });
  expect(rows).toEqual([
    {
      key: "#2PP-#2QQ",
      title: "Invented Fan",
      tag: "#2PP",
      detail: "Follows #2QQ",
      to: "/home/player/2PP",
      new: false,
    },
  ]);
  expect(counted).toMatch(/^1 more account follows you/);
  expect(followerRows({ unnamed: 0, players: [] }).counted).toBeNull();
});

test("answers open their page in Settings", () => {
  expect(answerRows({ items: [{ id: 9, about: "", new: false }] })).toEqual([
    {
      key: 9,
      title: "Your feedback",
      detail: "Answered",
      to: "/settings/feedback/9",
      new: false,
    },
  ]);
});

test("your account's lines: a burst is one line, one player opens their page", () => {
  const rows = accountRows({
    new: 2,
    items: [
      {
        kind: "recording_started",
        at: "2026-11-12T17:10:00.000Z",
        events: 24,
        players: 24,
        clans: 0,
        subjects: [{ tag: "#2PYLQ0", name: "Invented One", kind: "player" }],
        new: true,
      },
      {
        kind: "claim_added",
        at: "2026-11-12T17:00:00.000Z",
        events: 1,
        players: 1,
        clans: 0,
        subjects: [{ tag: "#2PYLQ2", name: "Invented Two", kind: "player" }],
        new: true,
      },
      {
        kind: "claim_ended",
        at: "2026-11-12T16:00:00.000Z",
        events: 1,
        players: 1,
        clans: 0,
        subjects: [{ tag: "#2PYLQ8", name: null, kind: "player" }],
        new: false,
      },
      {
        kind: "recording_stopped",
        at: "2026-11-12T15:00:00.000Z",
        events: 3,
        players: 2,
        clans: 1,
        subjects: [],
        new: false,
      },
      {
        kind: "connection_revoked",
        at: "2026-11-12T14:00:00.000Z",
        events: 6,
        players: 0,
        clans: 0,
        subjects: [],
        new: false,
      },
    ],
  });
  expect(rows.map((r) => r.title)).toEqual([
    "Recording started for 24 players",
    "Added Invented Two",
    "No longer yours: #2PYLQ8",
    "Recording stopped for 2 players and 1 clan",
    "App disconnected, 6 times",
  ]);
  expect(rows[0].to).toBe("/settings/players");
  expect(rows[1].to).toMatch(/^\/home\/player\//);
  // A player no longer yours is said with why, and opens Settings.
  expect(rows[2].to).toBe("/settings/players");
  expect(rows[2].detail).toMatch(/Another account verified it/);
  expect(rows[4].to).toBe("/settings/sign-ins");
  expect(rows.map((r) => r.new)).toEqual([true, true, false, false, false]);
  const seen = bellSeenAt(
    {
      new: 2,
      reactions: { items: [] },
      followers: { players: [] },
      answers: { new: 0, items: [] },
      account: { new: 2, items: [{ kind: "claim_added", new: true }] },
    },
    "2026-11-12T18:00:00.000Z",
  );
  expect(seen.account.items[0].new).toBe(false);
  expect(seen.account.new).toBe(0);
  expect(seen.new).toBe(0);
});
