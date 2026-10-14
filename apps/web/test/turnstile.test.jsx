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
  });
  page.last().callback("tok-1");
  expect(await ts.tokenFor("a@x.com")).toBe("tok-1");
});

test("the site key is the server's", () => {
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

test("when Cloudflare's script cannot load, the send goes at once without a token", async () => {
  const page = fakePage();
  const { ts } = setup(page);
  ts.warm();
  page.scripts[0].onerror();
  expect(await ts.tokenFor("a@x.com")).toBe("");
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

test("a Turnstile error sends without a token rather than waiting", async () => {
  const page = fakePage();
  const { ts } = setup(page);
  ts.warm();
  page.load();
  await Promise.resolve();
  page.last()["error-callback"]();
  expect(await ts.tokenFor("a@x.com")).toBe("");
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

test("the form sends without a token when Cloudflare cannot be reached", async () => {
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
  expect(
    await screen.findByText(/could not confirm a person asked for this email/),
  ).toBeTruthy();
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0].turnstile_token).toBe("test-turnstile-token");
  expect(screen.queryByLabelText("6-digit code")).toBeNull();
});
