import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { ItemList } from "../src/home/Player.jsx";
import { FeedItem, FeedRows } from "../src/home/FeedItem.jsx";

vi.mock("../src/App.jsx", () => ({
  useMe: () => ({ me: { features: { comments: true, posts: true } } }),
}));
vi.mock("../src/analytics.js", () => ({ trackEvent: () => {} }));
const tag = "#0QPPRRC9";
const item = (n, kind, extra = {}) => ({
  id: `tl_${String(n).padStart(20, "0")}`,
  kind,
  section: "progress",
  visibility: "public",
  at: "2026-11-18T15:00:00Z",
  text: "Pip played a battle.",
  subjects: [{ kind: "player", tag, name: "Pip" }],
  subject_tag: tag,
  facts: {
    player_tag: tag,
    battles: 1,
    won: 1,
    lost: 0,
    by_mode: { ladder: 1 },
    started_at: "2026-11-18T14:55:00Z",
    ended_at: "2026-11-18T15:00:00Z",
  },
  cheers: { well_played: 2, royal: 3 },
  my_cheer: null,
  comments: { count: 0, latest: [], open: true },
  ...extra,
});
let reads;
beforeEach(() => {
  reads = [];
  global.fetch = vi.fn(async (p) => {
    const url = String(p);
    reads.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        comments: [],
        count: 0,
        open: true,
        next_before: null,
      }),
      text: async () =>
        JSON.stringify({
          comments: [],
          count: 0,
          open: true,
          next_before: null,
        }),
    };
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test.each([
  [
    "full session",
    item(1, "battle_session", {
      facts: { battles: 8, won: 5, lost: 3, by_mode: { ladder: 8 } },
    }),
  ],
  ["compact session", item(2, "battle_session")],
  ["compact moment", item(3, "badge_earned")],
  ["notable moment", item(4, "best_trophies_band", { facts: { best: 9500 } })],
  [
    "clan",
    item(5, "race_finished", {
      subjects: [{ kind: "clan", tag: "#0QC8RCGY", name: "Pip's Clan" }],
    }),
  ],
  [
    "question",
    item(6, "post", {
      post: {
        id: "401",
        text: "Which card do you enjoy?",
        question: true,
        author: { name: "Pip" },
      },
    }),
  ],
])(
  "%s has one social row in a fixed order with its thread below",
  async (_, it) => {
    const { container } = renderWithProviders(<FeedRows rows={[{ it }]} />);
    const row = container.querySelector(".kit-item-actions__row");
    expect(row).not.toBeNull();
    expect(within(row).queryByRole("link", { name: /play.*drop/i })).toBeNull();
    const buttons = within(row).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Cheer: Well played",
      "Choose a cheer",
      it.kind === "post" ? "0 answers" : "Comment",
      "Share",
    ]);
    fireEvent.click(buttons[2]);
    await screen.findByRole("textbox", {
      name: it.kind === "post" ? "Your answer" : "Your comment",
    });
    expect(row.querySelector(".kit-comments__thread")).toBeNull();
    expect(
      container
        .querySelector(".kit-item-actions")
        .querySelector(".kit-comments__thread"),
    ).not.toBeNull();
  },
);

test.each(["battle_session", "badge_earned", "best_trophies_band"])(
  "%s forwards an exact conversation entry through its render branch",
  async (kind) => {
    const it = item(9, kind);
    renderWithProviders(
      <FeedRows
        rows={[{ it }]}
        commentEntry={{ itemId: it.id, reply: "17", after: "all" }}
      />,
    );
    await waitFor(() =>
      expect(reads.some((u) => u.includes("around=17"))).toBe(true),
    );
  },
);

test("a public card exposes no social controls or comment content", () => {
  const { container } = renderWithProviders(
    <FeedItem it={item(10, "badge_earned")} publicView />,
  );
  expect(container.querySelector(".kit-item-actions")).toBeNull();
  expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
});

test("a targeted entry opens its folded group and reads only that item's conversation", async () => {
  const a = item(21, "badge_earned"),
    b = item(22, "badge_earned");
  renderWithProviders(
    <FeedRows
      rows={[{ it: a }, { it: b }]}
      commentEntry={{ itemId: b.id, reply: "17", after: "all" }}
    />,
  );
  await waitFor(() =>
    expect(reads.some((u) => u.includes("around=17"))).toBe(true),
  );
  const commentReads = reads.filter((u) => u.startsWith("/api/me/comments?"));
  expect(commentReads.length).toBeGreaterThan(0);
  expect(commentReads.every((u) => u.includes(b.id))).toBe(true);
});

test("a private item keeps source restrictions on sharing and commenting", () => {
  const it = item(23, "member_away", {
    section: "attested",
    visibility: "leaders",
    comments: null,
  });
  const { container } = renderWithProviders(<FeedItem it={it} />);
  expect(container.querySelector(".kit-item-actions__row")).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
});

const dropResult = (kind, facts) =>
  item(31, kind, {
    section: "attested",
    visibility: "player",
    facts: { player_tag: tag, game_id: "private-game-id", ...facts },
  });

test.each([
  ["surge", "/#/surge"],
  ["trade", "/#/trade"],
  ["practice", "/#/practice"],
  ["higher-lower", "/#/higher-lower"],
  ["survival", "/#/survival"],
  ["rain", "/#/rain"],
  ["exact-ten", "/#/exact-ten"],
  ["//untrusted.example", "/"],
  [undefined, "/"],
])("a Drop result opens the game for mode %s", (mode, path) => {
  const it = dropResult("drop_game", { mode });
  renderWithProviders(<FeedRows rows={[{ it }]} />);
  const row = screen.getByRole("group", { name: "Item actions" });
  const play = within(row).getByRole("link", { name: /play.*drop/i });
  expect(play.href).toBe("https://drop.poapkings.com" + path);
  expect(play.target).toBe("_blank");
  expect(play.rel.split(" ")).toContain("noreferrer");
  expect(within(row).queryByRole("button", { name: "Share" })).toBeNull();
});

test("the player Timeline puts Play beside the existing conversation", () => {
  const result = dropResult("drop_game", { mode: "surge" });
  delete result.comments; // Player items load the thread on demand.
  renderWithProviders(<ItemList items={[result]} tag={tag} />);
  const row = screen.getByRole("group", { name: "Item actions" });
  expect(within(row).getByRole("link", { name: /play.*drop/i }).hash).toBe(
    "#/surge",
  );
  expect(within(row).getByRole("button", { name: "Comments" })).toBeTruthy();
});

test("only a personal best attributed to Drop offers Play", () => {
  const best = (app) =>
    dropResult("personal_record", { game: "Surge", attested_by: { app } });
  const { rerender } = renderWithProviders(
    <FeedRows rows={[{ it: best("another app") }]} />,
  );
  expect(screen.queryByRole("link", { name: /play.*drop/i })).toBeNull();
  rerender(<FeedRows rows={[{ it: best("Elixir Drop") }]} />);
  expect(screen.getByRole("link", { name: /play.*drop/i }).href).toBe(
    "https://drop.poapkings.com/",
  );
});
