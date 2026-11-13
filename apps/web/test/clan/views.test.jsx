import { afterEach, describe, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { RosterTable } from "../../src/clan/views/Clan.jsx";
import { Refused, REFUSALS } from "../../src/clan/views/Refused.jsx";
import { Disclaimer } from "@elixir-mcp/ui";
import { Clans } from "../../src/clan/views/Clans.jsx";
import { VerifyPlayer } from "../../src/components/VerifyPlayer.jsx";
import { clanFromPath, parseClanPath } from "../../src/clan/App.jsx";
import { clanPath } from "../../src/clan/lib/base.js";

// The app's follow buttons read the follow plan; here they only say who
// they were asked about.
const asked = vi.hoisted(() => []);
vi.mock("../../src/home/FollowClan.jsx", () => ({
  FollowMember: ({ clanTag, playerTag, name }) => {
    asked.push([clanTag, playerTag, name]);
    return <button type="button">Follow {name}</button>;
  },
  FollowClan: () => null,
  FollowThisClan: () => null,
}));

afterEach(cleanup);

const poap = {
  clan_tag: "#0QC8RCGY",
  name: "Example Clan",
  acting_as: "#098R2R0PUL",
  acting_as_name: "Ada",
  role: "leader",
  role_label: "Leader",
  your_tags: ["#098R2R0PUL"],
};
const other = {
  clan_tag: "#0Y2V2",
  name: "Elsewhere",
  acting_as: "#0RJL",
  acting_as_name: "Ada's other",
  role: "member",
  role_label: "Member",
  your_tags: ["#0RJL"],
};
const me = {
  signed_in: true,
  ok: true,
  principal: {
    kind: "person",
    subject: { type: "player", tag: "#098R2R0PUL", name: "Ada" },
  },
  primary: { player_tag: "#098R2R0PUL", name: "Ada" },
  identities: [
    {
      player_tag: "#098R2R0PUL",
      name: "Ada",
      is_primary: true,
      relationship: "primary",
      claim_status: "verified",
      clan_tag: "#0QC8RCGY",
      role: "leader",
      role_label: "Leader",
    },
  ],
  clans: [poap],
  selected: {
    clan_tag: "#0QC8RCGY",
    name: "Example Clan",
    player_tag: "#098R2R0PUL",
    player_name: "Ada",
    role: "leader",
    role_label: "Leader",
    your_tags: ["#098R2R0PUL"],
  },
};

describe("the clan page", () => {
  test("a full clan keeps role order without duplicate headings, with your row marked and the API's coLeader spelled Co-leader", () => {
    const now = Date.parse("2026-09-12T18:00:00Z");
    const members = [
      {
        player_tag: "#098R2R0PUL",
        name: "Ada",
        role: "leader",
        role_label: "Leader",
        trophies: 8000,
        donations_this_week: 40,
        you: true,
        last_seen_in_game: "2026-09-12T17:00:00Z",
        last_recorded_battle: null,
      },
      {
        player_tag: "#C1",
        name: "Bo",
        role: "coLeader",
        role_label: "Co-leader",
        trophies: 8500,
        donations_this_week: 5,
        you: false,
      },
      {
        player_tag: "#E1",
        name: "Amy",
        role: "elder",
        role_label: "Elder",
        trophies: null,
        donations_this_week: 0,
        you: false,
      },
      {
        player_tag: "#M1",
        name: "Zed",
        role: "member",
        role_label: "Member",
        trophies: 9000,
        donations_this_week: 10,
        you: false,
      },
    ];
    const { container } = renderWithProviders(
      <RosterTable members={members} now={now} />,
    );
    const roles = [
      ...container.querySelectorAll("tbody tr td:nth-child(2)"),
    ].map((td) => td.textContent);
    expect(roles).toEqual(["Leader", "Co-leader", "Elder", "Member"]);
    expect(container.querySelector("td.label")).toBeNull();
    const you = container.querySelector("tr[data-you='true']");
    expect(you.textContent).toContain("you");
    expect(you.textContent).toContain("Ada");
    expect(container.querySelectorAll("tr[data-you='true']").length).toBe(1);
    expect(screen.getByText("Co-leader")).toBeTruthy();
    expect(screen.queryByText("coLeader")).toBeNull();
    expect(you.textContent).toContain("Sep 12");
    // A null trophy count is a dash, never a zero.
    const amy = screen.getByText("Amy").closest("tr");
    const cells = [...amy.querySelectorAll("td")].map((td) => td.textContent);
    expect(cells[2]).toBe("—"); // trophies unknown
    expect(cells[3]).toBe("0"); // donations really zero
  });

  test("each row carries the app's Follow for a clan, and none without one", () => {
    const members = [
      { player_tag: "#C1", name: "Bo", role: "coLeader", trophies: 1 },
      { player_tag: "#M1", name: "Zed", role: "member", trophies: 2 },
    ];
    asked.length = 0;
    const { container } = renderWithProviders(
      <RosterTable members={members} clanTag="#0QC8RCGY" />,
    );
    expect(container.querySelectorAll("td.roster-table__follow").length).toBe(
      2,
    );
    expect(screen.getByRole("button", { name: "Follow Zed" })).toBeTruthy();
    expect(asked).toContainEqual(["#0QC8RCGY", "#M1", "Zed"]);
    cleanup();
    const bare = renderWithProviders(<RosterTable members={members} />);
    expect(bare.container.querySelector(".roster-table__follow")).toBeNull();
  });

  test("an empty clan renders no rows and no groups", () => {
    const { container } = renderWithProviders(<RosterTable members={[]} />);
    expect(container.querySelectorAll("tbody").length).toBe(0);
    expect(container.querySelector("table")).toBeTruthy();
  });
});

describe("the gate pages", () => {
  test.each(Object.keys(REFUSALS))(
    "%s says what to do and links to it",
    (reason) => {
      renderWithProviders(
        <Refused reason={reason} me={me} onRecheck={() => {}} />,
      );
      const page = REFUSALS[reason];
      expect(screen.getByRole("heading", { name: page.title })).toBeTruthy();
      const link = screen.getByRole("link", {
        name: page.plain ? page.link[1] : `${page.link[1]} ›`,
      });
      expect(link.getAttribute("href")).toBe(page.link[0]);
    },
  );

  test("each refusal points at its own Elixir place; an unverified player is not one", () => {
    const hrefs = Object.values(REFUSALS).map((p) => p.link[0]);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(REFUSALS.no_primary_player.link[0]).toBe("/home#add-player");
    expect(REFUSALS.unverified).toBeUndefined();
  });

  test("a refusal offers a re-check; a non-person has no Clan page", () => {
    expect(REFUSALS.not_a_person).toBeUndefined();
    renderWithProviders(
      <Refused reason="no_clan" me={me} onRecheck={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /check again/i })).toBeTruthy();
  });

  test("missing observations offer recording help, without claiming no clan or asking anyone to join", () => {
    renderWithProviders(
      <Refused reason="membership_unknown" me={me} onRecheck={() => {}} />,
    );
    expect(
      screen.getByRole("heading", { name: "Waiting for your clan record" }),
    ).toBeTruthy();
    expect(screen.queryByText(/join a clan/i)).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Settings → Players ›" })
        .getAttribute("href"),
    ).toContain("/settings/players");
  });

  test("a stale absent-clan observation is dated, not a current membership assertion", () => {
    renderWithProviders(
      <Refused
        reason="no_clan"
        me={{
          ...me,
          identities: [
            {
              player_tag: "#0RJL",
              claim_status: "unverified",
              clan_tag: "#0C9",
              clan_name: "Former clan",
              membership_capture: {
                state: "none",
                observed_at: "2026-09-01T12:00:00Z",
              },
            },
          ],
        }}
        onRecheck={() => {}}
      />,
    );
    expect(screen.getByText(/no clan seen/).textContent).toMatch(
      /Tue Sep 1( 2026)?,/,
    );
    expect(screen.queryByText(/recorded clan Former clan/)).toBeNull();
    expect(
      screen.getByText(/These are observations, not a live check/),
    ).toBeTruthy();
    expect(screen.getByText(/If that is still accurate/)).toBeTruthy();
  });
});

