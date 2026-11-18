import { test, expect, vi, afterEach } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import { PlayerIdentityProvider } from "@elixir-mcp/ui";
import { SharedItem } from "../src/views/SharedItem.jsx";
import { BATTLE } from "../e2e/battle-fixture.ts";
import { HOG } from "../e2e/session-fixture.ts";
import { renderWithProviders } from "./helpers.jsx";

const ID = "tl_0123456789abcdef0123";
const TAG = "#0QU8VGV";
const HOSTILE = '<img src=x onerror="alert(1)">';
const item = {
  id: ID,
  kind: "post",
  at: "2026-11-17T12:00:00.000Z",
  subjects: [{ kind: "player", tag: TAG, name: HOSTILE }],
  post: {
    text: "Two pushes at the end.",
    question: true,
    author: { player_tag: TAG, name: HOSTILE },
    battle: {
      crowns: 2,
      crowns_against: 1,
      outcome: "win",
      mode_group: "ladder",
      opponents: [{ name: "Birch Lantern" }],
    },
    versus: { mine: HOG, theirs: HOG },
  },
};
test("a share opens its exact member item and sign-in preserves that destination", () => {
  const member = "/home/item/tl_0123456789abcdef0123?ref=source&reply=42";
  const { rerender } = renderWithProviders(
    <SharedItem
      read={{ item, member_url: member }}
      me={{ authenticated: true }}
    />,
  );
  expect(
    screen
      .getByRole("link", { name: "Open item and comments" })
      .getAttribute("href"),
  ).toBe(member);
  rerender(
    <SharedItem
      read={{ item, member_url: member }}
      me={{ authenticated: false }}
    />,
  );
  expect(
    screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
  ).toBe(`/signin?return_to=${encodeURIComponent(member)}`);
});
test("the share waits for its source before offering a sign-in destination", () => {
  renderWithProviders(<SharedItem pending me={{ authenticated: false }} />);
  expect(
    screen.queryByRole("link", { name: "Sign in", exact: true }),
  ).toBeNull();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("a shared post is one item with writing and two decks, with no member actions or browsing", () => {
  window.history.replaceState({}, "", "/share/abcdefghijklmnopqrstuvwx");
  const { container } = renderWithProviders(
    <PlayerIdentityProvider players={{ [TAG]: true }}>
      <SharedItem read={{ item }} me={{ authenticated: false }} />
    </PlayerIdentityProvider>,
  );
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "Shared on Elixir",
  );
  expect(screen.getByText("Two pushes at the end.")).toBeTruthy();
  expect(screen.getByText("Question")).toBeTruthy();
  expect(container.querySelectorAll(".kit-vs .kit-deckrow")).toHaveLength(2);
  expect(container.querySelector("img[src='x']")).toBeNull();
  expect(
    container.querySelector(
      ".kit-player-name, .kit-verified, .kit-feed__foot, .kit-item-actions",
    ),
  ).toBeNull();
  expect(
    container.querySelector('a[href^="/battle/"], a[href^="/home/player/"]'),
  ).toBeNull();
  expect(screen.queryByRole("region", { name: "Comments" })).toBeNull();
  const back = encodeURIComponent("/share/abcdefghijklmnopqrstuvwx");
  expect(
    screen
      .getByRole("link", { name: "Create an account" })
      .getAttribute("href"),
  ).toBe(`/signin?signup&return_to=${back}`);
  expect(
    screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
  ).toBe(`/signin?return_to=${back}`);
});

test("signed-in viewers still see public names without reader aliases or verified marks", () => {
  const { container } = renderWithProviders(
    <PlayerIdentityProvider players={{ [TAG]: true }}>
      <SharedItem
        read={{ item }}
        me={{
          authenticated: true,
          claims: [{ player_tag: TAG, nickname: "Private Alias" }],
        }}
      />
    </PlayerIdentityProvider>,
  );
  expect(container.textContent).not.toContain("Private Alias");
  expect(container.querySelector(".kit-player-name, .kit-verified")).toBeNull();
  expect(
    screen
      .getByRole("link", { name: "Open your Timeline" })
      .getAttribute("href"),
  ).toBe("/timeline");
  expect(screen.queryByRole("link", { name: "Create an account" })).toBeNull();
});

test("a returning member can choose to follow the author of a shared battle post", () => {
  renderWithProviders(
    <SharedItem read={{ item }} me={{ authenticated: true, claims: [] }} />,
  );
  const link = screen.getByRole("link", { name: `Follow ${HOSTILE}` });
  expect(link.getAttribute("href")).toBe(`/home/follow/${TAG.slice(1)}`);
});

test("a shared 2v2 battle preserves four decks but no history or member actions", () => {
  const read = structuredClone(BATTLE);
  delete read.battle.url;
  delete read.battle.image;
  read.battle.kind = "2v2";
  read.sides[1].players[0].name = HOSTILE;
  read.sides[0].players.push({
    ...read.sides[0].players[0],
    player_tag: "#00VYVC",
    name: "Willow Kite",
  });
  read.sides[1].players.push({
    ...read.sides[1].players[0],
    player_tag: "#0QU8VGV",
    name: "Cedar Gull",
  });
  const { container } = renderWithProviders(
    <SharedItem
      read={{ item: { ...read, kind: "battle", id: ID } }}
      me={{ authenticated: true }}
    />,
  );
  expect(screen.getAllByRole("region", { name: /’s deck$/ })).toHaveLength(4);
  expect(screen.getAllByText("Willow Kite").length).toBeGreaterThan(0);
  expect(container.querySelector("img[src='x'], a.battle__name")).toBeNull();
  expect(screen.queryByRole("region", { name: /’s session$/ })).toBeNull();
  expect(screen.queryByRole("region", { name: "Follow from here" })).toBeNull();
  expect(
    screen.queryByRole("region", { name: "Share this battle" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Cheer" })).toBeNull();
});

test("missing, loading and failed reads stay distinct without stale content", () => {
  const retry = vi.fn();
  const { rerender } = renderWithProviders(
    <SharedItem pending me={{ authenticated: false }} />,
  );
  expect(screen.getByRole("status").textContent).toContain("Loading");
  rerender(<SharedItem failed retry={retry} />);
  expect(screen.getByText("Elixir did not answer.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledOnce();
  rerender(<SharedItem read={null} />);
  expect(
    screen.getByRole("heading", { name: "No item at this link" }),
  ).toBeTruthy();
  expect(screen.queryByText(item.post.text)).toBeNull();
});
