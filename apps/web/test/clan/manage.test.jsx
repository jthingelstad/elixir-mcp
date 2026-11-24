import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { parseClanPath } from "../../src/clan/App.jsx";
import { Standing } from "../../src/clan/views/Standing.jsx";
import { manageApi } from "../../src/clan/api.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const poap = {
  clan_tag: "#0QC8RCGY",
  name: "Example Clan",
  acting_as: "#098R2R0PUL",
  acting_as_name: "Ada",
  role: "leader",
  role_label: "Leader",
  your_tags: ["#098R2R0PUL"],
};

describe("clan paths", () => {
  test("parse the tag, the section and the page", () => {
    expect(parseClanPath("/clan/0QC8RCGY")).toEqual({
      tag: "#0QC8RCGY",
      section: null,
      tab: null,
    });
    expect(parseClanPath("/clan/0qc8rcgy/members/review")).toEqual({
      tag: "#0QC8RCGY",
      section: "members",
      tab: "review",
    });
    expect(parseClanPath("/clan/0QC8RCGY/war")).toEqual({
      tag: "#0QC8RCGY",
      section: "war",
      tab: null,
    });
    // Clan publishes no public pages (Jamie, 2026-09-25).
    expect(parseClanPath("/clan/0QC8RCGY/how-elder-works")).toBeNull();
    expect(parseClanPath("/clan/0QC8RCGY/nope")).toBeNull();
  });
});

