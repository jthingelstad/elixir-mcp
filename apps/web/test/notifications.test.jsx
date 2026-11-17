/**
 * Web push in the app (2026-11-16): which case a device is in, that
 * permission is asked only inside the tap, what Settings › Notifications
 * shows for each case and for the account's devices, and the bell's one
 * prompt, put away for good on this device. A fake browser stands in for
 * the real one.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import {
  dismissPrompt,
  forgetOnSignOut,
  keyBytes,
  promptDismissed,
  pushSupport,
  thisDeviceLabel,
} from "../src/lib/push.js";
import { NotificationsPage } from "../src/views/account/NotificationsPage.jsx";
import { PushPrompt } from "../src/shell/PushPrompt.jsx";
import { useSignOut } from "../src/shell/sign-out.js";

const reply = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const KEY =
  "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** A fake browser: a user agent, a permission, a push manager. */
function browser({
  ua = CHROME_MAC,
  permission = "default",
  answer = "granted",
  standalone = false,
  subscribed = false,
  store = new Map(),
} = {}) {
  let sub = subscribed
    ? {
        endpoint: "https://fcm.googleapis.com/fcm/send/this-device",
        toJSON() {
          return { endpoint: this.endpoint, keys: { p256dh: "p", auth: "a" } };
        },
        unsubscribe: vi.fn(async () => {
          sub = null;
          return true;
        }),
      }
    : null;
  const pushManager = {
    getSubscription: vi.fn(async () => sub),
    subscribe: vi.fn(async () => {
      sub = {
        endpoint: "https://fcm.googleapis.com/fcm/send/new-device",
        toJSON() {
          return { endpoint: this.endpoint, keys: { p256dh: "p", auth: "a" } };
        },
        unsubscribe: async () => true,
      };
      return sub;
    }),
  };
  const reg = { pushManager };
  const Notification = {
    permission,
    requestPermission: vi.fn(async () => {
      Notification.permission = answer;
      return answer;
    }),
  };
  return {
    navigator: {
      userAgent: ua,
      maxTouchPoints: ua === IPHONE ? 5 : 0,
      standalone,
      serviceWorker: {
        getRegistration: vi.fn(async () => reg),
        register: vi.fn(async () => reg),
        ready: Promise.resolve(reg),
      },
    },
    PushManager: function PushManager() {},
    Notification,
    matchMedia: () => ({ matches: standalone }),
    localStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
    },
  };
}

let calls;
// Whether the server holds this browser's endpoint for the account signed
// in now (POST /api/me/push/this-device).
let registeredHere;
beforeEach(() => {
  cleanup();
  calls = [];
  registeredHere = true;
  global.fetch = vi.fn(async (path, init) => {
    calls.push([init?.method ?? "GET", String(path), init?.body ?? null]);
    if (String(path) === "/api/me/push/this-device")
      return reply({ registered: registeredHere });
    if (String(path) === "/api/session/signout") return reply({ ok: true });
    if (String(path) === "/api/me/push")
      return reply({
        offered: true,
        public_key: KEY,
        devices: [
          {
            id: "7",
            label: "Safari on iPhone",
            created_at: "2026-11-15T12:00:00Z",
            last_success_at: null,
          },
        ],
        kinds: {
          cheers: true,
          followers: false,
          clan_actions: true,
          answers: true,
        },
      });
    return reply({ devices: [] });
  });
});
afterEach(() => vi.restoreAllMocks());

test("a device's case: iOS outside the Home Screen installs, a blocked browser says so", () => {
  expect(pushSupport(browser({ ua: IPHONE }))).toBe("install");
  expect(pushSupport(browser({ ua: IPHONE, standalone: true }))).toBe(
    "on-ready",
  );
  expect(pushSupport(browser({ permission: "denied" }))).toBe("denied");
  expect(pushSupport({ navigator: { userAgent: CHROME_MAC } })).toBe(
    "unsupported",
  );
  expect(thisDeviceLabel(IPHONE)).toBe("Safari on iPhone");
  expect(thisDeviceLabel(CHROME_MAC)).toBe("Chrome on Mac");
  expect(keyBytes(KEY)).toHaveLength(65);
});

