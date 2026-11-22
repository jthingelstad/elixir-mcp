/**
 * A week's form on the Timeline (15.3.0): a closed game week's win rate
 * beside the four weeks before it, in one mode, with a way into that
 * player's Stats in that mode. Numbers only. Invented names and tags only.
 */
import { test, expect, vi, afterEach } from "vitest";
import { cleanup, within } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { smallMoment } from "../src/home/logic.js";
import { FeedItem, momentHead, weekFormHref } from "../src/home/FeedItem.jsx";

vi.mock("../src/analytics.js", () => ({ trackEvent: () => {} }));

afterEach(cleanup);

const PIP = "#0QPPRRC9";
const item = (over = {}) => ({
  id: "wf1",
  kind: "week_form",
  at: "2026-11-16T10:00:00.000Z",
  section: "battles",
  subject_tag: PIP,
  subjects: [{ kind: "player", tag: PIP, name: "Pip" }],
  groups: ["friends"],
  text: "Pip won 62% of 26 Trophy Road battles in the week to Nov 16, up from 48% over the 4 weeks before.",
  facts: {
    player_tag: PIP,
    name: "Pip",
    mode: "ladder",
    week: {
      from: "2026-11-09T10:00:00.000Z",
      to: "2026-11-16T10:00:00.000Z",
      battles: 27,
      decided_battles: 26,
      wins: 16,
      losses: 10,
      win_rate: 0.615,
    },
    previous: {
      from: "2026-10-12T10:00:00.000Z",
      to: "2026-11-09T10:00:00.000Z",
      weeks: 4,
      decided_battles: 60,
      win_rate: 0.483,
    },
  },
  cheers: {},
  my_cheer: null,
  ...over,
});

test("its head is the mode and the two rates, numbers only", () => {
  expect(momentHead(item())).toEqual({
    kicker: "Trophy Road form",
    title: "62% won, up from 48%",
  });
  expect(
    momentHead(item({ facts: { ...item().facts, mode: "war" } })).kicker,
  ).toBe("War form");
  expect(momentHead(item({ facts: { mode: "ladder" } }))).toBeNull();
});

test("it keeps its card, so its link shows: never a small moment", () => {
  expect(smallMoment(item())).toBe(false);
});

test("See stats opens the player's Stats in the item's mode", () => {
  expect(weekFormHref(item())).toBe(
    "/home/you/stats?player=0QPPRRC9&mode=ladder",
  );
  renderWithProviders(<FeedItem it={item()} />);
  const card = document.querySelector(".kit-feed__item");
  expect(card.textContent).toMatch(/Trophy Road form/);
  expect(card.textContent).toMatch(/62% won, up from 48%/);
  const link = within(card).getByRole("link", { name: "See stats" });
  expect(link.getAttribute("href")).toBe(
    "/home/you/stats?player=0QPPRRC9&mode=ladder",
  );
});

test("a shared item has no link into Stats", () => {
  renderWithProviders(<FeedItem it={item()} publicView />);
  expect(document.querySelector('a[href^="/home/you/stats"]')).toBeNull();
});

test("no other kind links into Stats", () => {
  renderWithProviders(
    <FeedItem it={item({ kind: "card_maxed", facts: { card: "Knight" } })} />,
  );
  expect(document.querySelector('a[href^="/home/you/stats"]')).toBeNull();
});
