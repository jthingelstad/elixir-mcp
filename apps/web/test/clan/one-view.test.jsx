/**
 * Clan as one view (slice 8, #766): the Feed draws the clan's timeline,
 * Rules reads the clan's rules to every member (editing them is Run's), and
 * Run is refused to anyone who does not lead the clan, by the page and by
 * the server's answer. Synthetic names only.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "../../src/client/index.ts";
import { renderWithProviders } from "./helpers.jsx";
import { Feed } from "../../src/clan/views/Feed.jsx";
import { ClanRules } from "../../src/clan/views/ClanRules.jsx";
import { Run } from "../../src/clan/views/Run.jsx";
import { api, manageApi } from "../../src/clan/api.js";
import { policyFromGoals } from "@elixir-mcp/clan-engine";
import { MemberLink } from "../../src/clan/components/MemberLink.jsx";
import { keys } from "../../src/clan/lib/queries.js";

vi.mock("@tanstack/react-router", async (actual) => ({
  ...(await actual()),
  useBlocker: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const member = {
  clan_tag: "#0QC8RCGY",
  name: "Example Clan",
  role: "member",
  verified: true,
};
const leader = { ...member, role: "leader" };
const unread = { ok: false, status: 502, data: {} };

/** Every read the Feed's side cards make, unread: these tests are about
 *  the timeline. */
function sideCardsUnread() {
  for (const read of ["memberView", "week", "actions", "manage", "race"])
    if (typeof manageApi[read] === "function")
      vi.spyOn(manageApi, read).mockResolvedValue(unread);
}

describe("Feed", () => {
  test("Clan news focuses roster changes without reordering or removing All activity", async () => {
    sideCardsUnread();
    const items = [
      {
        id: "moment",
        at: "2026-11-12T11:00:00Z",
        kind: "badge_earned",
        text: "A new badge",
        clan_news: false,
      },
      {
        id: "arrival",
        at: "2026-11-12T10:00:00Z",
        kind: "member_joined",
        text: "Bo joined the clan",
        clan_news: true,
      },
    ];
    const feed = vi
      .spyOn(manageApi, "feed")
      .mockImplementation(async (_tag, view) => ({
        ok: true,
        status: 200,
        data: {
          clan_tag: member.clan_tag,
          items: view === "news" ? items.filter((it) => it.clan_news) : items,
        },
      }));
    renderWithProviders(<Feed clan={member} navigate={vi.fn()} />);
    expect(await screen.findByText("A new badge")).toBeTruthy();
    const all = screen.getByRole("button", { name: "All activity" });
    expect(all.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Clan news" }));
    expect(await screen.findByText("Bo joined the clan")).toBeTruthy();
    expect(feed).toHaveBeenCalledWith(member.clan_tag, "news");
    expect(screen.queryByText("A new badge")).toBeNull();
    fireEvent.click(all);
    expect(await screen.findByText("A new badge")).toBeTruthy();
    expect(screen.getAllByText("Bo joined the clan")).toHaveLength(1);
  });
  // Drawn by the Timeline's own components (2026-11-17).
  test("the clan's timeline, its members' posts about battles with their words, newest first", async () => {
    sideCardsUnread();
    vi.spyOn(manageApi, "feed").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        clan_tag: "#0QC8RCGY",
        window_days: 7,
        more: 0,
        items: [
          {
            id: "tl_00000000000000000041",
            kind: "post",
            at: "2026-11-12T10:00:00Z",
            sort_at: "2026-11-12T10:00:00Z",
            subject_tag: "#0QG0JPUC",
            text: "Ada posted.",
            subjects: [{ kind: "player", tag: "#0QG0JPUC", name: "Ada" }],
            comments: { count: 0, latest: [], open: false },
            post: {
              id: "41",
              text: "Three crowns at last",
              author: { player_tag: "#0QG0JPUC", name: "Ada" },
              battle: {
                battle_id: "abc",
                url: "https://elixir.test/battle/abc",
                outcome: "win",
                crowns: 3,
                crowns_against: 0,
              },
            },
          },
          {
            id: "j1",
            kind: "clan_join",
            at: "2026-11-11T09:00:00Z",
            text: "Bo joined the clan",
          },
        ],
      },
    });
    renderWithProviders(<Feed clan={member} navigate={vi.fn()} />);
    expect(await screen.findByText("Three crowns at last")).toBeTruthy();
    expect(screen.getByText("A 3-0 win")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open battle" }).getAttribute("href"),
    ).toBe("/battle/abc");
    expect(screen.getByText("Bo joined the clan")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Timeline", level: 2 }),
    ).toBeTruthy();
  });

  test("an empty week says so, and a failed read never shows stale items", async () => {
    sideCardsUnread();
    vi.spyOn(manageApi, "feed").mockResolvedValue({
      ok: true,
      status: 200,
      data: { clan_tag: "#0QC8RCGY", window_days: 7, more: 0, items: [] },
    });
    renderWithProviders(<Feed clan={member} navigate={vi.fn()} />);
    expect(
      await screen.findByText("Nothing in the last seven days"),
    ).toBeTruthy();
    cleanup();
    sideCardsUnread();
    vi.spyOn(manageApi, "feed").mockResolvedValue(unread);
    renderWithProviders(<Feed clan={member} navigate={vi.fn()} />);
    expect(await screen.findByText(/timeline could not be read/)).toBeTruthy();
  });

  test("a busy week shows thirty lines, and More shows thirty more", async () => {
    sideCardsUnread();
    const items = Array.from({ length: 45 }, (_, i) => ({
      id: `j${i}`,
      kind: "clan_join",
      at: "2026-11-11T09:00:00Z",
      text: `Member ${i + 1} joined the clan`,
    }));
    vi.spyOn(manageApi, "feed").mockResolvedValue({
      ok: true,
      status: 200,
      data: { clan_tag: "#0QC8RCGY", window_days: 7, more: 0, items },
    });
    renderWithProviders(<Feed clan={member} navigate={vi.fn()} />);
    expect(await screen.findByText("Member 30 joined the clan")).toBeTruthy();
    expect(screen.queryByText("Member 31 joined the clan")).toBeNull();
    expect(screen.getByText("30 of 45 shown")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByText("Member 45 joined the clan")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });

  // Since 2026-11-13 the timeline reads the clan's own rows, as cheap as
  // the panels beside it: it is asked at once, never behind them.
  test("the timeline is asked at once, while the reads beside it are still out", async () => {
    let answer;
    const held = new Promise((resolve) => {
      answer = resolve;
    });
    vi.spyOn(manageApi, "memberView").mockReturnValue(held);
    for (const read of ["week", "actions", "manage"])
      if (typeof manageApi[read] === "function")
        vi.spyOn(manageApi, read).mockResolvedValue(unread);
    const feed = vi.spyOn(manageApi, "feed").mockResolvedValue({
      ok: true,
      status: 200,
      data: { clan_tag: "#0QC8RCGY", window_days: 7, more: 0, items: [] },
    });
    renderWithProviders(<Feed clan={member} navigate={vi.fn()} />);
    expect(await screen.findByText(/Reading your numbers/)).toBeTruthy();
    expect(
      await screen.findByText("Nothing in the last seven days"),
    ).toBeTruthy();
    expect(feed).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Reading your numbers/)).toBeTruthy();
    answer(unread);
  });
});

