import { afterEach, describe, expect, test } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { RosterTable, ClanHeader } from "../src/views/Clan.jsx";
import { Refused, REFUSALS } from "../src/views/Refused.jsx";
import { Landing } from "../src/views/Landing.jsx";
import { Disclaimer } from "@elixir-mcp/ui";
import { Clans } from "../src/views/Clans.jsx";
import { VerifyNotice } from "../src/views/VerifyNotice.jsx";
import { clanFromPath, parseClanPath } from "../src/App.jsx";
import { clanPath } from "../src/lib/base.js";

afterEach(cleanup);

const poap = {
  clan_tag: "#2PQRJ8LV",
  name: "Example Clan",
  acting_as: "#20QQL8CCRU",
  acting_as_name: "Ada",
  role: "leader",
  role_label: "Leader",
  your_tags: ["#20QQL8CCRU"],
};
const other = {
  clan_tag: "#PYLQ2",
  name: "Elsewhere",
  acting_as: "#8QCV",
  acting_as_name: "Ada's other",
  role: "member",
  role_label: "Member",
  your_tags: ["#8QCV"],
};
const me = {
  signed_in: true,
  ok: true,
  principal: {
    kind: "person",
    subject: { type: "player", tag: "#20QQL8CCRU", name: "Ada" },
  },
  primary: { player_tag: "#20QQL8CCRU", name: "Ada" },
  identities: [
    {
      player_tag: "#20QQL8CCRU",
      name: "Ada",
      is_primary: true,
      relationship: "primary",
      claim_status: "verified",
      clan_tag: "#2PQRJ8LV",
      role: "leader",
      role_label: "Leader",
    },
  ],
  clans: [poap],
  selected: {
    clan_tag: "#2PQRJ8LV",
    name: "Example Clan",
    player_tag: "#20QQL8CCRU",
    player_name: "Ada",
    role: "leader",
    role_label: "Leader",
    your_tags: ["#20QQL8CCRU"],
  },
};

