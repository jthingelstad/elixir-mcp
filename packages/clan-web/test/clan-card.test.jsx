/**
 * The clan card (G5, 2026-11-12): the head names the clan's tag, size, how
 * it takes members and its trophy floor; its chips carry the race now and
 * the rules the leaders saved, and none when the policy has no value for
 * one. The Feed's race bar is weekly decks, the place of the clans, fame
 * and the close. Synthetic names only.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ZoneProvider } from "@elixir-mcp/ui";
import { renderWithProviders } from "./helpers.jsx";
import { ClanHead, clanLine } from "../src/components/ClanHead.jsx";
import { RaceBar } from "../src/views/Feed.jsx";
import { api, manageApi } from "../src/api.js";
import { raceChip } from "../src/lib/words.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const clan = {
  clan_tag: "#0QC8RCGY",
  name: "Example Clan",
  role: "member",
  role_label: "Member",
  player_name: "Ada",
  verified: true,
};
const ok = (data) => ({ ok: true, status: 200, data });

const open = {
  season_id: 140,
  section_index: 1,
  is_colosseum: true,
  day_kind: "war",
  war_day: 2,
  finished: false,
  place: 2,
  fame: 4820,
  clans: 5,
  closes_at: "2026-11-16T10:00:00.000Z",
  decks: { used: 300, asked: 376 },
};

describe("the clan card", () => {
  test("the clan's line: tag, members, invite only and the trophy floor", () => {
    expect(
      clanLine(clan, {
        member_count: 47,
        type: "inviteOnly",
        required_trophies: 5000,
      }),
    ).toBe(
      "#0QC8RCGY · 47 members, 3 open · invite only · 5,000 trophies to join",
    );
    // Before the roster answers, just the tag; no floor, no floor words.
    expect(clanLine(clan, null)).toBe("#0QC8RCGY");
    expect(
      clanLine(clan, { member_count: 1, type: "open", required_trophies: 0 }),
    ).toBe("#0QC8RCGY · 1 member, 49 open · open to join");
  });

  test("the chips: the race now, then each rule the leaders saved", async () => {
    vi.spyOn(api, "roster").mockResolvedValue(
      ok({ clan_tag: clan.clan_tag, member_count: 47, members: [] }),
    );
    vi.spyOn(manageApi, "race").mockResolvedValue(ok({ race: open }));
    const me = {
      selected: clan,
      clans: [clan],
      policy: {
        set: true,
        chips: [
          { key: "war_intent", text: "In Clan Wars" },
          { key: "removal", text: "Removal at 10 quiet days" },
        ],
      },
    };
    renderWithProviders(<ClanHead me={me} path="/clan" navigate={vi.fn()} />);
    expect(
      await screen.findByText("2nd in the Colosseum · 4,820 fame"),
    ).toBeTruthy();
    expect(screen.getByText("In Clan Wars")).toBeTruthy();
    expect(screen.getByText("Removal at 10 quiet days")).toBeTruthy();
  });

  test("no saved rules and no race: no chip row at all", async () => {
    vi.spyOn(api, "roster").mockResolvedValue(
      ok({ clan_tag: clan.clan_tag, member_count: 47, members: [] }),
    );
    const race = vi
      .spyOn(manageApi, "race")
      .mockResolvedValue(ok({ race: null }));
    const me = { selected: clan, clans: [clan], policy: { set: false } };
    renderWithProviders(<ClanHead me={me} path="/clan" navigate={vi.fn()} />);
    await vi.waitFor(() => expect(race).toHaveBeenCalled());
    expect(screen.queryByRole("list", { name: "This clan" })).toBeNull();
  });

  test("the race chip names a place only when the read gives one", () => {
    expect(raceChip(null)).toBeNull();
    expect(
      raceChip({ ...open, is_colosseum: false, place: null, fame: 0 }),
    ).toBe("In the river race");
    expect(raceChip({ ...open, finished: true })).toBe(
      "Finished the Colosseum · 4,820 fame",
    );
    expect(raceChip({ day_kind: "training" })).toBe(
      "Clan Wars · training days",
    );
  });
});

describe("the Feed's race bar", () => {
  test("day of four, the week's decks, the place so far, fame and the close", () => {
    render(
      <ZoneProvider zone="America/Chicago">
        <RaceBar race={open} />
      </ZoneProvider>,
    );
    expect(screen.getByText("Colosseum · race open, day 2 of 4")).toBeTruthy();
    expect(screen.getByText("300 of 376 war decks this week")).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("value")).toBe("300");
    expect(bar.getAttribute("max")).toBe("376");
    expect(
      screen.getByText(
        "2nd of 5 clans so far · 4,820 fame · the race closes Monday about 4:00 am",
      ),
    ).toBeTruthy();
  });

  test("nothing between races", () => {
    const { container } = render(<RaceBar race={null} />);
    expect(container.textContent).toBe("");
  });
});
