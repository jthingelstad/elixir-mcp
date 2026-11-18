import { test, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { api } from "../src/api.js";
import { MemberItemPage } from "../src/views/MemberItem.jsx";

const target = vi.hoisted(() => ({
  id: "tl_0123456789abcdef0041",
  ref: {
    item_id: "tl_0123456789abcdef0041",
    kind: "badge_earned",
    source: "game",
    subject: { kind: "player", tag: "#0PGQ2UYL" },
    at: "2026-11-17T12:00:00Z",
  },
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original()),
  useParams: () => ({ id: target.id }),
  useSearch: () => ({ ref: target.ref, reply: "42", after: "all" }),
}));
const item = {
  id: target.id,
  kind: "badge_earned",
  section: "badges",
  at: target.ref.at,
  subject_tag: "#0PGQ2UYL",
  subjects: [{ kind: "player", tag: "#0PGQ2UYL", name: "Invented Ada" }],
  facts: { badge: "MasteryKnight", level: 5 },
  text: "Invented Ada reached Card Mastery level 5",
  cheers: {},
  my_cheer: null,
};
const ok = (data) => ({ ok: true, status: 200, data });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("the exact item uses the central singular cache for both cheer taps", async () => {
  vi.spyOn(api, "memberItem").mockResolvedValue(ok({ item }));
  const sent = [];
  vi.spyOn(api, "cheer").mockImplementation(async ({ cheer }) => {
    sent.push(cheer);
    return ok({ cheers: cheer ? { [cheer]: 1 } : {}, my_cheer: cheer });
  });
  renderWithProviders(<MemberItemPage />);
  const button = await screen.findByRole("button", { name: /^Cheer(ed)?: / });
  fireEvent.click(button);
  await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
  fireEvent.click(button);
  await waitFor(() => expect(sent).toEqual(["well_played", null]));
  await waitFor(() =>
    expect(button.getAttribute("aria-pressed")).toBe("false"),
  );
  expect(api.memberItem).toHaveBeenCalledWith(target.id, target.ref);
});

test("access denial shows no cached item, comment box or social action", async () => {
  vi.spyOn(api, "memberItem").mockResolvedValue({
    ok: false,
    status: 404,
    data: { error: "not_found" },
  });
  renderWithProviders(<MemberItemPage />);
  await screen.findByRole("heading", {
    name: "This item isn't available to you",
  });
  expect(screen.queryByText(item.text)).toBeNull();
  expect(screen.queryByRole("button", { name: /^Cheer(ed)?: / })).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
});
