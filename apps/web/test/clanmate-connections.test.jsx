import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import {
  FromYourBattles,
  StarterSet,
  YourClanPeople,
} from "../src/home/People.jsx";
import { OnboardingPeople } from "../src/home/OnboardingPeople.jsx";
import { FollowClan, FollowMember } from "../src/home/FollowClan.jsx";
import { ClanmateState } from "../src/home/Connection.jsx";

let data;
vi.mock("../src/App.jsx", () => ({
  useMe: () => ({ me: { authenticated: true, features: {} } }),
}));
vi.mock("../src/lib/queries.js", async (original) => ({
  ...(await original()),
  usePeople: () => ({ data, isPending: false }),
  useFollowPlan: () => ({ data }),
}));

const mate = {
  player_tag: "#0G2ULUJP",
  tag: "#0G2ULUJP",
  name: "Juniper",
  clanmate: "#0LL2",
  connection: "clanmate",
  shared_clan: { clan_tag: "#0LL2", name: "Grove" },
  following: false,
  free: true,
  role: "member",
};
beforeEach(() => {
  data = {
    ok: true,
    clan: { clan_tag: "#0LL2", name: "Grove" },
    clans: [{ clan_tag: "#0LL2", name: "Grove" }],
    shared_clan: { clan_tag: "#0LL2", name: "Grove" },
    players: [mate],
    people: [mate],
    yours: [],
    to_follow: 1,
    slots: 0,
    free: 1,
    following: 0,
    used: 1,
    limit: 50,
    fits: true,
    days: 30,
    more: 0,
  };
});

test("Find keeps verified alts' clan connections under their own clan names", () => {
  data = {
    ...data,
    clans: [...data.clans, { clan_tag: "#0U082URG", name: "Willow Guild" }],
    players: [
      ...data.players,
      {
        ...mate,
        tag: "#0Q2UQ2YR",
        player_tag: "#0Q2UQ2YR",
        name: "Cypress",
        clanmate: "#0U082URG",
        shared_clan: { clan_tag: "#0U082URG", name: "Willow Guild" },
      },
    ],
  };
  renderWithProviders(<YourClanPeople />);
  expect(screen.getByRole("heading", { name: "Willow Guild" })).toBeTruthy();
  const group = screen.getByRole("region", { name: "Willow Guild" });
  expect(within(group).getByRole("link", { name: "Cypress" })).toBeTruthy();
  expect(within(group).queryByRole("link", { name: "Juniper" })).toBeNull();
  expect(
    screen.getAllByText(/Membership comes from Clash Royale/),
  ).toHaveLength(1);
});

test("Find asks for verification without claiming an unverified player's clan is missing", () => {
  data = {
    ...data,
    clan: null,
    clans: [],
    players: [],
    requires_verification: true,
  };
  renderWithProviders(<YourClanPeople />);
  expect(screen.getByRole("link", { name: "Verify your player" })).toBeTruthy();
  expect(screen.queryByText(/isn.t in a clan/i)).toBeNull();
});

test("own Clan Members replaces bulk and per-member friending prompts with connected states", () => {
  renderWithProviders(
    <>
      <FollowClan clanTag="#0LL2" />
      <FollowMember clanTag="#0LL2" playerTag={mate.tag} name={mate.name} />
    </>,
  );
  expect(screen.queryByRole("button", { name: /follow everyone/i })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Follow", exact: true }),
  ).toBeNull();
  expect(screen.getByText("Clanmate", { exact: true })).toBeTruthy();
});

test("another clan keeps its voluntary friendship controls", () => {
  data = {
    ...data,
    shared_clan: null,
    players: [{ ...mate, connection: null, clanmate: null, shared_clan: null }],
  };
  renderWithProviders(
    <>
      <FollowClan clanTag="#0U082URG" />
      <FollowMember clanTag="#0U082URG" playerTag={mate.tag} name={mate.name} />
    </>,
  );
  expect(screen.getByRole("button", { name: "Follow everyone" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Follow", exact: true }),
  ).toBeTruthy();
});

test.each([
  [false, "Friend"],
  [true, "Close friend"],
])(
  "an explicit friend is the primary status while clanmate stays secondary (close=%s)",
  (close, label) => {
    const { container } = renderWithProviders(
      <ClanmateState friend close={close} />,
    );
    expect(container.querySelector(".kit-badge").textContent.trim()).toBe(
      label,
    );
    expect(screen.getByText("Clanmate", { exact: true })).toBeTruthy();
  },
);
afterEach(cleanup);

test("Find's current clan is a connection roster, not a prompt to friend everyone", () => {
  renderWithProviders(<YourClanPeople />);
  expect(screen.getByText(/clanmates connect automatically/i)).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Juniper" }).getAttribute("href"),
  ).toBe("/home/player/0G2ULUJP");
  expect(
    screen.queryByRole("button", { name: /follow my clan|follow everyone/i }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Follow", exact: true }),
  ).toBeNull();
});

test("a clanmate met in battle is identified without a default friend prompt", () => {
  renderWithProviders(<FromYourBattles />);
  const row = screen.getByRole("link", { name: "Juniper" }).closest(".kit-row");
  expect(row).not.toBeNull();
  expect(within(row).getByText("Clanmate", { exact: true })).toBeTruthy();
  expect(
    within(row).queryByRole("button", { name: "Follow", exact: true }),
  ).toBeNull();
});

test("an empty starter explains the automatic clan connection rather than soliciting clanmate follows", () => {
  data = { ...data, offer: true, people: [] };
  renderWithProviders(<StarterSet query={{ data }} />);
  expect(screen.getByText(/clanmates connect automatically/i)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /follow these/i })).toBeNull();
});

test("new players can open their connected clanmates without friending anyone", () => {
  data = { ...data, offer: false, people: [], clanmate_count: 2 };
  const open = vi.fn();
  const followed = vi.fn();
  renderWithProviders(
    <OnboardingPeople
      progress={{ data: { state: "ready" } }}
      onOpenTimeline={open}
      onFollowed={followed}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "2 clanmates connected" }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: /follow these/i })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open Timeline" }));
  expect(open).toHaveBeenCalledOnce();
  expect(followed).not.toHaveBeenCalled();
});
