import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { RunMembers } from "../../src/clan/views/RunMembers.jsx";
import { RunMember, whyLines } from "../../src/clan/views/RunMember.jsx";
import { manageApi } from "../../src/clan/api.js";
import {
  didTheirPart,
  gapLine,
  historyLine,
  inFilter,
  median,
  whyChips,
} from "../../src/clan/lib/members.js";
import { pageOf } from "../../src/clan/lib/tabs.js";
import { parseClanPath } from "../../src/clan/App.jsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const clan = {
  clan_tag: "#0QC8RCGY",
  name: "Example Clan",
  acting_as: "#098R2R0PUL",
  acting_as_name: "Ada",
  role: "leader",
  role_label: "Leader",
  your_tags: ["#098R2R0PUL"],
};
const who = { player_tag: "#098R2R0PUL", role: "leader" };

/** One board entry, with the fields Run › Members reads. */
const member = (i, over = {}) => ({
  player_tag: `#SYNTH${i}`,
  name: `Invented ${i}`,
  role: "member",
  bucket: "clear",
  phrase: "taking part",
  judgment: {
    promotion: "not_applicable",
    demotion: "not_applicable",
    removal: "not_applicable",
  },
  judgment_reasons: [],
  promotion: { state: "none" },
  demotion: { state: "none" },
  removal: { state: "none", triage: { status: "not_candidate" } },
  standing: { rank: i + 1, eligible: true },
  exceptions: [],
  facts: {
    days_idle: 0.5,
    last_battle_time: "2026-11-22T18:00:00Z",
    tenure_days: 90,
    tenure_known: true,
    minimums: { weeks: 4, passes: true, unknown: false },
    war: { weeks: 4, decks_played: 64, decks_asked: 64, fidelity: "exact" },
    donations_average: 100 + i * 10,
  },
  ...over,
});

const board = (entries, over = {}) => ({
  ok: true,
  status: 200,
  data: {
    evaluated_at: "2026-11-23T08:00:00Z",
    as_of: "2026-11-23T08:00:00Z",
    freshness_seconds: 60,
    policy_version: 3,
    boundaries: ["2026-11-17T10:00:00Z"],
    band: {
      roster_size: entries.length,
      open_slots: 50 - entries.length,
      current_elders: entries.filter((m) => m.role === "elder").length,
      floor: 1,
      ceil: 2,
      target: 2,
      ranked_population: entries.length,
    },
    roster: null,
    inbox: [],
    policy: {
      ranks_elder: true,
      removal: true,
      removal_day: 14,
      tenure_min_days: 14,
      minimums_window_weeks: 4,
    },
    board: entries,
    ...over,
  },
});

