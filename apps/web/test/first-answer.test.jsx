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
  configure,
} from "@testing-library/react";
import { FirstAnswer } from "../src/components/FirstAnswer.jsx";
import {
  FAST_POLL_MS,
  SLOW_POLL_MS,
  nextPoll,
} from "../src/hooks/useFirstAnswer.js";
import { ConnectionQuestions } from "../src/components/ConnectionQuestions.jsx";
import { App } from "../src/App.jsx";

// Two of these tests render the whole App, routes and all, from a cold
// module graph. Under a loaded machine (a full verify beside a deploy's
// build) the first paint took past Testing Library's 1 s default and the
// journey failed on "Your account is open". Bound the wait as the other
// whole-App journeys do (account-journeys.test.jsx), so a slow runner is
// not read as a missing element.
configure({ asyncUtilTimeout: 5000 });

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

test(
  "account journey: add a player, capture arrives, copy a question, open personal connections",
  { timeout: 20000 },
  async () => {
    let added = false;
    let captured = false;
    const copy = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: copy },
      configurable: true,
    });
    global.fetch = vi.fn(async (path, init = {}) => {
      let data;
      switch (path.split("?")[0]) {
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
    // The router scrolls a hash's element into view; jsdom has no
    // scrolling.
    Element.prototype.scrollIntoView ??= () => {};
    window.history.pushState(
      {},
      "",
      "/console/account/tracking#add-player-tag",
    );
    render(<App />);

    // On the field it came for, ready to type in. The first paint loads
    // the Settings chunk cold; on a loaded machine that outlasted the 5 s
    // wait with nothing drawn yet (2026-11-12), so this first wait is longer.
    const input = await waitFor(
      () => {
        const el = document.getElementById("add-player-tag");
        expect(document.activeElement).toBe(el);
        return el;
      },
      { timeout: 15000 },
    );
    fireEvent.change(input, { target: { value: player.player_tag } });
    fireEvent.click(input.closest("form").querySelector("button"));

    await waitFor(() =>
      expect(window.location.pathname).toBe("/settings/players/2PP0V90Y"),
    );
    cleanup();
    captured = true;
    window.history.pushState({}, "", "/console/account/connections");
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Copy question: Start with your latest profile",
      }),
    );
    await screen.findByText("Copied. Paste into your connected client.");
    expect(copy.mock.calls[0][0]).toContain(player.player_tag);
  },
);

test(
  "no player: Home gives the steps, starting with your tag, and asks nothing",
  { timeout: 20000 },
  async () => {
    global.fetch = vi.fn(async (path) => {
      const data =
        path === "/api/me"
          ? { authenticated: true, role: "member", claims: [], recordings: [] }
          : path === "/api/me/home"
            ? { first: { ok: true, player: null, connection } }
            : { clans: [] };
      return { ok: true, text: async () => JSON.stringify(data) };
    });
    window.history.pushState({}, "", "/home");
    render(<App />);
    expect(await screen.findByText("Welcome to Elixir")).toBeTruthy();
    expect(await screen.findByText("Add your player")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Copy question/ })).toBeNull();
  },
);

test("readiness names what each line is waiting for, not just that it is not done", async () => {
  respond();
  render(<FirstAnswer claimsKey="a" />);
  await screen.findByText("Player tag saved");
  expect(screen.getByText("no profile read yet")).toBeTruthy();
  expect(
    screen.getByText(
      "No battles recorded in the last 30 days · some may not have been read",
    ),
  ).toBeTruthy();
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
  await screen.findByRole("link", {
    name: /Open the player page/,
  });
  // A bare "1,284" is a claim; the window makes it a fact.
  expect(
    screen.getByText("1,284 in the last 30 days · 38 in the last 7"),
  ).toBeTruthy();
  expect(screen.getByText("read 4m ago")).toBeTruthy();
});

test("a browser-only profile opens the saved profile", async () => {
  respond({ ...player, profile_available: true });
  render(<FirstAnswer claimsKey="a" />);
  await screen.findByRole("link", {
    name: /Open the player page|View recorded profile/,
  });
  expect(screen.getByText("read, at a time Elixir did not keep")).toBeTruthy();
  expect(screen.queryByText("snapshot never")).toBeNull();
  expect(screen.queryByText(/\d of 6/)).toBeNull();
});

