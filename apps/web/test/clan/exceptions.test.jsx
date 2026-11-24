import { afterEach, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import {
  MemberExceptions,
  eventLine,
} from "../../src/clan/components/Exceptions.jsx";
import { manageApi } from "../../src/clan/api.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Member exceptions (2026-11-23) in a member's sheet: each running one
 * with what it does, who set it, its end and who can see it; Change and
 * End it; and the lines a member's history reads.
 */
const RUNNING = {
  exception_id: "x1",
  player_tag: "#0RC",
  kind: "keep_as_elder",
  visibility: "leaders",
  until: "2099-01-20T00:00:00.000Z",
  note: "Runs our tournaments",
  set_by: "#098R2R0PUL",
  set_by_name: "Ada",
  set_at: "2026-11-18T12:00:00.000Z",
};

test("a leader sees the running exception and can end it", async () => {
  vi.spyOn(manageApi, "memberExceptions").mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      player_tag: "#0RC",
      leader: true,
      exceptions: [RUNNING],
      events: [],
    },
  });
  const end = vi
    .spyOn(manageApi, "endException")
    .mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
  renderWithProviders(
    <MemberExceptions
      clanTag="#0QC8RCGY"
      member={{ player_tag: "#0RC", name: "Rook", role: "elder" }}
    />,
  );
  await waitFor(() =>
    expect(
      screen.getByText(/The rules won't suggest demoting Rook\./),
    ).toBeTruthy(),
  );
  const row = document.body.textContent;
  expect(row).toMatch(/Set by Ada on .+: “Runs our tournaments\.”/);
  expect(row).toMatch(/Leaders only can see this\./);
  expect(row).toMatch(/A kept Elder doesn't take one of the earned seats\./);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Change" })),
  );
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "End it" })),
  );
  expect(end).toHaveBeenCalledWith("#0QC8RCGY", "#0RC", "keep_as_elder");
});

test("Leader and Co-Leaders need no exception", async () => {
  vi.spyOn(manageApi, "memberExceptions").mockResolvedValue({
    ok: true,
    status: 200,
    data: { player_tag: "#0RC", leader: true, exceptions: [], events: [] },
  });
  renderWithProviders(
    <MemberExceptions
      clanTag="#0QC8RCGY"
      member={{ player_tag: "#0RC", name: "Rook", role: "coLeader" }}
    />,
  );
  expect(
    screen.getByText(/Leaders are never judged by the rules\./),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add" })).toBe(null);
});

test("each exception event reads as one line", () => {
  const e = { kind: "keep_as_elder", by: "#098R2R0PUL", by_name: "Ada" };
  expect(eventLine({ ...e, event: "added" })).toBe(
    "Keep as Elder added by Ada",
  );
  expect(eventLine({ ...e, event: "ended" })).toBe(
    "Keep as Elder ended by Ada",
  );
  expect(eventLine({ ...e, event: "expired", by: null, by_name: null })).toBe(
    "Keep as Elder ran out",
  );
  expect(
    eventLine({
      kind: "keep_in_clan",
      event: "changed",
      by: null,
      by_name: null,
      migration: "0318",
    }),
  ).toBe("Keep in clan given an end date when holds became exceptions");
  expect(
    eventLine({ kind: "away", event: "added", by: null, by_name: null }),
  ).toBe("Away added");
});
