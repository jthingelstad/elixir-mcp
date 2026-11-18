import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { FeedItem } from "../src/home/FeedItem.jsx";
const TAG = "#0PGQ2UYL";
const item = {
  id: "tl_0123456789abcdef0123",
  kind: "badge_earned",
  section: "badges",
  at: "2026-11-18T12:00:00.000Z",
  visibility: "public",
  subject_tag: TAG,
  subjects: [{ kind: "player", tag: TAG, name: "Invented Ada" }],
  facts: { badge: "MasteryKnight", badge_label: "Knight Mastery", level: 5 },
  text: "Invented Ada reached Knight Mastery level 5.",
};
const reply = (data) => ({
  ok: true,
  status: 200,
  json: async () => data,
  text: async () => JSON.stringify(data),
});
let writes;
beforeEach(() => {
  cleanup();
  writes = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = vi.fn(async (path, init = {}) => {
    if (path === "/api/me")
      return reply({
        authenticated: true,
        account_id: "a1",
        features: { posts: true, comments: true },
        claims: [
          {
            player_tag: TAG,
            is_primary: true,
            relationship: "primary",
            status: "verified",
          },
        ],
      });
    if (path === "/api/public/cards") return reply({ cards: [] });
    if (path === "/api/me/posts") {
      writes.push(JSON.parse(init.body));
      return reply({ post: {} });
    }
    return reply({});
  });
});
afterEach(() => vi.restoreAllMocks());
test("Post on an own achievement writes a locator with words, then returns focus to its trigger", async () => {
  renderWithProviders(<FeedItem it={item} />);
  const trigger = await screen.findByRole("button", { name: "Post" });
  fireEvent.click(trigger);
  const field = await screen.findByRole("textbox", { name: "Your post" });
  expect(document.activeElement).toBe(field);
  expect(screen.queryByRole("button", { name: "Add cards" })).toBeNull();
  fireEvent.change(field, { target: { value: "Finally reached this step" } });
  fireEvent.submit(field.closest("form"));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toEqual({
    text: "Finally reached this step",
    question: false,
    moment: {
      item_id: item.id,
      source: "game",
      kind: item.kind,
      at: item.at,
      subject: { kind: "player", tag: TAG },
    },
  });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Post" }),
    ),
  );
});
test("another player's achievement never offers Post", async () => {
  renderWithProviders(
    <FeedItem
      it={{
        ...item,
        subject_tag: "#0RJ29CVY",
        subjects: [
          { kind: "player", tag: "#0RJ29CVY", name: "Invented Birch" },
        ],
      }}
    />,
  );
  await waitFor(() =>
    expect(
      global.fetch.mock.calls.some(([path]) => String(path) === "/api/me"),
    ).toBe(true),
  );
  expect(screen.queryByRole("button", { name: "Post" })).toBeNull();
});