const rulesValues = {
  ...policyFromGoals(["war", "donations"], "standard"),
  war_intent: "participating",
  removal_enabled: true,
  watch_days: 3,
  at_risk_days: 7,
  confirm_days: 14,
  away_max_days: 21,
};
const policyAnswer = (set = true) => ({
  ok: true,
  status: 200,
  data: {
    set,
    can_edit: false,
    current: set
      ? {
          version: 3,
          saved_at: "2026-11-01T12:00:00Z",
          saved_by_name: "Ada",
          values: rulesValues,
        }
      : { version: 0 },
    how: set
      ? [
          {
            key: "about",
            title: "About this clan",
            lines: ["This clan is about Clan Wars and donations."],
          },
          {
            key: "elder",
            title: "Elder",
            lines: ["Elder goes to the members who give the most."],
          },
        ]
      : [],
    weights: set
      ? [
          { key: "war", label: "Clan Wars", share: 0.6 },
          { key: "donations", label: "Donations", share: 0.4 },
        ]
      : null,
  },
});
const showcase = () => {
  vi.spyOn(manageApi, "policy").mockResolvedValue(policyAnswer());
  vi.spyOn(api, "roster").mockResolvedValue({
    ok: true,
    status: 200,
    data: { member_count: 47, required_trophies: 5000, members: [] },
  });
  vi.spyOn(manageApi, "memberView").mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      clan: {
        minimums: {
          set: { war: 8, donations: 40 },
          met: { war: true, donations: false },
          passes: true,
          unknown: false,
          have: { war: 12, ranked: null, donations: 31.6, trophies: null },
          rule: "any",
          window_weeks: 2,
        },
      },
    },
  });
};

