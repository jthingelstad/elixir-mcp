/**
 * Readiness, and the questions it unlocks.
 *
 * The 2026-09-09 design split one panel into two jobs. Overview's
 * readiness list answers "can my agent answer about me yet, and if not
 * what is it waiting for". The starter questions moved to Connections,
 * where a connection is the thing you are working on. Both read the same
 * derived record, so the tests that were about prompts now render
 * ConnectionQuestions and the ones about state render FirstAnswer.
 */
import { test, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { FirstAnswer } from "../src/components/FirstAnswer.jsx";
import { ConnectionQuestions } from "../src/components/ConnectionQuestions.jsx";
import { App } from "../src/App.jsx";

const connection = {
  active_connections: 0,
  successful_data_calls_7d: 0,
  data_read_days_7d: 0,
  last_data_read_at: null,
};
const player = {
  player_tag: "#2PP0V90Y",
  name: "Test player",
  recording_status: "active",
  profile_available: false,
  profile_observed_at: null,
  battlelog_observed_at: null,
  battles_30d: 0,
  battles_7d: 0,
  battles_previous_7d: 0,
  distinct_decks_7d: 0,
};
function respond(p = player, c = connection, clan = null) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    text: async () =>
      JSON.stringify({
        as_of: "2026-09-08T23:00:00Z",
        player: p,
        connection: c,
        clan,
      }),
  }));
}
beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  respond();
});

test("account journey: add a player, capture arrives, copy a question, open personal connections", async () => {
  let added = false;
  let captured = false;
  const copy = vi.fn().mockResolvedValue();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: copy },
    configurable: true,
  });
  global.fetch = vi.fn(async (path, init = {}) => {
    let data;
    switch (path) {
      case "/api/me":
        data = {
          authenticated: true,
          role: "member",
          timezone: "UTC",
          claims: added
            ? [{ player_tag: player.player_tag, is_primary: true }]
            : [],
          recordings: [],
        };
        break;
      case "/api/me/clans":
        data = { clans: [] };
        break;
      case "/api/me/connections":
        data = { connections: [] };
        break;
      // Connections lists agents beside clients now: one table for
      // everything that can call with your authority.
      case "/api/me/principals":
        data = { agents: [] };
        break;
      case "/api/claims":
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body).player_tag).toBe(player.player_tag);
        added = true;
        data = { ok: true };
        break;
      case "/api/me/first-answer":
        data = {
          player: added ? { ...player, profile_available: captured } : null,
          connection,
        };
        break;
      default:
        throw new Error(`unmocked request: ${path}`);
    }
    return { ok: true, text: async () => JSON.stringify(data) };
  });
  window.history.pushState({}, "", "/console/account/overview");
  render(<App />);

  // Overview reports and sends you to Tracking; it no longer carries the
  // field itself, because nothing on Overview can be got wrong.
  expect(await screen.findByText("Your account is open")).toBeTruthy();
  fireEvent.click(
    await screen.findByRole("button", { name: "Add your player", exact: true }),
  );
  await waitFor(() =>
    expect(window.location.pathname).toBe("/console/account/tracking"),
  );
  const input = document.getElementById("add-player-tag");
  fireEvent.change(input, { target: { value: player.player_tag } });
  fireEvent.click(input.parentElement.querySelector("button"));

  captured = true;
  window.history.pushState({}, "", "/console/account/connections");
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Copy question: Start with your player snapshot",
    }),
  );
  await screen.findByText("Copied — paste into your connected client.");
  expect(copy.mock.calls[0][0]).toContain(player.player_tag);
});

test("no player: Overview says so and offers one action, and asks nothing", async () => {
  global.fetch = vi.fn(async (path) => {
    const data =
      path === "/api/me"
        ? { authenticated: true, role: "member", claims: [], recordings: [] }
        : path === "/api/me/first-answer"
          ? { player: null, connection }
          : { clans: [] };
    return { ok: true, text: async () => JSON.stringify(data) };
  });
  const navigate = vi.fn();
  window.history.pushState({}, "", "/console/account/overview");
  render(<App />);
  expect(
    await screen.findByText("No players yet — nothing here defaults to you."),
  ).toBeTruthy();
  expect(
    await screen.findByText("Start with your player tag in Tracking."),
  ).toBeTruthy();
  expect(screen.queryByText(/\d of 6/)).toBeNull();
  expect(screen.getByText("nothing here defaults to you")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Copy question/ })).toBeNull();
  expect(navigate).not.toHaveBeenCalled();
});

