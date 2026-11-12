/**
 * Clan as one view (slice 8, #766): the Feed draws the clan's timeline,
 * Policy reads the clan's policy to every member (editing it is Run's), and
 * Run is refused to anyone who does not lead the clan, by the page and by
 * the server's answer. Synthetic names only.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@elixir-mcp/client";
import { renderWithProviders } from "./helpers.jsx";
import { Feed } from "../src/views/Feed.jsx";
import { ClanPolicy } from "../src/views/ClanPolicy.jsx";
import { Run } from "../src/views/Run.jsx";
import { manageApi } from "../src/api.js";
import { MemberLink } from "../src/components/MemberLink.jsx";
import { keys } from "../src/lib/queries.js";

vi.mock("@tanstack/react-router", async (actual) => ({
  ...(await actual()),
  useBlocker: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const member = {
  clan_tag: "#2PQRJ8LV",
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
  test("the clan's timeline, its highlights' words and battles, newest first", async () => {
    sideCardsUnread();
    vi.spyOn(manageApi, "feed").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        clan_tag: "#2PQRJ8LV",
        window_days: 7,
        more: 0,
        items: [
          {
            id: "h1",
            kind: "battle_highlight",
            at: "2026-11-12T10:00:00Z",
            text: "Ada posted a highlight",
            words: "Three crowns at last",
            battle_url: "https://elixir.test/battle/abc",
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
    expect(await screen.findByText("Ada posted a highlight")).toBeTruthy();
    expect(screen.getByText(/Three crowns at last/)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Open the battle" })
        .getAttribute("href"),
    ).toBe("/battle/abc");
    expect(screen.getByText("Bo joined the clan")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Feed", level: 2 }),
    ).toBeTruthy();
  });

  test("an empty week says so, and a failed read never shows stale items", async () => {
    sideCardsUnread();
    vi.spyOn(manageApi, "feed").mockResolvedValue({
      ok: true,
      status: 200,
      data: { clan_tag: "#2PQRJ8LV", window_days: 7, more: 0, items: [] },
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
      data: { clan_tag: "#2PQRJ8LV", window_days: 7, more: 0, items },
    });
    renderWithProviders(<Feed clan={member} navigate={vi.fn()} />);
    expect(await screen.findByText("Member 30 joined the clan")).toBeTruthy();
    expect(screen.queryByText("Member 31 joined the clan")).toBeNull();
    expect(screen.getByText("30 of 45 shown")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByText("Member 45 joined the clan")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  });

  test("the timeline is read only once the reads beside it have answered", async () => {
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
      data: { clan_tag: "#2PQRJ8LV", window_days: 7, more: 0, items: [] },
    });
    renderWithProviders(<Feed clan={member} navigate={vi.fn()} />);
    expect(await screen.findByText(/Reading your numbers/)).toBeTruthy();
    expect(feed).not.toHaveBeenCalled();
    answer(unread);
    expect(
      await screen.findByText("Nothing in the last seven days"),
    ).toBeTruthy();
    expect(feed).toHaveBeenCalledTimes(1);
  });
});

const policyAnswer = (set = true) => ({
  ok: true,
  status: 200,
  data: {
    set,
    can_edit: false,
    current: set
      ? { version: 3, saved_at: "2026-11-01T12:00:00Z", saved_by_name: "Ada" }
      : { version: 0 },
    how: set
      ? [
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

describe("Policy", () => {
  test("a member reads how the clan runs, with no way to change it", async () => {
    vi.spyOn(manageApi, "policy").mockResolvedValue(policyAnswer());
    renderWithProviders(<ClanPolicy clan={member} navigate={vi.fn()} />);
    expect(
      await screen.findByText("Elder goes to the members who give the most."),
    ).toBeTruthy();
    expect(screen.getByText("Clan Wars")).toBeTruthy();
    expect(screen.getByText("60%")).toBeTruthy();
    expect(screen.getByText(/saved .* by Ada\./)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /in Run/ })).toBeNull();
  });

  test("a leader is sent to Run to change it", async () => {
    vi.spyOn(manageApi, "policy").mockResolvedValue(policyAnswer());
    const navigate = vi.fn();
    renderWithProviders(<ClanPolicy clan={leader} navigate={navigate} />);
    const link = await screen.findByRole("link", { name: "Change it in Run" });
    expect(link.getAttribute("href")).toBe("/clan/2PQRJ8LV/run/about");
  });

  test("no policy: a member is told nothing runs until one is saved", async () => {
    vi.spyOn(manageApi, "policy").mockResolvedValue(policyAnswer(false));
    renderWithProviders(<ClanPolicy clan={member} navigate={vi.fn()} />);
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
      data: { identities: [{ player_tag: "#20QQL8CCRU", name: "Ada" }] },
    });
    render(
      <QueryClientProvider client={client}>
        <MemberLink
          clanTag="#2PQRJ8LV"
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
    expect(nameLink("#8QCVLQ2")).toBe("/home/player/8QCVLQ2");
  });

  test("your own name opens your page in this clan, which the player page cannot reach", () => {
    expect(nameLink("#20QQL8CCRU")).toBe("/clan/2PQRJ8LV/members/20qql8ccru");
  });
});