test("Verify is a step after battles, linking to Verify", async () => {
  respond({ ...player, is_primary: true, verified: false, verified_at: null });
  render(<FirstAnswer claimsKey="a" />);
  const label = await screen.findByText(
    "Player verified (needed to act in Clan)",
  );
  const link = screen.getByRole("link", { name: "Verify your player ›" });
  expect(link.getAttribute("href")).toBe("/settings/players/verify");
  // In the record's own steps: after Battles on record.
  const order = [
    "Battles on record",
    "Player verified (needed to act in Clan)",
  ].map((t) => screen.getByText(t));
  for (let i = 1; i < order.length; i++)
    expect(
      order[i - 1].compareDocumentPosition(order[i]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  expect(label.closest("details")).toBeNull();
  // One read: the checklist asked first-answer and nothing else.
  expect(
    global.fetch.mock.calls.every(([u]) =>
      String(u).startsWith("/api/me/first-answer"),
    ),
  ).toBe(true);
});

test("a verified player's step is done; a friend has no Verify step", async () => {
  respond({
    ...player,
    is_primary: true,
    verified: true,
    verified_at: "2026-09-08T22:00:00Z",
  });
  render(<FirstAnswer claimsKey="a" />);
  expect(
    await screen.findByText("Player verified (needed to act in Clan)"),
  ).toBeTruthy();
  expect(
    screen.queryByRole("link", { name: "Verify your player ›" }),
  ).toBeNull();
  cleanup();
  respond({ ...player, is_primary: false, relationship: "friend" });
  render(<FirstAnswer claimsKey="b" />);
  await screen.findByText("Battles on record");
  expect(
    screen.queryByText("Player verified (needed to act in Clan)"),
  ).toBeNull();
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
    screen
      .getByRole("link", {
        name: /Open the player page|View recorded profile/,
      })
      .getAttribute("href"),
  ).toBe("/home/player/2PP0V90Y");
  expect(
    screen.getByRole("link", { name: /Manage recording/ }).getAttribute("href"),
  ).toBe("/settings/players");
  expect(screen.queryByText(/Waiting for the first/)).toBeNull();
});

test("paused recording without capture points to status instead of promising the next poll", async () => {
  respond({ ...player, recording_status: "paused" });
  render(<FirstAnswer claimsKey="a" />);
  await screen.findByText(/recording paused/);
  expect(screen.queryByText(/Waiting for the first/)).toBeNull();
  expect(
    screen.queryByRole("link", {
      name: /Open the player page|View recorded profile/,
    }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: /Copy question/ })).toBeNull();
});

test("partial capture is unavailable rather than an invented zero", async () => {
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
  expect(
    screen.getByRole("link", {
      name: /Open the player page|View recorded profile/,
    }),
  ).toBeTruthy();
  expect(screen.queryByText(/0 in the last 30 days/)).toBeNull();
});

test("a failed readiness request explains itself and can retry", async () => {
  global.fetch = vi.fn().mockRejectedValue(new Error("offline"));
  render(<FirstAnswer claimsKey="a" />);
  await screen.findByText(/Could not check your recorded data/);
  respond();
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await screen.findByText("Player tag saved");
});

test("waiting capture can be worked around, then refreshes into a profile-only question", async () => {
  const navigate = vi.fn();
  render(<ConnectionQuestions claimsKey="a" navigate={navigate} />);
  await screen.findByText(/Waiting for the first read/);
  expect(screen.queryByRole("button", { name: /Copy question/ })).toBeNull();
  respond({
    ...player,
    profile_available: true,
    profile_observed_at: "2026-09-08T20:00:00Z",
  });
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await screen.findByText("Start with your latest profile");
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
  await screen.findByText("Copied. Paste into your connected client.");
  expect(copy.mock.calls[0][0]).toContain("#2PP0V90Y");
  expect(copy.mock.calls[0][0]).toContain("how much of this was recorded");
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
  expect(screen.queryByText(/Waiting for the first read/)).toBeNull();
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
    expect(screen.queryByText(/Waiting for the first read/)).toBeNull(),
  );
});

// 2026-10-08: "Tag not found" took up to a minute to show after an add,
// because the status was read once a minute. The first minutes after an
// add are read every few seconds.
test("the status is read every few seconds just after an add, then once a minute", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  const at = (s) => new Date(now - s * 1000).toISOString();
  const waiting = (p) => ({
    as_of: new Date(now).toISOString(),
    player: {
      player_tag: "#2PP0V90Y",
      recording_status: "active",
      profile_available: false,
      battles_30d: 0,
      last_battle_at: null,
      ...p,
    },
    connection: {},
  });
  expect(nextPoll(waiting({ tracked_since: at(10) }), { now })).toBe(
    FAST_POLL_MS,
  );
  expect(nextPoll(waiting({ tracked_since: at(170) }), { now })).toBe(
    FAST_POLL_MS,
  );
  expect(nextPoll(waiting({ tracked_since: at(200) }), { now })).toBe(
    SLOW_POLL_MS,
  );
  // A status from before tracked_since existed: once a minute.
  expect(nextPoll(waiting({}), { now })).toBe(SLOW_POLL_MS);
  // The game said "not found": that is the answer for a day.
  expect(
    nextPoll(
      waiting({
        tracked_since: at(10),
        capture_attempts: [
          {
            endpoint: "player",
            last_failed_at: at(5),
            last_failed_status: 404,
          },
        ],
      }),
      { now },
    ),
  ).toBe(SLOW_POLL_MS);
  // Captured: the profile and the player's own battle log are in.
  expect(
    nextPoll(
      waiting({
        tracked_since: at(10),
        profile_available: true,
        battlelog_observed_at: at(5),
        battles_30d: 30,
        last_battle_at: at(600),
      }),
      { now },
    ),
  ).toBe(null);
  // A tag already on record as an opponent (2026-11-09): its battle came from
  // someone else's log, so the wait goes on until its own log is read.
  expect(
    nextPoll(
      waiting({
        tracked_since: at(10),
        profile_available: true,
        battles_30d: 1,
        last_battle_at: at(600),
      }),
      { now },
    ),
  ).toBe(FAST_POLL_MS);
});