describe("standing", () => {
  test("groups members by status with evidence in a player's terms and marks you", async () => {
    vi.spyOn(manageApi, "standing").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        policy_version: 1,
        ranks_elder: true,
        how: [
          {
            key: "elder",
            title: "Elder",
            lines: ["Elder is earned by participation: Clan Wars 100%."],
          },
        ],
        weights: [{ key: "war", label: "Clan Wars", share: 1 }],
        as_of: "2026-09-12T18:00:00Z",
        freshness_seconds: 60,
        rows: [
          {
            player_tag: "#098R2R0PUL",
            name: "Ada",
            role: "member",
            status: "rising",
            evidence: "100% war decks over 4 war weeks, ~200 donations a week",
            war: [
              { season_id: 135, section_index: 3, decks: 16, decks_asked: 16 },
              { season_id: 135, section_index: 4, decks: 12, decks_asked: 12 },
            ],
          },
          {
            player_tag: "#0RJL",
            name: "Amy",
            role: "elder",
            status: "holding",
            evidence: "75% war decks over 4 war weeks",
            war: [
              { season_id: 135, section_index: 3, decks: 12, decks_asked: 16 },
              { season_id: 135, section_index: 4, decks: 9, decks_asked: 12 },
            ],
          },
        ],
        you: {
          status: "rising",
          evidence: "100% war decks over 4 war weeks",
          war: [
            { season_id: 135, section_index: 3, decks: 16, decks_asked: 16 },
            { season_id: 135, section_index: 4, decks: 12, decks_asked: 12 },
          ],
          next: ["War decks count here."],
          inactivity: null,
          days_idle: 0.5,
          hold: null,
        },
      },
    });
    renderWithProviders(
      <Standing
        clan={poap}
        who={{ player_tag: "#098R2R0PUL", role: "member" }}
      />,
    );
    await waitFor(() => expect(screen.getByText("Amy")).toBeTruthy());
    // Each group is its own panel, headed by its name and its count.
    const holding = screen.getByRole("region", { name: "Holding Elder" });
    expect(holding.textContent).toMatch(/^Holding Elder1Elders the rules keep/);
    expect(holding.textContent).toMatch(/Amy/);
    const rising = screen.getByRole("region", { name: "Rising" });
    expect(rising.textContent).toMatch(/^Rising1/);
    // War decks per race, out of the decks asked, in words for a reader.
    expect(
      screen.getByRole("img", {
        name: "Amy's war decks: Season 135, week 4 12 of 16, Season 135, week 5 9 of 12",
      }),
    ).toBeTruthy();
    const you = screen.getByRole("region", { name: "You" });
    expect(you.textContent).toMatch(/Rising/);
    expect(you.textContent).toMatch(/28 of 28/);
    expect(you.textContent).toMatch(/Season 135, week 4 to Season 135, week 5/);
    expect(screen.getByText("How it works here")).toBeTruthy();
    // The rule behind your group is quoted in You and stands in How.
    expect(screen.getAllByText(/Clan Wars 100%/)).toHaveLength(2);
    expect(you.textContent).toMatch(/The rule behind this/);
    const rule = screen.getByRole("link", {
      name: "Read the rule: Becoming an Elder",
    });
    expect(rule.getAttribute("href")).toBe("/clan/0QC8RCGY/rules#rule-elder");
    expect(document.getElementById("rule-elder")).toBeTruthy();
    expect(document.querySelector("tr[data-you='true']")).toBeTruthy();
    // A member is not sent to change the rules in Run.
    expect(screen.queryByText(/Change the rules in Run/)).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /\b(score|percentile|rank)\b/i,
    );
  });

  test("a long group opens at its first rows, and your own row always shows", async () => {
    const row = (i, status) => ({
      player_tag: `#P${i}`,
      name: `Player ${i}`,
      role: status === "holding" ? "elder" : "member",
      status,
      evidence: "taking part",
      war: [],
    });
    vi.spyOn(manageApi, "standing").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        policy_version: 3,
        ranks_elder: true,
        weights: [
          { key: "war", label: "Clan Wars", share: 0.55 },
          { key: "donations", label: "Donations", share: 0.45 },
        ],
        how: [{ key: "elder", title: "Elder", lines: ["Elder is earned."] }],
        as_of: "2026-09-12T18:00:00Z",
        freshness_seconds: 60,
        rows: [
          ...Array.from({ length: 8 }, (_, i) => row(i, "holding")),
          ...Array.from({ length: 9 }, (_, i) => row(10 + i, "participating")),
        ],
        you: null,
      },
    });
    renderWithProviders(
      <Standing
        clan={poap}
        who={{ player_tag: "#P15", role: "leader", name: "Ada" }}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Holding Elder" }),
      ).toBeTruthy(),
    );
    const holding = screen.getByRole("region", { name: "Holding Elder" });
    expect(holding.querySelectorAll("tbody tr").length).toBe(5);
    const all = screen.getByRole("button", { name: "Show all 8" });
    expect(all.getAttribute("aria-expanded")).toBe("false");
    all.click();
    await waitFor(() =>
      expect(holding.querySelectorAll("tbody tr").length).toBe(8),
    );
    // Participating opens closed, but your row is there.
    const middle = screen.getByRole("region", { name: "Participating" });
    expect(middle.querySelectorAll("tbody tr").length).toBe(1);
    expect(middle.querySelector("tr[data-you='true']").textContent).toMatch(
      /Player 15/,
    );
    // What Elder weighs, as the policy set it; a leader can open the policy.
    expect(screen.getByText("55%")).toBeTruthy();
    expect(screen.getByText("rules v3")).toBeTruthy();
    expect(screen.getByText(/Change the rules in Run/)).toBeTruthy();
    expect(document.body.textContent).toMatch(
      /Leaders and co-leaders have no group\./,
    );
  });

  test("a quiet member's callout names the clan's at-risk day", async () => {
    vi.spyOn(manageApi, "standing").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        policy_version: 1,
        ranks_elder: true,
        how: [],
        weights: [],
        as_of: "2026-09-12T18:00:00Z",
        freshness_seconds: 60,
        rows: [],
        you: {
          player_tag: "#098R2R0PUL",
          status: "rising",
          evidence: "Some evidence.",
          war: [],
          next: [],
          inactivity: "at_risk",
          at_risk_days: 7,
          days_idle: 8.5,
          hold: null,
        },
      },
    });
    renderWithProviders(
      <Standing
        clan={poap}
        who={{ player_tag: "#098R2R0PUL", role: "member" }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "You" }).textContent).toMatch(
        /8 days since your last battle; this clan counts a member at risk from 7 days\./,
      ),
    );
  });

  test("a clan with no policy yet says so", async () => {
    vi.spyOn(manageApi, "standing").mockResolvedValue({
      ok: false,
      status: 409,
      data: { error: "no_policy" },
    });
    renderWithProviders(
      <Standing clan={poap} who={{ player_tag: "#X", role: "member" }} />,
    );
    await waitFor(() => expect(screen.getByText("No rules yet")).toBeTruthy());
  });

  test("a policy that keeps standing to leaders still shows how the clan runs", async () => {
    vi.spyOn(manageApi, "standing").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        policy_version: 2,
        ranks_elder: false,
        how: [
          { key: "elder", title: "Elder", lines: ["Leaders choose Elders."] },
        ],
        rows: null,
        you: null,
      },
    });
    renderWithProviders(
      <Standing clan={poap} who={{ player_tag: "#X", role: "member" }} />,
    );
    await waitFor(() =>
      expect(screen.getByText("Leaders choose Elders.")).toBeTruthy(),
    );
    expect(document.body.textContent).not.toMatch(/Holding Elder/);
  });
});

describe("below 10 members", () => {
  test("Standing says clan management starts at 10 and why", async () => {
    vi.spyOn(manageApi, "standing").mockResolvedValue({
      ok: false,
      status: 409,
      data: { error: "too_few_members", members: 6, min_members: 10 },
    });
    renderWithProviders(
      <Standing clan={poap} who={{ player_tag: "#X", role: "member" }} />,
    );
    await waitFor(() =>
      expect(
        screen.getByText("Clan management starts at 10 members"),
      ).toBeTruthy(),
    );
    expect(screen.getByText(/so\s+Standing waits/)).toBeTruthy();
  });
});