test("Notifications: permission is asked only on the tap, then this device is saved", async () => {
  const env = browser();
  renderWithProviders(<NotificationsPage env={env} />);
  const on = await screen.findByRole("button", {
    name: "Turn on notifications",
  });
  // Nothing was asked on load.
  expect(env.Notification.requestPermission).not.toHaveBeenCalled();
  expect(env.navigator.serviceWorker.register).not.toHaveBeenCalled();
  // The account's devices and switches, never an endpoint.
  expect(screen.getByText("Safari on iPhone")).toBeTruthy();
  expect(
    screen
      .getByRole("switch", { name: "New followers" })
      .getAttribute("aria-checked"),
  ).toBe("false");
  // The fifth kind (2026-11-17) is on until it is moved, here before the
  // account's kinds name it.
  expect(
    screen
      .getByRole("switch", { name: "Close friends' play" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  await waitFor(() => expect(on.disabled).toBe(false));
  fireEvent.click(on);
  await screen.findByText(/On for this device/);
  expect(env.Notification.requestPermission).toHaveBeenCalledTimes(1);
  const saved = calls.find(
    ([m, p]) => m === "POST" && p === "/api/me/push/subscriptions",
  );
  expect(JSON.parse(saved[2])).toEqual({
    subscription: {
      endpoint: "https://fcm.googleapis.com/fcm/send/new-device",
      keys: { p256dh: "p", auth: "a" },
    },
    label: "Chrome on Mac",
  });
});

test("Notifications: iOS in Safari is told to add Elixir to the Home Screen", async () => {
  renderWithProviders(<NotificationsPage env={browser({ ua: IPHONE })} />);
  expect(await screen.findByText(/Add to Home Screen/)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Turn on notifications" }),
  ).toBeNull();
});

test("Notifications: a device is removed, and a kind switched, by their own writes", async () => {
  renderWithProviders(
    <NotificationsPage env={browser({ subscribed: true })} />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Remove Safari on iPhone" }),
  );
  await waitFor(() =>
    expect(
      calls.some(
        ([m, p]) => m === "DELETE" && p === "/api/me/push/subscriptions/7",
      ),
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole("switch", { name: "Cheers on your play" }));
  await waitFor(() =>
    expect(
      calls.some(
        ([m, p, b]) =>
          m === "PUT" &&
          p === "/api/me/push/kinds" &&
          JSON.parse(b).kind === "cheers" &&
          JSON.parse(b).enabled === false,
      ),
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole("button", { name: "Turn off here" }));
  await waitFor(() =>
    expect(
      calls.some(([m, p]) => m === "POST" && p === "/api/me/push/off"),
    ).toBe(true),
  );
});

test("the bell's prompt: once, quiet, never asks itself, and put away stays away", async () => {
  const store = new Map();
  const env = browser({ store });
  const { unmount } = renderWithProviders(<PushPrompt env={env} />);
  expect(await screen.findByText(/cheer your play/)).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Turn on" }).getAttribute("href"),
  ).toBe("/settings/notifications");
  expect(env.Notification.requestPermission).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(screen.queryByText(/cheer your play/)).toBeNull();
  expect(promptDismissed(env)).toBe(true);
  unmount();
  renderWithProviders(<PushPrompt env={env} />);
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByText(/cheer your play/)).toBeNull();

  // A device already on, or one that cannot, is never prompted.
  cleanup();
  renderWithProviders(<PushPrompt env={browser({ subscribed: true })} />);
  renderWithProviders(<PushPrompt env={browser({ permission: "denied" })} />);
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByText(/cheer your play/)).toBeNull();
  // A storage that throws only brings the prompt back.
  const broken = {
    localStorage: {
      getItem: () => {
        throw new Error("x");
      },
      setItem: () => {
        throw new Error("x");
      },
    },
  };
  expect(promptDismissed(broken)).toBe(false);
  expect(() => dismissPrompt(broken)).not.toThrow();
});

test("Notifications: a subscription this account does not hold is not 'on', and the tap saves it again", async () => {
  // Removed in Your devices, or left by another account on this browser.
  registeredHere = false;
  const env = browser({ subscribed: true });
  renderWithProviders(<NotificationsPage env={env} />);
  const on = await screen.findByRole("button", {
    name: "Turn on notifications",
  });
  expect(screen.queryByText(/On for this device/)).toBeNull();
  const asked = calls.find(
    ([m, p]) => m === "POST" && p === "/api/me/push/this-device",
  );
  expect(JSON.parse(asked[2])).toEqual({
    endpoint: "https://fcm.googleapis.com/fcm/send/this-device",
  });
  await waitFor(() => expect(on.disabled).toBe(false));
  fireEvent.click(on);
  await screen.findByText(/On for this device/);
  // The browser's own subscription is saved for this account; no new one.
  expect(env.navigator.serviceWorker.getRegistration).toHaveBeenCalled();
  const saved = calls.find(
    ([m, p]) => m === "POST" && p === "/api/me/push/subscriptions",
  );
  expect(JSON.parse(saved[2]).subscription.endpoint).toBe(
    "https://fcm.googleapis.com/fcm/send/this-device",
  );
});

test("the bell's prompt: a subscription another account left here still prompts", async () => {
  registeredHere = false;
  renderWithProviders(<PushPrompt env={browser({ subscribed: true })} />);
  expect(await screen.findByText(/cheer your play/)).toBeTruthy();
});

test("sign out: this browser's notifications go with the account, before the session ends", async () => {
  const env = browser({ subscribed: true });
  const sub = await env.navigator.serviceWorker
    .getRegistration("/")
    .then((r) => r.pushManager.getSubscription());
  env.location = { assign: vi.fn() };
  const { result } = renderHook(() => useSignOut(env));
  await act(() => result.current.onClick());
  const order = calls.map(([m, p]) => `${m} ${p}`);
  const off = order.indexOf("POST /api/me/push/off");
  expect(off).toBeGreaterThanOrEqual(0);
  expect(off).toBeLessThan(order.indexOf("POST /api/session/signout"));
  expect(JSON.parse(calls[off][2])).toEqual({
    endpoint: "https://fcm.googleapis.com/fcm/send/this-device",
  });
  expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
  expect(env.location.assign).toHaveBeenCalledWith("/");
  // A browser with nothing on signs out with no push write, and a failed
  // push write never blocks the sign-out.
  await forgetOnSignOut(
    async () => {
      throw new Error("down");
    },
    browser({ subscribed: true }),
  );
});
