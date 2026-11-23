/**
 * A product update in the Timeline (2026-11-23): a What's new entry marked
 * for everyone, drawn as a story from Elixir with its title, its first
 * paragraph whole and a link to its page on the site, and nothing to cheer,
 * comment on or share.
 */
import { test, expect, vi, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { feedRows, feedShown } from "../src/home/logic.js";
import { FeedRows } from "../src/home/FeedItem.jsx";

vi.mock("../src/analytics.js", () => ({ trackEvent: () => {} }));

afterEach(cleanup);

/** As GET /api/me/home/feed carries one (product-updates.mjs). */
const update = {
  id: "product_update:2026-11-23-a-new-thing",
  kind: "product_update",
  section: "product",
  at: "2026-11-23T15:19:29.000Z",
  sort_at: "2026-11-23T15:19:29.000Z",
  observed_at: "2026-11-23T15:19:29.000Z",
  subject_tag: null,
  subjects: [],
  groups: [],
  text: "A new thing",
  product_update: {
    title: "A new thing",
    lede: "Something you will notice, told in one short paragraph.",
    path: "/updates/2026-11-23-a-new-thing",
  },
};

test("a product update is from Elixir, whole, with a link to its page", () => {
  renderWithProviders(
    <FeedRows
      rows={feedRows([{ it: update, isNew: false, newLine: false }])}
    />,
  );
  expect(screen.getByText("Elixir")).toBeTruthy();
  expect(screen.getByText("A new thing")).toBeTruthy();
  expect(
    screen.getByText("Something you will notice, told in one short paragraph."),
  ).toBeTruthy();
  const link = screen.getByRole("link", { name: "Read more" });
  expect(link.getAttribute("href")).toBe("/updates/2026-11-23-a-new-thing");
  // Nothing to cheer, comment on or share.
  expect(screen.queryAllByRole("button")).toEqual([]);
});

test("a product update sits under Everyone only", () => {
  expect(feedShown([update], "everyone")).toEqual([update]);
  for (const chip of ["you", "friends", "clan", "close", "questions"])
    expect(feedShown([update], chip)).toEqual([]);
});
