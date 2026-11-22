/**
 * What the bell works out away from the drawing (2026-11-12): its count,
 * what opening it clears, and its rows. Invented players only.
 */
import { test, expect } from "vitest";
import {
  accountRows,
  answerRows,
  bellCount,
  bellGroups,
  newestFirst,
  bellLabel,
  bellSeenAt,
  commentRows,
  followerRows,
  reactionRow,
} from "../src/shell/bell-logic.js";

test("the count is what needs you plus what came since the bell was opened", () => {
  expect(bellCount(0, undefined)).toBe(0);
  expect(bellCount(2, { new: 3 })).toBe(5);
  expect(bellLabel("Notifications", {})).toBe("Notifications");
  expect(bellLabel("Notifications", { need: 0, fresh: 4 })).toBe(
    "Notifications, 4 new",
  );
  // What waits on you and what is new are said apart (#1009).
  expect(bellLabel("Notifications", { need: 1, fresh: 3 })).toBe(
    "Notifications, 1 needs you, 3 new",
  );
  expect(bellLabel("Notifications", { need: 2, fresh: 0 })).toBe(
    "Notifications, 2 need you",
  );
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

test("followers: named by their player, a claimed one not verified, Follow back when it is yours to follow; no-player accounts one counted line", () => {
  const { rows, counted } = followerRows({
    unnamed: 1,
    no_player: 1,
    players: [
      {
        tag: "#0CR",
        name: "Invented Fan",
        verified: true,
        followed_tag: "#0J8",
        new: false,
        can_follow_back: true,
      },
      {
        tag: "#0G2ULUJP",
        name: null,
        verified: false,
        followed_tag: "#0J8",
        new: true,
        can_follow_back: true,
      },
    ],
  });
  expect(rows).toEqual([
    {
      key: "#0CR-#0J8",
      icon: "user-plus",
      title: "Invented Fan",
      tag: "#0CR",
      name: "Invented Fan",
      verified: true,
      followBack: true,
      followed: "#0J8",
      to: "/home/player/0CR",
      new: false,
    },
    {
      key: "#0G2ULUJP-#0J8",
      icon: "user-plus",
      title: "#0G2ULUJP",
      tag: "#0G2ULUJP",
      name: null,
      // Claimed, not verified: named, marked, and Follow back as for others.
      verified: false,
      followBack: true,
      followed: "#0J8",
      to: "/home/player/0G2ULUJP",
      new: true,
    },
  ]);
  expect(counted).toBe("1 more follower with no player added yet");
  expect(followerRows({ unnamed: 2, no_player: 2, players: [] }).counted).toBe(
    "2 more followers with no player added yet",
  );
  // Past the list's cap, the rest are counted apart.
  expect(followerRows({ unnamed: 5, no_player: 2, players: [] }).counted).toBe(
    "2 more followers with no player added yet · 3 more, not listed here",
  );
  // An older read: no `verified`, no `no_player`.
  expect(
    followerRows({ unnamed: 1, players: [{ tag: "#0CR" }] }),
  ).toMatchObject({
    rows: [{ verified: true }],
    counted: "1 more follower with no player added yet",
  });
  expect(followerRows({ unnamed: 0, players: [] }).counted).toBeNull();
});

test("answers open their page in Settings", () => {
  expect(
    answerRows({
      items: [
        { id: 9, about: "", responded_at: "2026-11-12T10:00:00Z", new: false },
      ],
    }),
  ).toEqual([
    {
      key: "answer-9",
      icon: "message-square",
      title: "Elixir answered your feedback",
      about: null,
      at: "2026-11-12T10:00:00Z",
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
        subjects: [{ tag: "#000880", name: "Invented One", kind: "player" }],
        new: true,
      },
      {
        kind: "claim_added",
        at: "2026-11-12T17:00:00.000Z",
        events: 1,
        players: 1,
        clans: 0,
        subjects: [{ tag: "#09CCYU", name: "Invented Two", kind: "player" }],
        new: true,
      },
      {
        kind: "claim_ended",
        at: "2026-11-12T16:00:00.000Z",
        events: 1,
        players: 1,
        clans: 0,
        subjects: [{ tag: "#0GLP0L", name: null, kind: "player" }],
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
    "No longer yours: #0GLP0L",
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

test("a new Stamp is one line, at its level, to the passport's sheet (#1015)", () => {
  const at = "2026-11-14T12:00:00.000Z";
  const base = { events: 1, players: 0, clans: 0, subjects: [], at };
  const rows = accountRows({
    items: [
      {
        ...base,
        kind: "stamp_earned",
        stamp_id: "cheerleader",
        name: "Cheerleader",
        level: 2,
        levels: 3,
        new: true,
      },
      {
        ...base,
        kind: "stamp_earned",
        stamp_id: "on_the_map",
        name: "On the Map",
        level: 1,
        levels: 1,
        new: false,
      },
    ],
  });
  expect(rows.map((r) => [r.title, r.to, r.new, r.detail])).toEqual([
    [
      "New Stamp: Cheerleader II",
      "/home/passport?stamp=cheerleader",
      true,
      null,
    ],
    ["New Stamp: On the Map", "/home/passport?stamp=on_the_map", false, null],
  ]);
});

test("an account made before Stamps gets one passport line, never a line per old Stamp (#1015)", () => {
  const at = "2026-11-14T12:00:00.000Z";
  const base = { events: 1, players: 0, clans: 0, subjects: [], at };
  const rows = accountRows({
    items: [
      { ...base, kind: "passport_ready", stamps: 4, new: true },
      { ...base, kind: "passport_ready", stamps: 1, new: false },
    ],
  });
  expect(rows.map((r) => [r.title, r.detail, r.to, r.new])).toEqual([
    [
      "Your passport is ready",
      "4 Stamps you had already earned are in it.",
      "/home/passport",
      true,
    ],
    [
      "Your passport is ready",
      "1 Stamp you had already earned is in it.",
      "/home/passport",
      false,
    ],
  ]);
});

test("one inbox: New then Earlier, every kind keyed; what you left new stays new, but the row you opened (#1009)", () => {
  const bell = {
    players: 1,
    reactions: {
      items: [
        { item_id: "tl_a", text: "A", cheers: { royal: 1 }, new: true },
        { item_id: "tl_b", text: "B", cheers: { royal: 2 }, new: false },
      ],
    },
    followers: {
      unnamed: 1,
      players: [{ tag: "#0CR", name: "Invented Fan", followed_tag: "#0J8" }],
    },
    answers: { items: [{ id: 7, about: "Slow", new: true }] },
    account: {
      items: [
        { kind: "passport_ready", stamps: 2, at: "2026-11-14T12:00:00Z" },
        { kind: "passport_ready", stamps: 2, at: "2026-11-14T12:00:00Z" },
      ],
    },
  };
  const first = bellGroups(bell);
  expect(first.fresh.map((r) => [r.kind, r.key])).toEqual([
    ["cheer", "tl_a"],
    ["answer", "answer-7"],
  ]);
  // Newest first across kinds (2026-11-22); rows with no time after.
  expect(first.earlier.map((r) => r.key)).toEqual([
    "passport-ready-2026-11-14T12:00:00Z",
    // Two lines at one instant keep apart.
    "passport-ready-2026-11-14T12:00:00Z~2",
    "tl_b",
    "#0CR-#0J8",
  ]);
  expect(first.counted).toBe("1 more follower with no player added yet");
  // Back from a row: the read says nothing is new any more (the marker
  // moved), but what was new then is kept (the sheet leaves out the row
  // you opened).
  const seen = bellSeenAt(bell, "2026-11-14T13:00:00Z");
  const back = bellGroups(seen, { keep: new Set(["tl_a"]) });
  expect(back.fresh.map((r) => r.key)).toEqual(["tl_a", "answer-7"]);
  expect(bellGroups(seen).fresh.map((r) => r.key)).toEqual(["answer-7"]);
  expect(bellGroups(null)).toEqual({ fresh: [], earlier: [], counted: null });
});

test("a comment row names who said it, its words, and opens its thread or your player's page; new until read (2026-11-16, 2026-11-22)", () => {
  const bell = {
    seen_at: null,
    new: 1,
    reactions: { new: 0, items: [] },
    followers: { new: 0, unnamed: 0, players: [] },
    answers: { new: 0, items: [] },
    comments: {
      new: 1,
      items: [
        {
          comment_id: "7",
          item_id: "tl_0123456789abcdef0123",
          subject_tag: "#0VJ2QV",
          at: "2026-11-16T12:00:00.000Z",
          author: { account_id: "p1", player_tag: "#0GVJ9V", name: "Ada" },
          text: "gg",
          new: true,
        },
      ],
    },
  };
  const [row] = commentRows(bell.comments);
  expect(row).toMatchObject({
    key: "comment-7",
    icon: "message-circle",
    who: "Ada",
    tag: "#0GVJ9V",
    text: "gg",
    new: true,
  });
  expect(row.to).toBe("/home/player/0VJ2QV");
  const { fresh } = bellGroups(bell);
  expect(fresh.map((r) => r.kind)).toEqual(["comment"]);
  // Opening the bell is not reading it: new until its thread is opened
  // (2026-11-22), and the badge still counts it.
  const after = bellSeenAt(bell, "2026-11-16T13:00:00.000Z");
  expect(after.comments.items[0].new).toBe(true);
  expect(after.comments.new).toBe(1);
  expect(after.new).toBe(1);
  expect(bellGroups(after).fresh.map((r) => r.kind)).toEqual(["comment"]);
  // With its item's locator, a game comment opens that item's thread.
  const [withRef] = commentRows({
    items: [
      {
        ...bell.comments.items[0],
        item_ref: {
          item_id: "tl_0123456789abcdef0123",
          kind: "pb",
          source: "game",
          subject: { kind: "player", tag: "#0VJ2QV" },
          at: "2026-11-16T11:00:00.000Z",
        },
      },
    ],
  });
  expect(withRef.to).toMatch(/^\/home\/item\/tl_0123456789abcdef0123\?ref=/);
  expect(withRef.to).toContain("reply=");
  // A read with comments off carries none, and opening it adds none.
  expect(commentRows(undefined)).toEqual([]);
  const off = { ...bell };
  delete off.comments;
  expect("comments" in bellSeenAt(off, null)).toBe(false);
});

test("each part runs newest first across kinds; rows with no time keep their order after (2026-11-22)", () => {
  const rows = newestFirst([
    { key: "a", at: "2026-11-20T10:00:00Z" },
    { key: "f1" },
    { key: "b", at: "2026-11-22T10:00:00Z" },
    { key: "f2", at: null },
    { key: "c", at: "2026-11-21T10:00:00Z" },
  ]);
  expect(rows.map((r) => r.key)).toEqual(["b", "c", "a", "f1", "f2"]);
});