describe("Run › Members", () => {
  test("tiles, filters and rows, and Review's counts kept", async () => {
    const statuses = [
      "protected",
      "not_candidate",
      "evidence_held",
      "eligible",
    ];
    const entries = statuses.map((status, i) =>
      member(i, {
        role: i === 0 ? "elder" : "member",
        bucket: i === 2 ? "held" : i === 3 ? "actionable" : "clear",
        judgment: {
          promotion: i === 1 ? "unknown" : i === 2 ? "held" : "ready",
          demotion: i === 0 ? "held" : "not_applicable",
          removal: status === "eligible" ? "ready" : "held",
        },
        removal: {
          state: status === "eligible" ? "eligible" : "none",
          triage: { status, reason: `Explanation ${i}` },
        },
        facts: {
          ...member(i).facts,
          days_idle: i === 3 ? 15.2 : 0.5,
          minimums:
            i === 2
              ? { weeks: 4, passes: null, unknown: true }
              : { weeks: 4, passes: i !== 3, unknown: false },
        },
      }),
    );
    vi.spyOn(manageApi, "manage").mockResolvedValue(board(entries));
    renderWithProviders(<RunMembers clan={clan} />);
    await waitFor(() => expect(screen.getByText("Invented 3")).toBeTruthy());
    expect(
      screen.getByText(
        "Where everyone stands. Tap a member to see their history.",
      ),
    ).toBeTruthy();
    // The tiles: one Elder of two seats, two of four did their part, one quiet.
    const tiles = screen.getByRole("group", { name: "The clan now" });
    expect(tiles.textContent).toMatch(/Elder seats1 of 2taken/);
    expect(tiles.textContent).toMatch(/Did their part2 of 4/);
    expect(tiles.textContent).toMatch(/Quiet 4\+ days1/);
    // Someone needs you, so that filter opens first, with only them.
    const chips = screen.getByRole("group", { name: "Show members" });
    expect(chips.textContent).toMatch(/Needs you1/);
    expect(chips.textContent).toMatch(/Not enough info1/);
    expect(screen.queryByText("Invented 0")).toBeNull();
    const row = screen.getByText("Invented 3").closest("a");
    expect(row.getAttribute("href")).toBe("/clan/0QC8RCGY/run/members/SYNTH3");
    expect(row.textContent).toMatch(/Kick at day 14/);
    expect(row.textContent).toMatch(/Missed the minimums/);
    // Everyone, in Elder rank order.
    fireEvent.click(screen.getByRole("button", { name: /Everyone/ }));
    await waitFor(() =>
      expect(screen.getByText("Everyone, sorted by Elder rank")).toBeTruthy(),
    );
    const names = [...document.querySelectorAll(".kit-row__title")].map(
      (n) => n.textContent,
    );
    expect(names).toEqual([
      "Invented 0",
      "Invented 1",
      "Invented 2",
      "Invented 3",
    ]);
    // Review's summary lines stay.
    const page = document.body.textContent;
    expect(page).toMatch(
      /1 protected by their role, an exception or the wait after a decision, 1 not close, 1 with too little to go on, 1 past the removal day/,
    );
    expect(page).toMatch(/promotion 2, demotion 1/);
    expect(document.body.textContent).not.toMatch(/\bscore\b/i);
  });

  test("every held or unknown reason shows on the row", async () => {
    const reasons = [
      "Promotion: tenure unknown because the join predates the record.",
      "Removal held: no recorded battle or observed join anchors the clock.",
    ];
    vi.spyOn(manageApi, "manage").mockResolvedValue(
      board([
        member(0, {
          name: "Held member",
          bucket: "held",
          judgment_reasons: reasons,
          judgment: {
            promotion: "unknown",
            demotion: "not_applicable",
            removal: "held",
          },
        }),
      ]),
    );
    renderWithProviders(<RunMembers clan={clan} />);
    await waitFor(() => expect(screen.getByText("Held member")).toBeTruthy());
    for (const reason of reasons) expect(screen.getByText(reason)).toBeTruthy();
    expect(screen.getByText("Held member").closest("a").textContent).toMatch(
      /Not enough info/,
    );
  });

  test("a failed read says so in place, with Try again", async () => {
    const read = vi.spyOn(manageApi, "manage").mockResolvedValue({
      ok: false,
      status: 504,
      data: { error: "timeout" },
    });
    renderWithProviders(<RunMembers clan={clan} />);
    await waitFor(() =>
      expect(
        screen.getByText("Members didn’t load in time. Nothing is lost."),
      ).toBeTruthy(),
    );
    // The page's head still stands.
    expect(screen.getByRole("heading", { name: "Members" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  test("no rules yet, and too few members", async () => {
    vi.spyOn(manageApi, "manage").mockResolvedValue({
      ok: false,
      status: 409,
      data: { error: "no_policy" },
    });
    renderWithProviders(<RunMembers clan={clan} />);
    await waitFor(() => expect(screen.getByText("No rules yet")).toBeTruthy());
    cleanup();
    vi.spyOn(manageApi, "manage").mockResolvedValue({
      ok: false,
      status: 409,
      data: { error: "too_few_members", members: 6, min_members: 10 },
    });
    renderWithProviders(<RunMembers clan={clan} />);
    await waitFor(() =>
      expect(screen.getByText("Starts at 10 members")).toBeTruthy(),
    );
  });
});

const history = {
  ok: true,
  status: 200,
  data: {
    clan_tag: "#0QC8RCGY",
    clan_name: "Example Clan",
    as_of: "2026-11-23T08:00:00Z",
    member: {
      player_tag: "#SYNTH1",
      name: "Invented 1",
      role: "elder",
      in_clan: true,
      joined_observed_at: "2026-08-01T10:00:00Z",
      first_joined_at: "2026-08-01T10:00:00Z",
      left_observed_at: null,
      tenure_known: false,
      days_in_clan: 114,
      last_battle_time: "2026-11-22T18:00:00Z",
    },
    known_since: "2026-08-01T10:00:00Z",
    entries: [
      {
        id: "note:n1",
        kind: "note",
        groups: ["notes"],
        at: "2026-11-20T10:00:00Z",
        tier: "leader",
        text: "Asked for war decks.",
        by: { player_tag: "#0PLUG2V9", name: "Kai" },
      },
      {
        id: "war:135:3",
        kind: "war_week",
        groups: ["war"],
        at: "2026-11-17T10:00:00Z",
        season_id: 135,
        week: 3,
        colosseum: false,
        decks: 16,
        decks_asked: 16,
      },
      {
        id: "award:135:top_donor",
        kind: "award",
        groups: ["awards"],
        at: "2026-11-03T10:00:00Z",
        season_id: 135,
        award_id: "top_donor",
        name: "Top Donor",
        rank: 1,
        by: { player_tag: "#0PLUG2V9", name: "Kai" },
      },
      {
        id: "role:1",
        kind: "role_changed",
        groups: ["role", "actions"],
        at: "2026-10-01T10:00:00Z",
        role_before: "member",
        role_after: "elder",
        action: {
          card_id: "c1",
          number: 4,
          type: "promotion",
          headline: "Ready after 3 weekly reviews.",
          by: { player_tag: "#0PLUG2V9", name: "Kai" },
        },
      },
      {
        id: "known_since",
        kind: "known_since",
        groups: ["role"],
        at: "2026-08-01T10:00:00Z",
      },
    ],
    gaps: ["war_window"],
  },
};

function mockMemberReads({ manage, memberHistory } = {}) {
  vi.spyOn(manageApi, "manage").mockResolvedValue(
    manage ??
      board([
        member(0),
        member(1, {
          role: "elder",
          removal: {
            state: "none",
            triage: { status: "protected", reason: "Explanation 1" },
          },
        }),
      ]),
  );
  vi.spyOn(manageApi, "notes").mockResolvedValue({
    ok: true,
    status: 200,
    data: { notes: [] },
  });
  vi.spyOn(manageApi, "memberAwards").mockResolvedValue({
    ok: true,
    status: 200,
    data: { grants: [] },
  });
  return vi
    .spyOn(manageApi, "memberHistory")
    .mockResolvedValue(memberHistory ?? history);
}

describe("Run › Members › one member", () => {
  test("header, tiles, reasons and the history, newest first, with filters", async () => {
    const read = mockMemberReads();
    renderWithProviders(<RunMember clan={clan} who={who} player="#SYNTH1" />);
    await waitFor(() =>
      expect(screen.getByText("Leader note from Kai")).toBeTruthy(),
    );
    expect(read).toHaveBeenCalledWith("#0QC8RCGY", "#SYNTH1");
    expect(
      screen.getByRole("link", { name: /Members/ }).getAttribute("href"),
    ).toBe("/clan/0QC8RCGY/run/members");
    expect(screen.getByRole("link", { name: "Player page" })).toBeTruthy();
    expect(document.body.textContent).toMatch(
      /#SYNTH1 · in Example Clan at least 114 days/,
    );
    const tiles = screen.getByRole("group", { name: "Where they stand" });
    expect(tiles.textContent).toMatch(/Kick clock not running/);
    expect(tiles.textContent).toMatch(/64 of 64 war decks, last 4 races/);
    expect(tiles.textContent).toMatch(/Elder rank2 of 2/);
    expect(tiles.textContent).toMatch(/Donations110 a weekClan median 105/);
    expect(screen.getByText("Removal: Explanation 1")).toBeTruthy();
    // The history, newest first, in the mockup's words.
    const list = screen.getByRole("list", { name: "History in Example Clan" });
    const titles = [...list.querySelectorAll(".kit-row__title")].map(
      (n) => n.textContent,
    );
    expect(titles).toEqual([
      "Leader note from Kai",
      "River Race week 3: 16 of 16 war decks",
      "Won Top Donor for Season 135",
      "Promoted to Elder",
      "Already a member when Elixir started following Example Clan",
    ]);
    expect(list.textContent).toMatch(
      /Ready after 3 weekly reviews · Kai tapped Done/,
    );
    expect(list.textContent).toMatch(/Nothing before this day is known/);
    // A filter keeps its kind; a merged role change is under Actions too.
    fireEvent.click(screen.getByRole("button", { name: /Actions/ }));
    await waitFor(() =>
      expect(list.querySelectorAll(".kit-row__title").length).toBe(1),
    );
    expect(list.textContent).toMatch(/Promoted to Elder/);
    expect(document.body.textContent).toMatch(/Race weeks go back 8 weeks\./);
  });

  test("a failed history read fails alone, and Try again reads it again", async () => {
    const read = mockMemberReads({
      memberHistory: { ok: false, status: 502, data: { error: "upstream" } },
    });
    renderWithProviders(<RunMember clan={clan} who={who} player="#SYNTH1" />);
    await waitFor(() =>
      expect(
        screen.getByText("The history didn’t load in time. Nothing is lost."),
      ).toBeTruthy(),
    );
    // The rest of the page still stands.
    expect(
      screen.getByRole("group", { name: "Where they stand" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Invented 1" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  test("a failed board read fails alone; the history still shows", async () => {
    mockMemberReads({
      manage: { ok: false, status: 503, data: { error: "unavailable" } },
    });
    renderWithProviders(<RunMember clan={clan} who={who} player="#SYNTH1" />);
    await waitFor(() =>
      expect(
        screen.getByText(
          "Where they stand didn’t load in time. Nothing is lost.",
        ),
      ).toBeTruthy(),
    );
    await waitFor(() =>
      expect(screen.getByText("Leader note from Kai")).toBeTruthy(),
    );
    // The name comes from the history when the board is not there.
    expect(screen.getByRole("heading", { name: "Invented 1" })).toBeTruthy();
  });

  test("the kick clock counts the member's own day, grace included, and a quiet joiner has no battle", async () => {
    mockMemberReads({
      manage: board([
        member(0),
        member(1, {
          removal: {
            state: "pending",
            removal_day: 17,
            triage: { status: "not_candidate", reason: "Explanation 1" },
          },
          facts: {
            ...member(1).facts,
            days_idle: 15.2,
            last_battle_time: null,
          },
        }),
      ]),
    });
    renderWithProviders(<RunMember clan={clan} who={who} player="#SYNTH1" />);
    const tiles = await screen.findByRole("group", {
      name: "Where they stand",
    });
    // The policy says day 14; this member's grace makes it 17.
    expect(tiles.textContent).toMatch(/Kick clock: day 15 of 17/);
    // Quiet days count the join, never a battle that is not on record.
    expect(tiles.textContent).toMatch(/None on record/);
    expect(tiles.textContent).not.toMatch(/Today/);
  });

  test("a tag Elixir never saw in the clan", async () => {
    mockMemberReads({
      memberHistory: {
        ok: false,
        status: 404,
        data: { error: "not_a_member" },
      },
    });
    renderWithProviders(<RunMember clan={clan} who={who} player="#0LUVR2" />);
    await waitFor(() =>
      expect(screen.getByText("Nothing on record")).toBeTruthy(),
    );
  });
});

describe("the words", () => {
  test("filters and did their part", () => {
    const waiting = new Set(["#SYNTH5"]);
    expect(inFilter(member(5), "needs", waiting)).toBe(true);
    expect(inFilter(member(4), "needs", waiting)).toBe(false);
    expect(inFilter(member(4, { bucket: "building" }), "close")).toBe(true);
    expect(
      inFilter(
        member(4, {
          exceptions: [{ kind: "away", until: "2026-12-12T00:00:00Z" }],
        }),
        "exception",
      ),
    ).toBe(true);
    expect(inFilter(member(4), "exception")).toBe(false);
    expect(didTheirPart(member(1))).toBe(true);
    expect(
      didTheirPart(member(1, { facts: { minimums: { unknown: true } } })),
    ).toBe(null);
    expect(median([3, null, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(null);
  });

  test("a row's short reasons", () => {
    const policy = board([]).data.policy;
    expect(
      whyChips(
        member(1, {
          exceptions: [{ kind: "away", until: "2026-12-12T00:00:00Z" }],
          promotion: { state: "eligible", promotable_now: false },
        }),
        { policy, calendar: () => "Fri Dec 12" },
      ),
    ).toEqual(["Away to Fri Dec 12", "Ready for Elder, no seat"]);
    expect(whyChips(member(1, { role: "coLeader" }), { policy })).toEqual([
      "Co-leader: skipped by the rules",
    ]);
    expect(
      whyChips(member(1, { facts: { ...member(1).facts, tenure_days: 3 } }), {
        policy,
      }),
    ).toEqual(["Elder after 14 days"]);
    expect(
      whyLines(
        member(1, {
          demotion: { state: "building", reason: "abandoned", weeks: 2 },
        }),
      ),
    ).toEqual(["Elder: slipping, missed the minimums, 2 weekly reviews."]);
  });

  test("history lines", () => {
    const calendar = () => "Feb 16";
    expect(
      historyLine(
        {
          kind: "exception",
          event: "added",
          exception: "keep_as_elder",
          until: "2027-02-16T00:00:00Z",
          visibility: "leaders",
          note: "Runs our tournaments",
          by: { player_tag: "#0PLUG2V9", name: "Kai" },
        },
        { calendar },
      ),
    ).toEqual({
      title: "Keep as Elder added by Kai",
      detail: "ends Feb 16 · Leaders only · Runs our tournaments",
    });
    expect(
      historyLine(
        {
          kind: "exception",
          event: "expired",
          exception: "keep_in_clan",
          until: "2027-02-16T00:00:00Z",
          visibility: "clan",
          by: null,
        },
        { calendar },
      ),
    ).toEqual({ title: "Keep in clan ran out", detail: null });
    expect(
      historyLine(
        {
          kind: "exception",
          event: "added",
          exception: "away",
          until: "2027-02-16T00:00:00Z",
          visibility: "clan",
          by: { player_tag: "#SYNTH1", name: "Invented 1" },
        },
        { calendar, self: "#SYNTH1" },
      ).title,
    ).toBe("Marked themselves away");
    expect(
      historyLine(
        {
          kind: "action",
          status: "declined",
          type: "demotion",
          reason: "not_now",
          by: { name: "Kai" },
        },
        {},
      ).title,
    ).toBe("Demotion declined by Kai");
    expect(
      historyLine({
        kind: "war_week",
        colosseum: true,
        decks: 12,
        decks_asked: 16,
        season_id: 136,
      }).title,
    ).toBe("Colosseum: 12 of 16 war decks");
    expect(gapLine([])).toBe(null);
    expect(gapLine(["participation_unavailable"])).toBe(
      "The clan's weeks could not be read.",
    );
  });

  test("the member page's path and its page name", () => {
    expect(parseClanPath("/clan/0QC8RCGY/run/members/0pylq2")).toEqual({
      tag: "#0QC8RCGY",
      section: "run",
      tab: "members",
      player: "#0PYLQ2",
    });
    expect(parseClanPath("/clan/0QC8RCGY/run/members")).toEqual({
      tag: "#0QC8RCGY",
      section: "run",
      tab: "members",
    });
    expect(pageOf("/clan/0QC8RCGY/run/members/0PYLQ2")).toBe("run/member");
  });
});
