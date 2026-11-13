import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { parseClanPath } from "../src/App.jsx";
import { Standing } from "../src/views/Standing.jsx";
import { Review } from "../src/views/Manage.jsx";
import { manageApi } from "../src/api.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const poap = {
  clan_tag: "#2PQRJ8LV",
  name: "Example Clan",
  acting_as: "#20QQL8CCRU",
  acting_as_name: "Ada",
  role: "leader",
  role_label: "Leader",
  your_tags: ["#20QQL8CCRU"],
};

test("Review counts all four removal triage readings, and lists only who is near an action", async () => {
  const statuses = ["protected", "not_candidate", "evidence_held", "eligible"];
  vi.spyOn(manageApi, "manage").mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      evaluated_at: "2026-10-04T08:00:00Z",
      policy_version: 1,
      boundaries: [],
      band: null,
      policy: { ranks_elder: true, removal: true },
      board: statuses.map((status, i) => ({
        player_tag: `#SYNTH${i}`,
        name: `Invented ${i}`,
        role: i === 0 ? "elder" : "member",
        bucket: i === 2 ? "held" : i === 3 ? "actionable" : "clear",
        judgment: {
          promotion:
            i === 0
              ? "not_applicable"
              : i === 1
                ? "unknown"
                : i === 2
                  ? "held"
                  : "ready",
          demotion: i === 0 ? "held" : "not_applicable",
          removal: status === "eligible" ? "ready" : "held",
        },
        judgment_reasons: [],
        promotion: { state: "none" },
        demotion: { state: "none" },
        removal: {
          state: "none",
          triage: { status, reason: `Explanation ${i}` },
        },
      })),
    },
  });
  renderWithProviders(
    <Review clan={poap} who={{ player_tag: poap.acting_as, role: "leader" }} />,
  );
  await waitFor(() => expect(screen.getByText("Invented 2")).toBeTruthy());
  const page = document.body.textContent;
  expect(page).toMatch(
    /1 protected by their role, a hold or the wait after a decision, 1 not close, 1 with too little to go on, 1 past the removal day/,
  );
  expect(page).toMatch(/promotion 2, demotion 1/);
  const sections = screen.getByRole("navigation", { name: "Review sections" });
  expect(sections.querySelector('a[href="#board-held"]').textContent).toBe(
    "Too little to go on · 1",
  );
  expect(sections.querySelector('a[href="#board-clear"]').textContent).toBe(
    "Clear · 2",
  );
  // Nobody clear is listed: only the count, and the way to the Roster.
  expect(screen.queryByText("Invented 0")).toBeNull();
  expect(screen.getByText("Removal: Explanation 2")).toBeTruthy();
  expect(screen.getByText("Removal: Explanation 3")).toBeTruthy();
  expect(screen.queryByText("held · activity unknown")).toBeNull();
});

test("Review shows every held or unknown reason, including simultaneous dimensions", async () => {
  const reasons = [
    "Promotion: tenure unknown because the join predates the record.",
    "Removal held: no recorded battle or observed join anchors the clock.",
  ];
  vi.spyOn(manageApi, "manage").mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      evaluated_at: "2026-09-13T16:00:00Z",
      policy_version: 0,
      boundaries: [],
      band: {
        roster_size: 1,
        open_slots: 49,
        current_elders: 0,
        floor: 0,
        ceil: 0,
        target: 0,
        ranked_population: 1,
      },
      board: [
        {
          player_tag: "#HELD",
          name: "Held member",
          role: "member",
          bucket: "held",
          judgment: {
            promotion: "unknown",
            demotion: "not_applicable",
            removal: "held",
          },
          judgment_reasons: reasons,
          promotion: { state: "none" },
          removal: { state: "none", days_idle: null },
        },
      ],
    },
  });
  renderWithProviders(
    <Review clan={poap} who={{ player_tag: poap.acting_as, role: "leader" }} />,
  );
  await waitFor(() => expect(screen.getByText("Held member")).toBeTruthy());
  for (const reason of reasons) expect(screen.getByText(reason)).toBeTruthy();
});

describe("clan paths", () => {
  test("parse the tag, the section and the page", () => {
    expect(parseClanPath("/clan/2PQRJ8LV")).toEqual({
      tag: "#2PQRJ8LV",
      section: null,
      tab: null,
    });
    expect(parseClanPath("/clan/2pqrj8lv/members/review")).toEqual({
      tag: "#2PQRJ8LV",
      section: "members",
      tab: "review",
    });
    expect(parseClanPath("/clan/2PQRJ8LV/war")).toEqual({
      tag: "#2PQRJ8LV",
      section: "war",
      tab: null,
    });
    // Clan publishes no public pages (Jamie, 2026-09-25).
    expect(parseClanPath("/clan/2PQRJ8LV/how-elder-works")).toBeNull();
    expect(parseClanPath("/clan/2PQRJ8LV/nope")).toBeNull();
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
            player_tag: "#20QQL8CCRU",
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
            player_tag: "#8QCV",
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
        who={{ player_tag: "#20QQL8CCRU", role: "member" }}
      />,
    );
    await waitFor(() => expect(screen.getByText("Amy")).toBeTruthy());
    // Each group is its own panel, headed by its name and its count.
    const holding = screen.getByRole("region", { name: "Holding Elder" });
    expect(holding.textContent).toMatch(
      /^Holding Elder1Elders the policy keeps/,
    );
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
    expect(rule.getAttribute("href")).toBe("/clan/2PQRJ8LV/policy#rule-elder");
    expect(document.getElementById("rule-elder")).toBeTruthy();
    expect(document.querySelector("tr[data-you='true']")).toBeTruthy();
    // A member is not shown the leaders' policy page.
    expect(screen.queryByText(/Read the policy in full/)).toBeNull();
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
    expect(screen.getByText("policy v3")).toBeTruthy();
    expect(screen.getByText(/Read the policy in full/)).toBeTruthy();
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
          player_tag: "#20QQL8CCRU",
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
        who={{ player_tag: "#20QQL8CCRU", role: "member" }}
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
    await waitFor(() => expect(screen.getByText("No policy yet")).toBeTruthy());
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