test("the disclaimer is Supercell's fan-content note", () => {
  render(<Disclaimer />);
  expect(screen.getByText(/not endorsed by Supercell/)).toBeTruthy();
  expect(screen.getByRole("link", { name: /fan-content-policy/ })).toBeTruthy();
});

describe("choosing a clan", () => {
  test("the chooser lists verified clans as cards and unverified alts greyed with a Verify link", () => {
    const two = {
      ...me,
      clans: [poap, other],
      identities: [
        ...me.identities,
        {
          player_tag: "#0RJL",
          name: "Ada's other",
          is_primary: false,
          relationship: "alt",
          claim_status: "verified",
          clan_tag: "#0Y2V2",
          role: "member",
          role_label: "Member",
        },
        {
          player_tag: "#0PJG",
          name: "Third",
          is_primary: false,
          relationship: "alt",
          claim_status: "unverified",
          clan_tag: "#0YY",
          role: "member",
          role_label: "Member",
        },
      ],
    };
    const chosen = [];
    render(
      <Clans me={two} onSelect={(t) => chosen.push(t)} selecting={false} />,
    );
    const cards = screen.getAllByRole("button");
    expect(cards.map((c) => c.getAttribute("data-clan"))).toEqual([
      "#0QC8RCGY",
      "#0Y2V2",
    ]);
    expect(cards[0].getAttribute("aria-current")).toBe("true");
    expect(within(cards[1]).getByText("Member")).toBeTruthy();
    fireEvent.click(cards[1]);
    expect(chosen).toEqual(["#0Y2V2"]);
    expect(screen.getByText("Third")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /Verify your player/ })
        .getAttribute("href"),
    ).toContain("/settings/players/verify");
    expect(screen.queryByText("#0YY", { exact: false })).toBeTruthy();
  });

  test("clan paths carry the tag without its #, and only your clans resolve", () => {
    expect(clanPath("#0QC8RCGY")).toBe("/clan/0QC8RCGY");
    expect(clanFromPath("/clan/0QC8RCGY", [poap, other])).toBe(poap);
    expect(clanFromPath("/clan/0qc8rcgy/", [poap])).toBe(poap);
    expect(clanFromPath("/clan/0Y2V2", [poap])).toBeNull();
    expect(clanFromPath("/clan", [poap])).toBeNull();
    expect(clanFromPath("/clan/", [poap])).toBeNull();
    expect(clanFromPath("/clan/clans", [poap])).toBeNull();
  });

  test("the app's own pages win over a tag, and a tag is the game's alphabet", () => {
    for (const page of [
      "clans",
      "you",
      "you/away",
      "verify",
      "refused/no_clan",
      "feedback",
      "feedback/abc",
      "maintain/feedback",
    ])
      expect(parseClanPath(`/clan/${page}`)).toBeNull();
    // "you" is Y, 0 and U once O reads as 0, and still not a clan.
    expect(parseClanPath("/clan/you/me")).toBeNull();
    expect(parseClanPath("/clan/ABCDEF")).toBeNull();
    expect(parseClanPath("/clan/00LCU9Q0")?.tag).toBe("#00LCU9Q0");
    expect(parseClanPath("/clan/00LCU9Q0")?.tag).toBe("#00LCU9Q0");
    // Only under the prefix: the root is Elixir's.
    expect(parseClanPath("/0QC8RCGY")).toBeNull();
  });

  test("the roster marks every one of your tags in a clan", () => {
    const members = [
      {
        player_tag: "#098R2R0PUL",
        name: "Ada",
        role: "member",
        role_label: "Member",
        you: true,
      },
      {
        player_tag: "#0RJL",
        name: "Ada's other",
        role: "coLeader",
        role_label: "Co-leader",
        you: true,
      },
      {
        player_tag: "#X",
        name: "Someone",
        role: "member",
        role_label: "Member",
        you: false,
      },
    ];
    const { container } = renderWithProviders(
      <RosterTable members={members} now={0} />,
    );
    expect(container.querySelectorAll("tr[data-you='true']").length).toBe(2);
  });
});

describe("an unverified player", () => {
  test("the notice after sign-in is Elixir's verify notice, linking to Verify", () => {
    renderWithProviders(<VerifyPlayer titleAs="h1" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Verify your player" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /Verify a player/ })
        .getAttribute("href"),
    ).toBe("/settings/players/verify");
  });

  test("the chooser shows its clan as a member's, marked unverified, with the role verifying brings", () => {
    const unverifiedClan = {
      ...poap,
      role: "member",
      role_label: "Member",
      verified: false,
      unlock: {
        player_tag: "#098R2R0PUL",
        name: "Ada",
        role: "leader",
        role_label: "Leader",
      },
    };
    render(
      <Clans
        me={{ ...me, clans: [unverifiedClan] }}
        onSelect={() => {}}
        selecting={false}
      />,
    );
    const [card] = screen.getAllByRole("button");
    expect(within(card).getByText("Member")).toBeTruthy();
    expect(within(card).getByText("unverified")).toBeTruthy();
    expect(within(card).getByText(/Leader in the game, once Ada/)).toBeTruthy();
  });
});