describe("the clan page", () => {
  test("header reads name · role · clan and says how current the roster is", () => {
    render(
      <ClanHeader
        clan={poap}
        roster={{
          name: "Example Clan",
          meta: { freshness_seconds: 120, as_of: "2026-09-12T18:00:00Z" },
        }}
      />,
    );
    const chip = screen.getByText("Ada", { exact: false }).closest(".chip");
    expect(chip.textContent).toContain("Ada");
    expect(within(chip).getByText("Leader")).toBeTruthy();
    expect(chip.textContent).toContain("Example Clan");
    expect(screen.getByText(/as of 2m ago/)).toBeTruthy();
  });

  test("a full clan is grouped by role with your row marked and the API's coLeader spelled Co-leader", () => {
    const now = Date.parse("2026-09-12T18:00:00Z");
    const members = [
      {
        player_tag: "#20QQL8CCRU",
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
    const labels = [...container.querySelectorAll("td.label")].map(
      (td) => td.textContent,
    );
    expect(labels).toEqual([
      "Leader · 1",
      "Co-leaders · 1",
      "Elders · 1",
      "Members · 1",
    ]);
    const you = container.querySelector("tr[data-you='true']");
    expect(you.textContent).toContain("★");
    expect(you.textContent).toContain("Ada");
    expect(container.querySelectorAll("tr[data-you='true']").length).toBe(1);
    expect(screen.getByText("Co-leader")).toBeTruthy();
    expect(screen.queryByText("coLeader")).toBeNull();
    expect(you.textContent).toContain("60m ago");
    // A null trophy count is a dash, never a zero.
    const amy = screen.getByText("Amy").closest("tr");
    const cells = [...amy.querySelectorAll("td")].map((td) => td.textContent);
    expect(cells[2]).toBe("—"); // trophies unknown
    expect(cells[3]).toBe("0"); // donations really zero
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
      const link = screen.getByRole("link", { name: `${page.link[1]} ›` });
      expect(link.getAttribute("href")).toBe(page.link[0]);
    },
  );

  test("the three refusals point at three different Elixir places; an unverified player is not one", () => {
    const hrefs = Object.values(REFUSALS).map((p) => p.link[0]);
    expect(new Set(hrefs).size).toBe(3);
    expect(REFUSALS.no_primary_player.link[0]).toContain(
      "/console/account/tracking",
    );
    expect(REFUSALS.unverified).toBeUndefined();
  });

  test("an agent's grant offers a fresh sign-in, the others offer a re-check", () => {
    renderWithProviders(
      <Refused reason="not_a_person" me={me} onRecheck={() => {}} />,
    );
    expect(
      screen.getByRole("link", { name: "Sign in again" }).getAttribute("href"),
    ).toBe("/console/signin");
    cleanup();
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
        .getByRole("link", { name: "Elixir → Tracking ›" })
        .getAttribute("href"),
    ).toContain("/console/account/tracking");
  });

  test("a stale absent-clan observation is dated, not a current membership assertion", () => {
    renderWithProviders(
      <Refused
        reason="no_clan"
        me={{
          ...me,
          identities: [
            {
              player_tag: "#8QCV",
              claim_status: "unverified",
              clan_tag: "#PYL",
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
    expect(screen.getByText(/no clan observed/).textContent).toContain(
      "2026-09-01",
    );
    expect(screen.queryByText(/recorded clan Former clan/)).toBeNull();
    expect(
      screen.getByText(/These are observations, not a live check/),
    ).toBeTruthy();
    expect(screen.getByText(/If that is still accurate/)).toBeTruthy();
  });
});

describe("the landing page", () => {
  test("names both prerequisites before the button", () => {
    renderWithProviders(<Landing />);
    expect(screen.getByText(/An Elixir account/)).toBeTruthy();
    expect(screen.getByText(/2\. Your player/)).toBeTruthy();
    // Both signup links bring a new account back to the Clan address.
    const signups = screen.getAllByRole("link", {
      name: "Create your account",
    });
    expect(signups).toHaveLength(2);
    for (const link of signups)
      expect(link.getAttribute("href")).toBe(
        "/console/signin?signup&return_to=%2Fclan",
      );
    expect(
      screen
        .getByRole("link", { name: "Sign in with Elixir" })
        .getAttribute("href"),
    ).toBe("/console/signin");
    expect(
      screen.getByText(
        "Your Elixir sign-in opens your recorded history and clan tools.",
      ),
    ).toBeTruthy();
  });

  test("a sign-in error is explained", () => {
    renderWithProviders(<Landing error="session_expired" />);
    expect(screen.getByRole("alert").textContent).toMatch(/Your session ended/);
  });
});

test("the disclaimer is Supercell's fan-content note", () => {
  render(<Disclaimer />);
  expect(screen.getByText(/not endorsed by Supercell/)).toBeTruthy();
  expect(screen.getByRole("link", { name: /fan-content-policy/ })).toBeTruthy();
});

describe("choosing a clan", () => {
  test("the header chip becomes a menu of the other clans when there is more than one", () => {
    render(
      <ClanHeader
        clan={poap}
        roster={null}
        others={[other]}
        navigate={() => {}}
      />,
    );
    const button = screen.getByRole("button", { expanded: false });
    expect(button.textContent).toContain("Ada");
    fireEvent.click(button);
    expect(screen.getByRole("menuitem", { name: /Elsewhere/ })).toBeTruthy();
    expect(
      screen
        .getByRole("menuitem", { name: /All your clans/ })
        .getAttribute("href"),
    ).toBe("/clan/clans");
  });

  test("one clan: a plain chip, no menu", () => {
    render(
      <ClanHeader clan={poap} roster={null} others={[]} navigate={() => {}} />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("the chooser lists verified clans as cards and unverified alts greyed with a Verify link", () => {
    const two = {
      ...me,
      clans: [poap, other],
      identities: [
        ...me.identities,
        {
          player_tag: "#8QCV",
          name: "Ada's other",
          is_primary: false,
          relationship: "alt",
          claim_status: "verified",
          clan_tag: "#PYLQ2",
          role: "member",
          role_label: "Member",
        },
        {
          player_tag: "#22GG",
          name: "Third",
          is_primary: false,
          relationship: "alt",
          claim_status: "unverified",
          clan_tag: "#RRR",
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
      "#2PQRJ8LV",
      "#PYLQ2",
    ]);
    expect(cards[0].getAttribute("aria-current")).toBe("true");
    expect(within(cards[1]).getByText("Member")).toBeTruthy();
    fireEvent.click(cards[1]);
    expect(chosen).toEqual(["#PYLQ2"]);
    expect(screen.getByText("Third")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /Verify in Elixir/ })
        .getAttribute("href"),
    ).toContain("/console/account/verify");
    expect(screen.queryByText("#RRR", { exact: false })).toBeTruthy();
  });

  test("clan paths carry the tag without its #, and only your clans resolve", () => {
    expect(clanPath("#2PQRJ8LV")).toBe("/clan/2PQRJ8LV");
    expect(clanFromPath("/clan/2PQRJ8LV", [poap, other])).toBe(poap);
    expect(clanFromPath("/clan/2pqrj8lv/", [poap])).toBe(poap);
    expect(clanFromPath("/clan/PYLQ2", [poap])).toBeNull();
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
    expect(parseClanPath("/clan/2PQRJ8L0")?.tag).toBe("#2PQRJ8L0");
    expect(parseClanPath("/clan/2PQRJ8LO")?.tag).toBe("#2PQRJ8L0");
    // Only under the prefix: the root is Elixir's.
    expect(parseClanPath("/2PQRJ8LV")).toBeNull();
  });

  test("the roster marks every one of your tags in a clan", () => {
    const members = [
      {
        player_tag: "#20QQL8CCRU",
        name: "Ada",
        role: "member",
        role_label: "Member",
        you: true,
      },
      {
        player_tag: "#8QCV",
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
  test("the notice after sign-in names the role waiting, links to Verify and goes on only when acknowledged", async () => {
    let acknowledged = 0;
    renderWithProviders(
      <VerifyNotice
        me={{
          ...me,
          verify_notice: {
            acknowledged: false,
            clans: [
              {
                clan_tag: "#2PQRJ8LV",
                clan_name: "Example Clan",
                player_tag: "#20QQL8CCRU",
                player_name: "Ada",
                role: "leader",
                role_label: "Leader",
              },
            ],
          },
        }}
        onAcknowledge={async () => {
          acknowledged += 1;
        }}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /Verify your player to lead/ }),
    ).toBeTruthy();
    expect(screen.getByText("Leader")).toBeTruthy();
    expect(screen.getByText(/Example Clan/)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /Verify in Elixir/ })
        .getAttribute("href"),
    ).toContain("/console/account/verify");
    fireEvent.click(
      screen.getByRole("button", { name: /I understand, continue/ }),
    );
    await Promise.resolve();
    expect(acknowledged).toBe(1);
  });

  test("the chooser shows its clan as a member's, marked unverified, with the role verifying brings", () => {
    const unverifiedClan = {
      ...poap,
      role: "member",
      role_label: "Member",
      verified: false,
      unlock: {
        player_tag: "#20QQL8CCRU",
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
