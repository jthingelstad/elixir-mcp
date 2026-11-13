/**
 * Home's feed when a refetch fails (Codex on #802): the pages already read
 * stay, and a line says they may be behind, with Try again. A refetch that
 * fails with nothing read is the feed's failure. Invented players only.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, act, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { HomeFeed } from "../src/home/Feed.jsx";
import { HOME_FEED_KEY } from "../src/lib/queries.js";

vi.mock("../src/analytics.js", () => ({ trackEvent: () => {} }));

const AGO = (min) => new Date(Date.now() - min * 60_000).toISOString();
const page = (items) => ({
  as_of: AGO(0),
  window: { from: AGO(10_080), to: AGO(0) },
  seen_to: AGO(120),
  timeline: items,
  total: items.length,
  next: null,
  timeline_more: 0,
});
const item = {
  id: `tl_${"1".padStart(20, "0")}`,
  kind: "pol_league",
  at: AGO(30),
  observed_at: AGO(29),
  subject_tag: "#00JQ20",
  subject_name: "Invented 1",
  subjects: [{ tag: "#00JQ20", kind: "player", name: "Invented 1" }],
  groups: ["friends"],
  text: "Invented 1 reached Path of Legends.",
  facts: {},
};

let answer;
beforeEach(() => {
  global.fetch = vi.fn(async (path) => {
    const p = String(path).split("?")[0];
    if (p === "/api/me/home/feed") {
      if (answer === "fail")
        return { ok: false, status: 503, text: async () => "{}" };
      return { ok: true, text: async () => JSON.stringify(answer) };
    }
    return { ok: true, text: async () => JSON.stringify({}) };
  });
});
afterEach(() => cleanup());

test("a failed refetch keeps the items read and offers Try again", async () => {
  answer = page([item]);
  const { queryClient } = renderWithProviders(<HomeFeed />);
  expect(
    await screen.findByText("Invented 1 reached Path of Legends."),
  ).toBeTruthy();
  answer = "fail";
  await act(() =>
    queryClient.refetchQueries({ queryKey: HOME_FEED_KEY }).catch(() => {}),
  );
  expect(
    await screen.findByText(
      "The newest items didn’t load; these are from your last read.",
    ),
  ).toBeTruthy();
  expect(screen.getByText("Invented 1 reached Path of Legends.")).toBeTruthy();
  answer = page([item]);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await vi.waitFor(() =>
    expect(
      screen.queryByText(
        "The newest items didn’t load; these are from your last read.",
      ),
    ).toBeNull(),
  );
});

test("a failed refetch of an empty feed is the feed's failure", async () => {
  answer = page([]);
  const { queryClient } = renderWithProviders(<HomeFeed />);
  expect(
    await screen.findByText("Nothing in the last seven days"),
  ).toBeTruthy();
  answer = "fail";
  await act(() =>
    queryClient.refetchQueries({ queryKey: HOME_FEED_KEY }).catch(() => {}),
  );
  expect(await screen.findByText("Your feed didn’t load")).toBeTruthy();
});
