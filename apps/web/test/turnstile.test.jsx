/**
 * Turnstile on the sign-in form (src/turnstile.js): Cloudflare's script
 * loads on the email field's first touch, a send waits briefly for its
 * token and goes without one when Cloudflare cannot be had, and a resend
 * to the same address reuses the token inside the relay's allowance.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { SignIn } from "../src/views/SignIn.jsx";
import {
  makeTurnstile,
  resetTurnstileScript,
  TURNSTILE_REFUSED,
  TURNSTILE_RETRY_INTERVAL_MS,
  TURNSTILE_SCRIPT_URL,
  TURNSTILE_SITE_KEY,
} from "../src/turnstile.js";

/** A page whose script tags we load (or fail) by hand, and a Turnstile
 *  whose answers we give by hand. */
function fakePage() {
  const scripts = [];
  const win = {};
  const doc = {
    createElement: () => ({}),
    head: { appendChild: (s) => scripts.push(s) },
  };
  const widgets = [];
  const api = {
    render: vi.fn((el, options) => {
      widgets.push({ el, options });
      return `w${widgets.length}`;
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  const load = () => {
    win.turnstile = api;
    win.elixirTurnstileReady();
  };
  const last = () => widgets.at(-1).options;
  return { scripts, win, doc, api, widgets, load, last };
}

let clock;
beforeEach(() => {
  resetTurnstileScript();
  clock = 1_000_000;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

function setup(page, slot = { isConnected: true }) {
  const box = { slot };
  const ts = makeTurnstile({
    slot: () => box.slot,
    win: page.win,
    doc: page.doc,
    now: () => clock,
  });
  return { ts, box };
}

test("the script loads only when warmed, once, explicitly rendered and shown only for a challenge", async () => {
  const page = fakePage();
  const { ts } = setup(page);
  expect(page.scripts).toEqual([]);
  ts.warm();
  ts.warm();
  expect(page.scripts.map((s) => s.src)).toEqual([TURNSTILE_SCRIPT_URL]);
  expect(TURNSTILE_SCRIPT_URL).toBe(
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=elixirTurnstileReady",
  );
  page.load();
  await Promise.resolve();
  expect(page.api.render).toHaveBeenCalledOnce();
  expect(page.last()).toMatchObject({
    sitekey: TURNSTILE_SITE_KEY,
    action: "signin",
    appearance: "interaction-only",
    // Cloudflare retries an error inside the five-second wait.
    retry: "auto",
    "retry-interval": 2_000,
  });
  expect(TURNSTILE_RETRY_INTERVAL_MS).toBeLessThan(5_000);
  page.last().callback("tok-1");
  expect(await ts.tokenFor("a@x.com")).toBe("tok-1");
});

test("the site key is the server's, and so are the action the relay checks and the refused sentence", () => {
  const server = readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../packages/auth/src/turnstile.mjs",
    ),
    "utf8",
  );
  expect(server).toContain(
    `TURNSTILE_SITE_KEY = ${JSON.stringify(TURNSTILE_SITE_KEY)}`,
  );
  expect(server).toContain(
    `TURNSTILE_RETRY_INTERVAL_MS = ${TURNSTILE_RETRY_INTERVAL_MS};`,
  );
  expect(server).toMatch(
    /TURNSTILE_ACTIONS = Object\.freeze\(\{\s+web: "signin",/,
  );
  // The refused sentence, word for word and with its curly apostrophes.
  expect(server).toContain(
    `TURNSTILE_REFUSED_MESSAGE =\n  ${JSON.stringify(TURNSTILE_REFUSED)};`,
  );
  expect(TURNSTILE_REFUSED).toBe(
    "We couldn\u2019t confirm you\u2019re not a bot. Reload the page and try again.",
  );
});

test("a resend to the same address reuses its token for three sends and 270 seconds; anything else asks for a fresh one", async () => {
  const page = fakePage();
  const { ts } = setup(page);
  ts.warm();
  page.load();
  await Promise.resolve();
  page.last().callback("tok-1");
  expect(await ts.tokenFor("A@x.com")).toBe("tok-1");
  expect(await ts.tokenFor(" a@x.com ")).toBe("tok-1");
  expect(await ts.tokenFor("a@x.com")).toBe("tok-1");
  expect(page.api.reset).not.toHaveBeenCalled();

  // A fourth send: the widget is reset and its next token sent.
  const fourth = ts.tokenFor("a@x.com");
  await Promise.resolve();
  expect(page.api.reset).toHaveBeenCalledWith("w1");
  page.last().callback("tok-2");
  expect(await fourth).toBe("tok-2");

  // Another address never rides a spent token.
  const other = ts.tokenFor("b@x.com");
  await Promise.resolve();
  expect(page.api.reset).toHaveBeenCalledTimes(2);
  page.last().callback("tok-3");
  expect(await other).toBe("tok-3");

  // Too old to reuse.
  clock += 270_000;
  const late = ts.tokenFor("b@x.com");
  await Promise.resolve();
  page.last().callback("tok-4");
  expect(await late).toBe("tok-4");
});

test("when Cloudflare's script cannot load, the send goes at once without a token, and says why", async () => {
  const page = fakePage();
  const { ts } = setup(page);
  ts.warm();
  page.scripts[0].onerror();
  expect(await ts.fieldsFor("a@x.com")).toEqual({
    token: "",
    waitedMs: 0,
    reason: "script-blocked",
  });
});

test("a script that loads without the API is script-empty", async () => {
  const page = fakePage();
  const { ts } = setup(page);
  ts.warm();
  page.win.elixirTurnstileReady();
  expect((await ts.fieldsFor("a@x.com")).reason).toBe("script-empty");
});

test("a token says how long it took and gives no reason; a reused one waited nothing", async () => {
  vi.useFakeTimers();
  const page = fakePage();
  const ts = makeTurnstile({
    slot: () => ({ isConnected: true }),
    win: page.win,
    doc: page.doc,
  });
  ts.warm();
  page.load();
  await vi.advanceTimersByTimeAsync(0);
  let got = null;
  ts.fieldsFor("a@x.com").then((f) => (got = f));
  await vi.advanceTimersByTimeAsync(1_200);
  page.last().callback("tok-1");
  await vi.advanceTimersByTimeAsync(0);
  expect(got).toEqual({ token: "tok-1", waitedMs: 1_200 });
  expect(await ts.fieldsFor("a@x.com")).toEqual({
    token: "tok-1",
    waitedMs: 0,
  });
});

test("a wait that runs out names what it was waiting on", async () => {
  vi.useFakeTimers();
  const page = fakePage();
  const make = () =>
    makeTurnstile({
      slot: () => ({ isConnected: true }),
      win: page.win,
      doc: page.doc,
    });
  // The script never answered.
  let ts = make();
  let got = null;
  ts.fieldsFor("a@x.com").then((f) => (got = f));
  await vi.advanceTimersByTimeAsync(5_000);
  expect(got).toEqual({
    token: "",
    waitedMs: 5_000,
    reason: "loading-timeout",
  });
  // Drawn, but no answer.
  page.load();
  ts = make();
  ts.warm();
  await vi.advanceTimersByTimeAsync(0);
  got = null;
  ts.fieldsFor("a@x.com").then((f) => (got = f));
  await vi.advanceTimersByTimeAsync(5_000);
  expect(got.reason).toBe("solving-timeout");
  // A box nobody answered.
  ts = make();
  ts.warm();
  await vi.advanceTimersByTimeAsync(0);
  got = null;
  ts.fieldsFor("a@x.com").then((f) => (got = f));
  page.last()["before-interactive-callback"]();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(got).toEqual({
    token: "",
    waitedMs: 120_000,
    reason: "interactive-timeout",
  });
});

test("a script that never answers costs five seconds; a challenge on screen is waited for", async () => {
  vi.useFakeTimers();
  const page = fakePage();
  const { ts } = setup(page);
  let got = null;
  ts.tokenFor("a@x.com").then((t) => (got = t));
  await vi.advanceTimersByTimeAsync(4_999);
  expect(got).toBe(null);
  await vi.advanceTimersByTimeAsync(1);
  expect(got).toBe("");

  page.load();
  got = null;
  ts.tokenFor("a@x.com").then((t) => (got = t));
  await vi.advanceTimersByTimeAsync(0);
  page.last()["before-interactive-callback"]();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(got).toBe(null);
  page.last().callback("answered");
  await vi.advanceTimersByTimeAsync(0);
  expect(got).toBe("answered");
});

test("an error Cloudflare never retries sends without a token at once, naming its code", async () => {
  const page = fakePage();
  const { ts } = setup(page);
  ts.warm();
  page.load();
  await Promise.resolve();
  // Domain not authorized: "Retry: No" in Cloudflare's table.
  expect(page.last()["error-callback"]("110200")).toBeUndefined();
  expect(await ts.fieldsFor("a@x.com")).toEqual({
    token: "",
    waitedMs: 0,
    reason: "error:110200",
  });
});

// Release Notes lost a real sign-in to a retryable 600010 this way: the
// first error was taken as final while Cloudflare was about to retry.
test("a retryable error leaves Cloudflare to retry inside the wait it already had", async () => {
  vi.useFakeTimers();
  const page = fakePage();
  const { ts } = setup(page);
  ts.warm();
  page.load();
  await vi.advanceTimersByTimeAsync(0);
  let got = null;
  ts.fieldsFor("a@x.com").then((f) => (got = f));
  await vi.advanceTimersByTimeAsync(1_000);
  // Returns nothing: Cloudflare keeps its own handling, retry included.
  expect(page.last()["error-callback"]("600010")).toBeUndefined();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(got).toBe(null);
  page.last().callback("after-retry");
  await vi.advanceTimersByTimeAsync(0);
  expect(got.token).toBe("after-retry");

  // No retry lands: the five seconds end where they always did, and the
  // send says which error it was.
  const next = makeTurnstile({
    slot: () => ({ isConnected: true }),
    win: page.win,
    doc: page.doc,
  });
  next.warm();
  await vi.advanceTimersByTimeAsync(0);
  got = null;
  next.fieldsFor("b@x.com").then((f) => (got = f));
  await vi.advanceTimersByTimeAsync(4_000);
  page.last()["error-callback"]("300030");
  await vi.advanceTimersByTimeAsync(999);
  expect(got).toBe(null);
  await vi.advanceTimersByTimeAsync(1);
  expect(got).toEqual({ token: "", waitedMs: 5_000, reason: "error:300030" });
});

test("a widget whose card left the page is rendered again in the current one", async () => {
  const page = fakePage();
  const first = { isConnected: true };
  const { ts, box } = setup(page, first);
  ts.warm();
  page.load();
  await Promise.resolve();
  page.last().callback("tok-1");
  expect(await ts.tokenFor("a@x.com")).toBe("tok-1");
  first.isConnected = false;
  const second = { isConnected: true };
  box.slot = second;
  const next = ts.tokenFor("b@x.com");
  await Promise.resolve();
  expect(page.api.remove).toHaveBeenCalledWith("w1");
  expect(page.widgets.at(-1).el).toBe(second);
  page.last().callback("tok-2");
  expect(await next).toBe("tok-2");
});

function replyWith(status, body) {
  const requests = [];
  global.fetch = vi.fn(async (path, init) => {
    if (path === "/api/auth") requests.push(JSON.parse(init.body));
    return {
      ok: status < 400,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
  return requests;
}

test("the form sends without a token when Cloudflare cannot be reached, and says why", async () => {
  delete window.turnstile;
  const appended = vi
    .spyOn(document.head, "appendChild")
    .mockImplementation((script) => {
      queueMicrotask(() => script.onerror?.());
      return script;
    });
  const requests = replyWith(200, { ok: true });
  render(<SignIn onAuthed={vi.fn()} />);
  const field = screen.getByLabelText("Email");
  fireEvent.focus(field);
  expect(appended.mock.calls[0][0].src).toBe(TURNSTILE_SCRIPT_URL);
  fireEvent.change(field, { target: { value: "a@x.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in email" }));
  await screen.findByLabelText("6-digit code");
  expect(requests).toHaveLength(1);
  expect(requests[0]).not.toHaveProperty("turnstile_token");
  expect(requests[0].turnstile_reason).toBe("script-blocked");
  expect(Number.isInteger(requests[0].turnstile_wait_ms)).toBe(true);
});

test("a send the server refuses for want of a token says so", async () => {
  const requests = replyWith(403, {
    error: "turnstile_failed",
    message: "server text",
  });
  render(<SignIn onAuthed={vi.fn()} />);
  const field = screen.getByLabelText("Email");
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "a@x.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in email" }));
  expect(await screen.findByText(TURNSTILE_REFUSED)).toBeTruthy();
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0].turnstile_token).toBe("test-turnstile-token");
  expect(requests[0]).not.toHaveProperty("turnstile_reason");
  expect(screen.queryByLabelText("6-digit code")).toBeNull();
});

// 2026-11-09, a production walk: Cloudflare's box went interactive and sat,
// visible above the button, while the form said only "Sending…" for 121.8 s.
test("a send says what it waits for: a check, Cloudflare's box, then nothing", async () => {
  vi.useFakeTimers();
  const page = fakePage();
  const said = [];
  const ts = makeTurnstile({
    slot: () => ({ isConnected: true }),
    onWait: (w) => said.push(w),
    win: page.win,
    doc: page.doc,
    now: () => clock,
  });
  ts.warm();
  page.load();
  await vi.advanceTimersByTimeAsync(0);
  let got = null;
  ts.tokenFor("a@x.com").then((t) => (got = t));
  page.last()["before-interactive-callback"]();
  page.last()["after-interactive-callback"]();
  page.last().callback("answered");
  await vi.advanceTimersByTimeAsync(0);
  expect(got).toBe("answered");
  expect(said).toEqual(["check", "challenge", "check", null]);
});

test("a box on screen keeps its two minutes, and a box that errors keeps them for Cloudflare's retry", async () => {
  vi.useFakeTimers();
  const page = fakePage();
  const { ts } = setup(page);
  ts.warm();
  page.load();
  await vi.advanceTimersByTimeAsync(0);
  let got = null;
  ts.tokenFor("a@x.com").then((t) => (got = t));
  page.last()["before-interactive-callback"]();
  await vi.advanceTimersByTimeAsync(119_999);
  expect(got).toBe(null);
  await vi.advanceTimersByTimeAsync(1);
  expect(got).toBe("");

  // Clicked, and Cloudflare's challenge host cannot be reached: 600010.
  const next = makeTurnstile({
    slot: () => ({ isConnected: true }),
    win: page.win,
    doc: page.doc,
    now: () => clock,
  });
  next.warm();
  await vi.advanceTimersByTimeAsync(0);
  got = null;
  next.tokenFor("a@x.com").then((t) => (got = t));
  page.last()["before-interactive-callback"]();
  await vi.advanceTimersByTimeAsync(3_000);
  page.last()["after-interactive-callback"]();
  page.last()["error-callback"]("600010");
  await vi.advanceTimersByTimeAsync(0);
  expect(got).toBe(null);
  // Cloudflare retries (eight seconds by default) and answers.
  await vi.advanceTimersByTimeAsync(8_000);
  page.last().callback("retried");
  await vi.advanceTimersByTimeAsync(0);
  expect(got).toBe("retried");
});

test("the form names Cloudflare's box while it waits on it, and sends once it is answered", async () => {
  let options;
  window.turnstile = {
    render: (_el, o) => {
      options = o;
      queueMicrotask(() => o["before-interactive-callback"]());
      return "w";
    },
    reset: () => {},
    remove: () => {},
  };
  const requests = replyWith(200, { ok: true });
  render(<SignIn onAuthed={vi.fn()} />);
  const field = screen.getByLabelText("Email");
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "a@x.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in email" }));
  expect(
    await screen.findByRole("button", { name: "Waiting for the check…" }),
  ).toBeTruthy();
  expect(screen.getByRole("status").textContent).toMatch(
    /Cloudflare is asking for one click.*Answer the box above/,
  );
  expect(screen.queryByText("Sending…")).toBeNull();
  options.callback("answered");
  await screen.findByLabelText("6-digit code");
  expect(requests).toHaveLength(1);
  expect(requests[0].turnstile_token).toBe("answered");
});

test("a box that errors for good sends without a token at once and says nothing more", async () => {
  let options;
  window.turnstile = {
    render: (_el, o) => {
      options = o;
      queueMicrotask(() => o["before-interactive-callback"]());
      return "w";
    },
    reset: () => {},
    remove: () => {},
  };
  const requests = replyWith(200, { ok: true });
  render(<SignIn onAuthed={vi.fn()} />);
  const field = screen.getByLabelText("Email");
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "a@x.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in email" }));
  await screen.findByRole("button", { name: "Waiting for the check…" });
  options["error-callback"]("110100");
  await screen.findByLabelText("6-digit code");
  expect(requests).toHaveLength(1);
  expect(requests[0]).not.toHaveProperty("turnstile_token");
  expect(requests[0].turnstile_reason).toBe("error:110100");
  expect(screen.queryByText(/Cloudflare is asking/)).toBeNull();
});
