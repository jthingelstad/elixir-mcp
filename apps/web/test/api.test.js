/**
 * A request that never gets an answer is a failure the view can act on
 * and one the collector hears about — not a hang.
 *
 * @vitest-environment-options { "url": "https://elixir.poapkings.com/" }
 */
import { describe, test, expect, afterEach, vi } from "vitest";
import { api } from "../src/api.js";

const events = [];
document.addEventListener("click", (ev) => {
  const node = ev.target.closest?.("[data-tinylytics-event]");
  if (node)
    events.push([
      node.getAttribute("data-tinylytics-event"),
      node.getAttribute("data-tinylytics-event-value"),
    ]);
});

afterEach(() => {
  events.length = 0;
  vi.unstubAllGlobals();
});

describe("request failures", () => {
  test("a timed-out fetch answers timeout and reports the route", async () => {
    vi.stubGlobal("fetch", async (_path, { signal }) => {
      await new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason)),
      );
    });
    vi.stubGlobal("AbortSignal", {
      timeout: () => {
        const c = new AbortController();
        const reason = new DOMException("aborted", "TimeoutError");
        setTimeout(() => c.abort(reason), 5);
        return c.signal;
      },
    });
    const res = await api.me();
    expect(res).toEqual({ ok: false, status: 0, data: {}, error: "timeout" });
    expect(events).toEqual([["web.api_timeout", "GET /api/me"]]);
  });

  test("a fetch the network refuses answers network, not a throw", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    const res = await api.usage();
    expect(res.error).toBe("network");
    expect(events).toEqual([["web.api_network", "GET /api/me/usage"]]);
  });

  test("an edge error page is a bad_response carrying its status", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 502,
      text: async () => "<html>Bad Gateway</html>",
    }));
    const res = await api.me();
    expect(res.error).toBe("bad_response");
    expect(events).toEqual([["web.api_bad_response", "502 GET /api/me"]]);
  });
});