test("readiness names what each line is waiting for, not just that it is not done", async () => {
  respond();
  render(<FirstAnswer claimsKey="a" />);
  await screen.findByText("Add the player you play as");
  expect(
    screen
      .getByRole("link", { name: /Check recording status/ })
      .getAttribute("href"),
  ).toBe("/console/account/tracking");
  expect(screen.getByText("no profile snapshot available yet")).toBeTruthy();
  expect(
    screen.getByText(
      "No battles captured in the last 30 days · capture may be incomplete",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText("no recorded clan war history available"),
  ).toBeTruthy();
  expect(screen.getByText("no connections yet")).toBeTruthy();
});

test("readiness carries the window on every number it shows", async () => {
  respond(
    {
      ...player,
      profile_available: true,
      profile_observed_at: new Date(Date.now() - 240_000).toISOString(),
      battles_30d: 1284,
      battles_7d: 38,
    },
    {
      ...connection,
      active_connections: 2,
      last_data_read_at: new Date().toISOString(),
    },
    { clan_tag: "#Y8QRJ0LP", name: "POAP KINGS", war_weeks: 27 },
  );
  render(<FirstAnswer claimsKey="a" />);
  await screen.findByRole("link", { name: /Open Ladder/ });
  // A bare "1,284" is a claim; the window makes it a fact.
  expect(
    screen.getByText("1,284 in the last 30 days · 38 in the last 7"),
  ).toBeTruthy();
  expect(screen.getByText("POAP KINGS · 27 war weeks")).toBeTruthy();
  expect(screen.getByText("snapshot 4m ago")).toBeTruthy();
});

test("an active connection without a recent read is not the same as no connection", async () => {
  // A quiet agent and a broken one look identical from a count alone,
  // which is the whole reason this line carries the last read.
  respond(player, { ...connection, active_connections: 1 });
  render(<FirstAnswer claimsKey="a" />);
  await screen.findByText(
    "1 connected · no successful data read in the last 7 days",
  );
});

test("a browser-only profile leads to Ladder while AI and clan setup stay optional", async () => {
  respond({ ...player, profile_available: true });
  render(<FirstAnswer claimsKey="a" />);
  await screen.findByRole("link", { name: /Open Ladder/ });
  expect(screen.getByText("Clan war history (optional)")).toBeTruthy();
  expect(
    screen.getByText("snapshot recorded · observation time unavailable"),
  ).toBeTruthy();
  expect(screen.queryByText("snapshot never")).toBeNull();
  expect(screen.getByText("AI client connection (optional)")).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: "Ask an AI client (optional)" }),
  ).toBeTruthy();
  expect(
    screen.getByText(/You can use Ladder without connecting a client/),
  ).toBeTruthy();
  expect(screen.queryByText(/\d of 6/)).toBeNull();
});

test("older retained battles remain usable when recording stopped and the profile is missing", async () => {
  respond({
    ...player,
    recording_status: "stopped",
    last_battle_at: "2026-07-01T00:00:00Z",
  });
  render(<FirstAnswer claimsKey="a" />);
  await screen.findByText("older retained battles · none in the last 30 days");
  expect(
    screen.getByRole("link", { name: /Open Ladder/ }).getAttribute("href"),
  ).toBe("/ladder");
  expect(
    screen.getByRole("link", { name: /Manage recording/ }).getAttribute("href"),
  ).toBe("/console/account/tracking");
  expect(screen.queryByText(/Waiting for the first/)).toBeNull();
  expect(
    screen.getByRole("button", {
      name: "Copy question: Review your retained history",
    }),
  ).toBeTruthy();
});

test("paused recording without capture points to status instead of promising the next poll", async () => {
  respond({ ...player, recording_status: "paused" });
  render(<FirstAnswer claimsKey="a" />);
  await screen.findByRole("link", { name: /Check recording status/ });
  expect(screen.getByText(/recording paused/)).toBeTruthy();
  expect(screen.queryByText(/Waiting for the first/)).toBeNull();
  expect(screen.queryByRole("link", { name: /Open Ladder/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Copy question/ })).toBeNull();
});

test("partial capture and connection facts are unavailable rather than invented zeroes", async () => {
  respond(
    {
      ...player,
      profile_available: true,
      battles_30d: undefined,
      battles_7d: undefined,
    },
    {},
  );
  render(<FirstAnswer claimsKey="a" />);
  await screen.findByText("recent battle counts unavailable");
  expect(screen.getByRole("link", { name: /Open Ladder/ })).toBeTruthy();
  expect(screen.getByText("connection status unavailable")).toBeTruthy();
  expect(screen.getByText("recent data reads unavailable")).toBeTruthy();
  expect(screen.queryByText(/0 in the last 30 days/)).toBeNull();
  expect(screen.queryByText("no connections yet")).toBeNull();
});

test("successful reads are reported as reads, never as answers", async () => {
  respond(player, {
    ...connection,
    active_connections: 1,
    successful_data_calls_7d: 2,
    data_read_days_7d: 2,
    last_data_read_at: "2026-09-08T21:00:00Z",
  });
  render(<FirstAnswer claimsKey="a" />);
  const line = await screen.findByText(/1 connected · last read/);
  expect(line.textContent).not.toMatch(/answer/i);
});

