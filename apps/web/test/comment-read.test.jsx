import { test, expect, vi, afterEach } from "vitest";
import { screen, cleanup, within } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { Comments } from "../src/home/Comments.jsx";
import { api } from "../src/api.js";
vi.mock("../src/App.jsx", async (original) => ({
  ...(await original()),
  useMe: () => ({ me: { features: { comments: true } } }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
test("canonical per-reply receipts override a time-only entry cutoff", async () => {
  vi.spyOn(api, "comments").mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      open: false,
      comments: [
        {
          id: "51",
          at: "2026-11-17T10:00:00Z",
          text: "Unread older page",
          unread: true,
          author: { name: "Invented Reader" },
        },
        {
          id: "52",
          at: "2026-11-18T10:00:00Z",
          text: "Already read later page",
          unread: false,
          author: { name: "Invented Reader" },
        },
      ],
    },
  });
  renderWithProviders(
    <Comments
      it={{
        id: "tl_0123456789abcdef0041",
        comments: { count: 2, latest: [], open: false },
      }}
      entry={{ after: "all" }}
    />,
  );
  await screen.findByText("Unread older page");
  expect(
    within(screen.getByText("Unread older page").closest("li")).getByText(
      "New comment",
    ),
  ).toBeTruthy();
  expect(
    within(
      screen.getByText("Already read later page").closest("li"),
    ).queryByText("New comment"),
  ).toBeNull();
});
test("precise thread markers compare the stored timestamp and comment ID together", async () => {
  const comments = [
    {
      id: "45",
      at: "2026-11-18T10:00:00.000000Z",
      text: "Earlier time with a larger ID",
    },
    { id: "41", at: "2026-11-18T10:00:00.000001Z", text: "Earlier tie" },
    { id: "43", at: "2026-11-18T10:00:00.000001Z", text: "Later tie" },
    {
      id: "40",
      at: "2026-11-18T10:00:00.000002Z",
      text: "Later time with a smaller ID",
    },
  ].map((c) => ({ ...c, author: { name: "Invented Reader" }, mine: false }));
  vi.spyOn(api, "comments").mockResolvedValue({
    ok: true,
    status: 200,
    data: { comments, open: false },
  });
  renderWithProviders(
    <Comments
      it={{
        id: "tl_0123456789abcdef0041",
        comments: { count: 4, latest: [], open: false },
      }}
      entry={{
        reply: null,
        after: "2026-11-18T10:00:00.000001Z",
        afterId: "42",
      }}
    />,
  );
  await screen.findByText("Later tie");
  for (const [text, fresh] of [
    ["Earlier time with a larger ID", false],
    ["Earlier tie", false],
    ["Later tie", true],
    ["Later time with a smaller ID", true],
  ]) {
    const row = screen.getByText(text).closest("li");
    expect(Boolean(within(row).queryByText("New comment"))).toBe(fresh);
  }
});
