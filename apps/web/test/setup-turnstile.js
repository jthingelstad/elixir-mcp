/**
 * Every test page has a Turnstile that answers at once, as Cloudflare's
 * script would on a person's browser; jsdom never loads the real one.
 * test/turnstile.test.jsx takes it away to test the waits and failures.
 */
import { beforeEach } from "vitest";

beforeEach(() => {
  // Server-render tests run without a window, and load no script anyway.
  if (typeof window === "undefined") return;
  window.turnstile = {
    render: (_el, options) => {
      queueMicrotask(() => options.callback("test-turnstile-token"));
      return "test-widget";
    },
    reset: () => {},
    remove: () => {},
  };
});
