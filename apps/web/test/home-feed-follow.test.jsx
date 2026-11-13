/**
 * Follow on a clan arrival you do not follow (design canvas 2026-11-13),
 * priced only when asked, and never on one you follow. Clan's Actions stay
 * in the bell (Jamie, 2026-11-13), so the feed draws none. Invented names
 * and tags only.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { HomeFeed } from "../src/home/Feed.jsx";

vi.mock("../src/analytics.js", () => ({ trackEvent: () => {} }));

const AGO = (min) => new Date(Date.now() - min * 60_000).toISOString();
const reply = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const CLAN = {
  ok: true,
  state: "member",
  clan_tag: "#0QC8RCGY",
  name: "Ada's Clan",
  role: "leader",
  needs: [
    {
      number: 41,
      type: "departure",
      label: "Departure",
      subject_name: "Ada",
      left_at: "2026-11-12T10:00:00.000Z",
    },
    { type: "away", label: "Away", days_idle: 4, away_max_days: 14 },
  ],
  needs_total: 3,
};

const arrival = (id, offer) => ({
  id: `tl_${id.padStart(20, "0")}`,
  kind: "member_joined",
  at: AGO(30),
  observed_at: AGO(29),
  subject_tag: "#0QC8RCGY",
  subject_name: "Ada's Clan",
  subjects: [{ tag: "#0QC8RCGY", kind: "clan", name: "Ada's Clan" }],
  groups: ["clan"],
  text: `Invented ${id} joined Ada's Clan.`,
  facts: { player_tag: `#00JQ20${id}`, name: `Invented ${id}` },
  ...(offer ? { offer_follow: true } : {}),
});

let calls;
let following;
beforeEach(() => {
  following = false;
  calls = [];
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.open = false;
  };
  global.fetch = vi.fn(async (path, init) => {
    const p = String(path).split("?")[0];
    calls.push(`${init?.method ?? "GET"} ${String(path)}`);
    if (p === "/api/me/home/needs") return reply({ needs: CLAN });
    if (p === "/api/me/home/clan") return reply({ clan: CLAN });
    if (p === "/api/me/follow-cost")
      return reply({
        player_tag: "#00JQ201",
        following,
        free: true,
        used: 3,
        limit: 10,
      });
    if (p === "/api/me/home/feed")
      return reply({
        window: { from: AGO(10_080), to: AGO(0) },
        seen_to: AGO(0),
        timeline: [arrival("1", true), arrival("2", false)],
        total: 2,
        next: null,
        timeline_more: 0,
      });
    return reply({});
  });
});
afterEach(() => cleanup());

test("the feed draws no Clan Action, even with one waiting", async () => {
  renderWithProviders(<HomeFeed />);
  await screen.findByText("Invented 2 joined Ada's Clan.");
  expect(screen.queryByText(/leader action/)).toBeNull();
  expect(document.querySelector(".kit-feed__item--decision")).toBeNull();
});

test("Follow sits on an arrival you do not follow, and prices only when asked", async () => {
  renderWithProviders(<HomeFeed />);
  await screen.findByText("Invented 2 joined Ada's Clan.");
  const follows = screen.getAllByRole("button", { name: "Follow" });
  expect(follows).toHaveLength(1);
  expect(follows[0].closest("article").textContent).toContain(
    "Invented 1 joined",
  );
  expect(calls.some((c) => c.includes("/follow-cost"))).toBe(false);
  fireEvent.click(follows[0]);
  await waitFor(() =>
    expect(screen.getByText(/Free · already recorded/)).toBeTruthy(),
  );
});

test("one of your agents tracking them never stops your own follow (Codex on #871)", async () => {
  following = true;
  renderWithProviders(<HomeFeed />);
  await screen.findByText("Invented 2 joined Ada's Clan.");
  fireEvent.click(screen.getByRole("button", { name: "Follow" }));
  await waitFor(() =>
    expect(screen.getByText("Free · already recorded")).toBeTruthy(),
  );
  const dialog = document.querySelector("dialog[open]");
  const confirm = [...dialog.querySelectorAll("button")].find(
    (b) => b.textContent === "Follow",
  );
  fireEvent.click(confirm);
  await waitFor(() => expect(calls).toContain("POST /api/claims"));
});
