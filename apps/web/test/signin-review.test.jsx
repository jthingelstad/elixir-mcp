/**
 * The sign-in review of 2026-09-12: the four things the console did that
 * made a person sign in more than they should have.
 *
 * 1. A transport failure on /api/me rendered the sign-in wall. The
 *    session was fine, the wall said otherwise, and a second session was
 *    minted beside the first (the census: seven in a day, none expired).
 * 2. The screen that asked for the email never learned the link had been
 *    opened elsewhere.
 * 3. A link opened from a different address than the one that asked is
 *    now asked whether to sign that screen in too.
 * 4. The sixth email in an hour was silently not sent.
 *
 * And the fifth thing, asked for the same day: the device list.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { App } from "../src/App.jsx";
import { SignIn } from "../src/views/SignIn.jsx";
import { Profile } from "../src/views/account/Profile.jsx";

function mockFetch(routes) {
  return vi.fn(async (path, init = {}) => {
    const key = `${init.method ?? "GET"} ${path}`;
    const route = routes[key];
    if (!route) throw new Error(`unmocked fetch: ${key}`);
    const answer = typeof route === "function" ? route(init) : route;
    if (answer instanceof Error) throw answer;
    const [status, body] = answer;
    return {
      ok: status < 400,
      status,
      json: async () => body,
      text: async () =>
        typeof body === "string" ? body : JSON.stringify(body),
    };
  });
}

beforeEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("a transport failure on /api/me is 'Elixir didn't answer', retried once, never the sign-in wall", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  window.history.pushState({}, "", "/account/overview");
  let calls = 0;
  const err = new TypeError("Failed to fetch");
  global.fetch = mockFetch({
    "GET /api/me": () => {
      calls += 1;
      return err;
    },
  });
  render(<App />);
  // The quiet retry sits 1.5 s after the first failure.
  await vi.advanceTimersByTimeAsync(1600);
  expect(await screen.findByText("Elixir didn’t answer")).toBeTruthy();
  expect(calls).toBe(2);
  expect(screen.queryByText("Sign in first")).toBeNull();
  expect(screen.getByText(/You are not signed out/)).toBeTruthy();
});

test("an edge error page on /api/me is the same answer, and Try again recovers", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  window.history.pushState({}, "", "/account/overview");
  let answers = 0;
  global.fetch = mockFetch({
    "GET /api/me": () => {
      answers += 1;
      return answers <= 2
        ? [503, "<html>Service Unavailable</html>"]
        : [200, { authenticated: true, claims: [], recordings: [] }];
    },
    "GET /api/me/first-answer": [200, {}],
    "GET /api/me/activity": [200, { events: [] }],
    "GET /api/me/events": [200, { events: [] }],
    "GET /api/me/usage": [200, {}],
    "GET /api/me/connections": [200, { connections: [] }],
    "GET /api/me/clans": [200, { clans: [] }],
  });
  render(<App />);
  await vi.advanceTimersByTimeAsync(1600);
  expect(await screen.findByText("Elixir didn’t answer")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() =>
    expect(screen.queryByText("Elixir didn’t answer")).toBeNull(),
  );
  expect(screen.queryByText("Sign in first")).toBeNull();
});

test("the code step polls and signs in when the link was opened elsewhere", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let polls = 0;
  global.fetch = mockFetch({
    "POST /api/auth": [200, { ok: true, poll_id: "p".repeat(40) }],
    "POST /api/auth/poll": (init) => {
      expect(JSON.parse(init.body)).toEqual({ poll_id: "p".repeat(40) });
      polls += 1;
      return polls < 2
        ? [200, { ready: false }]
        : [200, { authenticated: true, ready: true }];
    },
  });
  const onAuthed = vi.fn();
  render(<SignIn onAuthed={onAuthed} />);
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "j@x.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in email" }));
  await screen.findByLabelText("6-digit code");
  expect(screen.getByText(/signs this screen in too/)).toBeTruthy();
  await vi.advanceTimersByTimeAsync(4100);
  expect(polls).toBe(1);
  expect(onAuthed).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(4100);
  await waitFor(() => expect(onAuthed).toHaveBeenCalled());
});

test("the sixth email in an hour says so, on the code step, without saying whether the account exists", async () => {
  global.fetch = mockFetch({
    "POST /api/auth": [
      200,
      {
        ok: true,
        limited: true,
        poll_id: "p".repeat(40),
        message: "That is the limit on sign-in emails for now.",
      },
    ],
  });
  render(<SignIn onAuthed={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "j@x.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in email" }));
  await screen.findByLabelText("6-digit code");
  expect(screen.getByText(/limit on sign-in emails/)).toBeTruthy();
  expect(screen.queryByText(/one is on its way/)).toBeNull();
});

test("a link opened from elsewhere asks before signing in the screen that started", async () => {
  vi.resetModules();
  const { SignIn: Fresh } = await import("../src/views/SignIn.jsx");
  window.history.pushState({}, "", "/signin?login_token=" + "t".repeat(40));
  const confirmed = [];
  global.fetch = mockFetch({
    "POST /api/auth/redeem": [
      200,
      {
        authenticated: true,
        handoff: {
          state: "confirm",
          confirm: "c".repeat(40),
          started: {
            at: "2026-09-12T20:00:00Z",
            country: "US",
            client: "Chrome on Mac",
          },
        },
      },
    ],
    "POST /api/auth/handoff": (init) => {
      confirmed.push(JSON.parse(init.body));
      return [200, { ok: true }];
    },
  });
  const onAuthed = vi.fn();
  render(<Fresh onAuthed={onAuthed} />);
  expect(
    await screen.findByText("Also sign in where you started?"),
  ).toBeTruthy();
  expect(screen.getByText(/Chrome on Mac, US/)).toBeTruthy();
  expect(onAuthed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Yes, that was me" }));
  await waitFor(() => expect(onAuthed).toHaveBeenCalled());
  expect(confirmed).toEqual([{ confirm: "c".repeat(40) }]);
});

test("a link opened from the same address just signs in", async () => {
  vi.resetModules();
  const { SignIn: Fresh } = await import("../src/views/SignIn.jsx");
  window.history.pushState({}, "", "/signin?login_token=" + "u".repeat(40));
  global.fetch = mockFetch({
    "POST /api/auth/redeem": [
      200,
      { authenticated: true, handoff: { state: "done" } },
    ],
  });
  const onAuthed = vi.fn();
  render(<Fresh onAuthed={onAuthed} />);
  await waitFor(() => expect(onAuthed).toHaveBeenCalled());
  expect(screen.queryByText("Also sign in where you started?")).toBeNull();
});

test("Profile lists every device, marks this one, and signs the others out", async () => {
  const revoked = [];
  let sessions = [
    {
      id: "here",
      current: true,
      client: "Chrome on Mac",
      from: "198.51.100.10",
      country: "US",
      created_at: "2026-09-10T00:00:00Z",
      last_seen_at: "2026-09-12T20:00:00Z",
      expires_at: "2026-10-12T20:00:00Z",
    },
    {
      id: "phone",
      current: false,
      client: "Safari on iPhone",
      from: "198.51.100.77",
      country: "CA",
      created_at: "2026-09-11T00:00:00Z",
      last_seen_at: "2026-09-12T19:00:00Z",
      expires_at: "2026-10-12T19:00:00Z",
    },
  ];
  global.fetch = mockFetch({
    "GET /api/me/usage": [200, {}],
    "GET /api/me/sessions": () => [200, { sessions }],
    "POST /api/me/sessions/revoke": (init) => {
      const body = JSON.parse(init.body);
      revoked.push(body);
      sessions = sessions.filter((s) => s.current);
      return [200, { ok: true, revoked: 1 }];
    },
  });
  render(
    <Profile me={{ email: "j@x.com" }} refresh={vi.fn()} navigate={vi.fn()} />,
  );
  expect(await screen.findByText("Safari on iPhone")).toBeTruthy();
  expect(screen.getByText("this device")).toBeTruthy();
  expect(screen.getByText(/198\.51\.100\.77 · CA/)).toBeTruthy();
  // This device has no per-row sign-out; the rail's button does that.
  expect(screen.getAllByRole("button", { name: "Sign out" })).toHaveLength(1);
  fireEvent.click(
    screen.getByRole("button", { name: "Sign out everywhere else" }),
  );
  await waitFor(() =>
    expect(screen.queryByText("Safari on iPhone")).toBeNull(),
  );
  expect(revoked).toEqual([{ everywhere: true }]);
  expect(
    screen.queryByRole("button", { name: "Sign out everywhere else" }),
  ).toBeNull();
});