describe("Rules", () => {
  test("a member short of the goals is told what the rule asks: every goal, or any one", async () => {
    for (const [rule, words] of [
      ["all", "Not yet. Meet every goal to get there."],
      ["any", "Not yet. Any one of these gets you there."],
    ]) {
      vi.restoreAllMocks();
      showcase();
      const answer = policyAnswer();
      answer.data.current.values = { ...rulesValues, minimums_rule: rule };
      vi.spyOn(manageApi, "policy").mockResolvedValue(answer);
      vi.spyOn(manageApi, "memberView").mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          clan: {
            minimums: {
              set: { war: 8, donations: 40 },
              met: { war: true, donations: false },
              passes: false,
              unknown: false,
              have: { war: 12, ranked: null, donations: 31.6, trophies: null },
              rule,
              window_weeks: 2,
            },
          },
        },
      });
      const { unmount } = renderWithProviders(
        <ClanRules clan={member} navigate={vi.fn()} />,
      );
      expect(await screen.findByText(words)).toBeTruthy();
      unmount();
    }
  });

  test("a member reads how the clan plays, with no way to change it", async () => {
    showcase();
    renderWithProviders(<ClanRules clan={member} navigate={vi.fn()} />);
    expect(
      await screen.findByRole("heading", { name: /^How .* plays$/ }),
    ).toBeTruthy();
    // The summary heads the page, and stays with what we do together.
    expect(
      (
        await screen.findAllByText(
          "This clan is about Clan Wars and donations.",
        )
      ).length,
    ).toBe(2);
    expect(screen.getByText("Plays Clan Wars")).toBeTruthy();
    expect(screen.getByText("Elder is earned")).toBeTruthy();
    expect(screen.getByText("Kick after 14 quiet days")).toBeTruthy();
    expect(await screen.findByText("47 of 50 members")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Over 2 weeks, do one of these" }),
    ).toBeTruthy();
    expect(await screen.findByText("You: 12")).toBeTruthy();
    expect(screen.getByText("You: 31")).toBeTruthy();
    expect(screen.getByText("You're doing your part.")).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: "What makes a best player: Clan Wars 60%, Donations 40%",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "I’ll be away" }).getAttribute("href"),
    ).toBe("/clan/0QC8RCGY/members/away");
    expect(
      screen
        .getByRole("link", { name: "See it in the clan list" })
        .getAttribute("href"),
    ).toBe("/clan/directory?q=%230QC8RCGY");
    expect(screen.getByText(/saved .* by Ada\./)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /in Run/ })).toBeNull();
    // Never a leaders-only thing: no versions, no notes, no draft.
    expect(document.querySelector(".clan-versions")).toBeNull();
    for (const id of ["rule-minimums", "rule-elder", "rule-removal"])
      expect(document.getElementById(id)).toBeTruthy();
  });

  test("a leader is sent to Run to change it", async () => {
    showcase();
    const navigate = vi.fn();
    renderWithProviders(<ClanRules clan={leader} navigate={navigate} />);
    const link = await screen.findByRole("link", { name: "Change it in Run" });
    expect(link.getAttribute("href")).toBe("/clan/0QC8RCGY/run/rules");
  });

  test("no rules: a member is told nothing runs until they're saved", async () => {
    vi.spyOn(manageApi, "policy").mockResolvedValue(policyAnswer(false));
    renderWithProviders(<ClanRules clan={member} navigate={vi.fn()} />);
    expect(
      await screen.findByText(/until then nothing in Clan runs/),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: /in Run/ })).toBeNull();
  });
});

describe("Run", () => {
  test("a member is refused Run without asking the server", async () => {
    const run = vi.spyOn(manageApi, "run");
    renderWithProviders(<Run clan={member} navigate={vi.fn()} />);
    expect(
      await screen.findByText(/Run is for the clan.s leader and co-leaders/),
    ).toBeTruthy();
    expect(run).not.toHaveBeenCalled();
  });

  test("an unverified leader is refused Run", async () => {
    renderWithProviders(
      <Run clan={{ ...leader, verified: false }} navigate={vi.fn()} />,
    );
    expect(
      await screen.findByText(/Run is for the clan.s leader and co-leaders/),
    ).toBeTruthy();
  });

  test("a leader the server refuses sees the refusal, never the tools", async () => {
    vi.spyOn(manageApi, "run").mockResolvedValue({
      ok: false,
      status: 403,
      data: { error: "leaders_only" },
    });
    renderWithProviders(<Run clan={leader} navigate={vi.fn()} />);
    expect(
      await screen.findByText(/Run is for the clan.s leader and co-leaders/),
    ).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Run" })).toBeNull();
  });
});

describe("a name in Clan", () => {
  function nameLink(playerTag) {
    const client = createQueryClient();
    client.setQueryData(keys.me, {
      ok: true,
      status: 200,
      data: { identities: [{ player_tag: "#098R2R0PUL", name: "Ada" }] },
    });
    render(
      <QueryClientProvider client={client}>
        <MemberLink
          clanTag="#0QC8RCGY"
          playerTag={playerTag}
          navigate={vi.fn()}
        >
          name
        </MemberLink>
      </QueryClientProvider>,
    );
    return screen.getByRole("link", { name: "name" }).getAttribute("href");
  }

  test("a clanmate's name opens their player page", () => {
    expect(nameLink("#0QU8VGV")).toBe("/home/player/0QU8VGV");
  });

  test("your own name opens your page in this clan, which the player page cannot reach", () => {
    expect(nameLink("#098R2R0PUL")).toBe("/clan/0QC8RCGY/members/098r2r0pul");
  });
});