test("a failed readiness request explains itself and can retry", async () => {
  global.fetch = vi.fn().mockRejectedValue(new Error("offline"));
  render(<FirstAnswer claimsKey="a" />);
  await screen.findByText(/Could not check your recorded data/);
  respond();
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await screen.findByText("Add the player you play as");
});

test("waiting capture can be worked around, then refreshes into a profile-only question", async () => {
  const navigate = vi.fn();
  render(<ConnectionQuestions claimsKey="a" navigate={navigate} />);
  await screen.findByText(/Waiting for the first capture/);
  expect(screen.queryByRole("button", { name: /Copy question/ })).toBeNull();
  respond({
    ...player,
    profile_available: true,
    profile_observed_at: "2026-09-08T20:00:00Z",
  });
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await screen.findByText("Start with your player snapshot");
  expect(screen.getAllByRole("button", { name: /Copy question/ })).toHaveLength(
    1,
  );
  expect(screen.queryByText("Compare your decks")).toBeNull();
});

test("questions follow observed samples", async () => {
  respond(
    {
      ...player,
      battles_30d: 8,
      battles_7d: 5,
      battles_previous_7d: 3,
      distinct_decks_7d: 2,
    },
    {
      ...connection,
      active_connections: 1,
      successful_data_calls_7d: 2,
      data_read_days_7d: 2,
      last_data_read_at: "2026-09-08T21:00:00Z",
    },
  );
  const copy = vi.fn().mockResolvedValue();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: copy },
    configurable: true,
  });
  render(<ConnectionQuestions claimsKey="a" navigate={vi.fn()} />);
  await screen.findByText("Compare your decks");
  await screen.findByText("Compare two recorded weeks");
  fireEvent.click(
    screen.getByRole("button", {
      name: "Copy question: Review your recorded battles",
    }),
  );
  await screen.findByText("Copied — paste into your connected client.");
  expect(copy.mock.calls[0][0]).toContain("#2PP0V90Y");
  expect(copy.mock.calls[0][0]).toContain("coverage");
  expect(copy.mock.calls[0][0]).toContain("last 7 days");
  expect(global.fetch).toHaveBeenCalledTimes(1); // copying does not record fake use
});

test("old history does not unlock recent comparisons, and clipboard refusal has a manual fallback", async () => {
  respond({ ...player, battles_30d: 2 });
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    configurable: true,
  });
  render(<ConnectionQuestions claimsKey="a" navigate={vi.fn()} />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Copy question: Review your recorded battles",
    }),
  );
  const manual = await screen.findByRole("textbox", {
    name: "Question to copy",
  });
  expect(manual.value).toContain("last 30 days");
  expect(screen.queryByText("Compare your decks")).toBeNull();
  expect(screen.queryByText("Compare two recorded weeks")).toBeNull();
});

test("older retained battles are useful history, not a pending first capture", async () => {
  respond({ ...player, last_battle_at: "2026-07-01T00:00:00Z" });
  render(<ConnectionQuestions claimsKey="a" navigate={vi.fn()} />);
  await screen.findByRole("button", {
    name: "Copy question: Review your retained history",
  });
  expect(screen.queryByText(/Waiting for the first capture/)).toBeNull();
});

test("changing primary discards old suggestions even when the earlier request arrives late", async () => {
  let resolve;
  global.fetch = vi.fn(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const view = render(
    <ConnectionQuestions claimsKey="old" navigate={vi.fn()} />,
  );
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  respond(null);
  view.rerender(<ConnectionQuestions claimsKey="new" navigate={vi.fn()} />);
  await screen.findByRole("button", { name: "Add your player" });
  resolve({
    ok: true,
    text: async () => JSON.stringify({ player, connection }),
  });
  await waitFor(() =>
    expect(screen.queryByText(/Waiting for the first capture/)).toBeNull(),
  );
});

test("Overview links incomplete steps and offers a supported first question without counting a connection as a read", async () => {
  respond(
    { ...player, profile_available: true },
    { ...connection, active_connections: 1 },
  );
  const copy = vi.fn().mockResolvedValue();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: copy },
  });
  render(<FirstAnswer claimsKey="a" />);
  await screen.findByRole("link", { name: /Open Ladder/ });
  expect(
    screen.getByRole("link", { name: /Clan recording/ }).getAttribute("href"),
  ).toBe("/console/account/tracking");
  expect(
    screen.getByRole("link", { name: /Connection help/ }).getAttribute("href"),
  ).toBe("/docs/quickstart");
  fireEvent.click(
    screen.getByRole("button", {
      name: "Copy question: Start with your player snapshot",
    }),
  );
  await screen.findByText("Copied — paste into your connected client.");
  expect(copy.mock.calls[0][0]).toContain(player.player_tag);
  expect(copy.mock.calls[0][0]).toContain(
    "Do not infer progress from a single snapshot",
  );
  expect(
    screen.getByText(/a connection alone does not confirm a data read/),
  ).toBeTruthy();
});
