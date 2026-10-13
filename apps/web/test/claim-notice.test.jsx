/**
 * #556: where the primary is shown, an account whose primary ended when
 * another account verified its tag (or whose signup tag was verified
 * elsewhere) is told so: the tag, that nothing defaults to it, and what to
 * do. Never the account that verified it; nothing when there is no notice.
 */
import { test, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { ClaimNotice } from "../src/components/ClaimNotice.jsx";

afterEach(cleanup);

const notice = (kind) => ({
  kind,
  player_tag: "#2PP0V90Y",
  at: "2026-10-12T20:00:00Z",
});

test("an ended primary names the tag, says there is none, and points at the players left", () => {
  renderWithProviders(
    <ClaimNotice
      me={{
        claim_notice: notice("primary_ended"),
        claims: [{ player_tag: "#8QU2PJ8C", is_primary: false }],
      }}
    />,
  );
  const box = screen.getByRole("status");
  expect(box.textContent).toMatch(/Another account verified #2PP0V90Y/);
  expect(box.textContent).toMatch(/you have none: nothing defaults to you/);
  expect(box.textContent).toMatch(
    /Open one of your players and make it primary/,
  );
  expect(
    screen.getByRole("link", { name: "Feedback" }).getAttribute("href"),
  ).toBe("/console/account/feedback");
});

test("with no players left, it says to add one, on Tracking without a link to itself", () => {
  renderWithProviders(
    <ClaimNotice
      me={{ claim_notice: notice("primary_ended"), claims: [] }}
      onTracking
    />,
  );
  expect(screen.getByRole("status").textContent).toMatch(
    /Add your player below\./,
  );
  expect(screen.queryByRole("link", { name: "Tracking" })).toBeNull();
});

test("a signup tag verified elsewhere says it was not added, with a link to Tracking", () => {
  renderWithProviders(
    <ClaimNotice
      me={{ claim_notice: notice("signup_tag_refused"), claims: [] }}
    />,
  );
  expect(screen.getByRole("status").textContent).toMatch(
    /#2PP0V90Y, the player tag you signed up with, is verified by another account, so it was not added/,
  );
  expect(
    screen.getByRole("link", { name: "Tracking" }).getAttribute("href"),
  ).toBe("/console/account/tracking");
});

test("nothing to say, nothing shown", () => {
  const { container } = renderWithProviders(
    <ClaimNotice me={{ claim_notice: null, claims: [] }} />,
  );
  expect(container.textContent).toBe("");
});
