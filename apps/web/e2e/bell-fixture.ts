import { ME } from "./fixtures.ts";

/**
 * The bell's states (#1009) for its journeys and captures: mixed (Needs
 * you, new and earlier), empty, long. Invented players only; the tags are
 * in docs/invented-tags.json.
 */
export const TAG = "#0YV8YGYJ";

export const BELL_ME = {
  ...ME,
  claims: [
    {
      player_tag: TAG,
      name: "Invented Owl",
      is_primary: true,
      relationship: "primary",
      status: "verified",
    },
  ],
};

const HOUR = 3600_000;
const ago = (h: number) => new Date(Date.now() - h * HOUR).toISOString();

const EMPTY_ACCOUNT = { new: 0, items: [] };

/** One of each kind: cheers, followers (one to follow back, two counted),
 *  an unread answer, a Stamp; an earlier cheer and an account line. */
export const MIXED_BELL = {
  seen_at: ago(30),
  players: 1,
  new: 4,
  reactions: {
    new: 1,
    items: [
      {
        item_id: "tl_0123456789abcdef0123",
        text: "Invented Owl won five in a row",
        at: ago(5),
        battle_url: "https://elixir.example/battle/abc123",
        cheers: { on_fire: 2, royal: 1 },
        total: 3,
        new: true,
      },
      {
        item_id: "tl_0123456789abcdef0456",
        text: "Invented Owl reached Arena 18",
        at: ago(50),
        battle_url: null,
        cheers: { well_played: 1 },
        total: 1,
        new: false,
      },
    ],
  },
  followers: {
    count: 3,
    new: 1,
    unnamed: 2,
    players: [
      {
        tag: "#00J8VCYU",
        name: "Invented Fan",
        followed_tag: TAG,
        followed_name: "Invented Owl",
        new: true,
        can_follow_back: true,
      },
    ],
  },
  answers: {
    new: 1,
    items: [
      {
        id: 42,
        about: "The war tab is slow on a phone",
        status: "planned",
        responded_at: ago(3),
        new: true,
      },
    ],
  },
  account: {
    new: 1,
    items: [
      {
        kind: "stamp_earned",
        stamp_id: "cheerleader",
        name: "Cheerleader",
        level: 2,
        levels: 3,
        events: 1,
        players: 0,
        clans: 0,
        subjects: [],
        at: ago(2),
        new: true,
      },
      {
        kind: "recording_started",
        at: ago(70),
        events: 24,
        players: 24,
        clans: 0,
        subjects: [],
        new: false,
      },
    ],
  },
};

/** Nothing about you, with a verified player. */
export const EMPTY_BELL = {
  seen_at: ago(30),
  players: 1,
  new: 0,
  reactions: { new: 0, items: [] },
  followers: { count: 0, new: 0, unnamed: 0, players: [] },
  answers: { new: 0, items: [] },
  account: EMPTY_ACCOUNT,
};

/** Twenty cheered items and a long sentence: the sheet scrolls, the page
 *  does not. */
export const LONG_BELL = {
  ...MIXED_BELL,
  reactions: {
    new: 2,
    items: Array.from({ length: 20 }, (_, i) => ({
      item_id: `tl_0123456789abcdef${String(i).padStart(4, "0")}`,
      text:
        i === 0
          ? "Invented Owl played 14 battles in Path of Legends and switched to a Hog Rider cycle deck halfway through the evening"
          : `Invented Owl won ${i + 2} in a row`,
      at: ago(i * 6 + 1),
      battle_url: null,
      cheers: { on_fire: i + 1, grind: 1 },
      total: i + 2,
      new: i < 2,
    })),
  },
};

/** Clan's read with nothing waiting on you. */
export const NO_NEEDS = { needs: { ok: true, state: "none" } };
