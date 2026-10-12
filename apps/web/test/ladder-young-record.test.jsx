/**
 * The season home's next step while the record is young (2026-10-12):
 * the record's age and one step, Verify, then Clan, then a friend,
 * hidden from 28 days. Facts and a link; nothing about play.
 */
import { test, expect, vi, beforeEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { YOUNG_RECORD_DAYS, youngRecord } from "../src/ladder/ladder.js";
import { YoungRecord } from "../src/ladder/YoungRecord.jsx";

const now = Date.parse("2026-10-12T15:00:00Z");
const daysAgo = (d) => new Date(now - d * 86_400_000).toISOString();

test("the horizon is 28 days", () => {
  expect(YOUNG_RECORD_DAYS).toBe(28);
});

test("not verified: Verify, whatever the clan", () => {
  for (const clanRecorded of [true, false, null])
    expect(
      youngRecord({
        activeSince: daysAgo(6.5),
        now,
        verified: false,
        clanRecorded,
      }),
    ).toEqual({ days: 6, step: "verify" });
});

test("verified and in a recorded clan: open Clan", () => {
  expect(
    youngRecord({
      activeSince: daysAgo(3),
      now,
      verified: true,
      clanRecorded: true,
    }),
  ).toEqual({ days: 3, step: "clan" });
});

test("verified and no recorded clan: follow a friend", () => {
  expect(
    youngRecord({
      activeSince: daysAgo(27.9),
      now,
      verified: true,
      clanRecorded: false,
    }),
  ).toEqual({ days: 27, step: "follow" });
});

test("hidden at 28 days, with no start, or while the clan is unknown", () => {
  for (const activeSince of [daysAgo(28), daysAgo(90), null, undefined, "x"])
    expect(
      youngRecord({ activeSince, now, verified: false, clanRecorded: true }),
    ).toBeNull();
  expect(
    youngRecord({
      activeSince: daysAgo(1),
      now,
      verified: true,
      clanRecorded: null,
    }),
  ).toBeNull();
  // A start a moment in the future (clock skew) reads as today.
  expect(
    youngRecord({
      activeSince: daysAgo(-0.01),
      now,
      verified: false,
      clanRecorded: false,
    }),
  ).toEqual({ days: 0, step: "verify" });
});

function clansAnswer(clans) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ clans, home_clan: null }),
  }));
}
const summary = (since) => ({
  data: { meta: { recording_active_since: since } },
});
const fresh = () => new Date(Date.now() - 5 * 86_400_000).toISOString();
const player = {
  player_tag: "#2PYQ8GJ0",
  status: "unverified",
  last_known_clan_tag: "#QPPPP",
};

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("renders the record's age and Verify for an unverified player", async () => {
  clansAnswer([]);
  renderWithProviders(
    <YoungRecord player={player} summary={summary(fresh())} />,
  );
  expect(
    await screen.findByRole("heading", { name: "Your record is 5 days old" }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Verify your player ›" })
      .getAttribute("href"),
  ).toBe("/console/account/verify");
});

test("renders Open Clan for a verified player whose clan is recorded", async () => {
  clansAnswer([{ clan_tag: "#QPPPP", recording_status: "active" }]);
  renderWithProviders(
    <YoungRecord
      player={{ ...player, status: "verified" }}
      summary={summary(fresh())}
    />,
  );
  expect(
    (await screen.findByRole("link", { name: "Open Clan ›" })).getAttribute(
      "href",
    ),
  ).toBe("/clan");
});

test("renders Follow a friend for a verified player with no recorded clan", async () => {
  clansAnswer([{ clan_tag: "#QPPPP", recording_status: null }]);
  renderWithProviders(
    <YoungRecord
      player={{ ...player, status: "verified" }}
      summary={summary(fresh())}
    />,
  );
  expect(
    (
      await screen.findByRole("link", { name: "Follow a friend ›" })
    ).getAttribute("href"),
  ).toBe("/console/account/tracking#add-player-tag");
});

test("draws nothing once the record is 28 days old", async () => {
  clansAnswer([]);
  const old = new Date(Date.now() - 28 * 86_400_000).toISOString();
  const { container } = renderWithProviders(
    <YoungRecord player={player} summary={summary(old)} />,
  );
  await new Promise((r) => setTimeout(r, 0));
  expect(container.innerHTML).toBe("");
});
