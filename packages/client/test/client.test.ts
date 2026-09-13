import { test, expect, vi } from "vitest";
import {
  ApiError,
  createClient,
  createQueryClient,
  routeLabel,
  transportFailed,
  unwrap,
} from "../src/index.ts";

function response(
  status: number,
  text: string,
  headers: Record<string, string> = {},
) {
  return {
    ok: status < 400,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => text,
  } as unknown as Response;
}

test("a JSON answer is the envelope, ok by status, with the contract headers sent", async () => {
  const fetch = vi.fn(async () => response(200, '{"a":1}'));
  vi.stubGlobal("fetch", fetch);
  const client = createClient({ headers: { "x-elixir-client": "web" } });
  const r = await client.post("/api/x", { b: 2 });
  expect(r).toEqual({ ok: true, status: 200, data: { a: 1 } });
  const init = (fetch.mock.calls as unknown as [string, RequestInit][])[0]![1];
  expect(init.method).toBe("POST");
  expect(init.credentials).toBe("same-origin");
  expect(init.headers).toMatchObject({
    accept: "application/json",
    "x-elixir-client": "web",
    "content-type": "application/json",
  });
  expect(init.body).toBe('{"b":2}');
  // A GET carries no content-type and no body.
  await client.get("/api/y");
  const get = (fetch.mock.calls as unknown as [string, RequestInit][])[1]![1];
  expect(get.method).toBe("GET");
  expect(get.body).toBeUndefined();
  expect(
    (get.headers as Record<string, string>)["content-type"],
  ).toBeUndefined();
  vi.unstubAllGlobals();
});

test("a refused request is an envelope, not a throw: status and body readable", async () => {
  vi.stubGlobal("fetch", async () => response(403, '{"error":"forbidden"}'));
  const r = await createClient().get("/api/x");
  expect(r).toEqual({ ok: false, status: 403, data: { error: "forbidden" } });
  expect(transportFailed(r)).toBe(false);
  vi.unstubAllGlobals();
});

test("a body that is not JSON is bad_response whatever its status: it was produced in front of the API", async () => {
  const onEvent = vi.fn();
  vi.stubGlobal("fetch", async () => response(502, "<html>edge</html>"));
  const r = await createClient({ onEvent }).get("/api/x?id=1");
  expect(r).toEqual({
    ok: false,
    status: 502,
    data: {},
    error: "bad_response",
  });
  expect(transportFailed(r)).toBe(true);
  // The edge's status is the evidence; the label keeps it.
  expect(onEvent).toHaveBeenCalledWith("api_bad_response", "502 GET /api/x");
  vi.unstubAllGlobals();
});

test("a timeout and a network failure are named, counted, and status 0", async () => {
  const onEvent = vi.fn();
  const onSlow = vi.fn();
  vi.stubGlobal("fetch", async () => {
    throw Object.assign(new Error("t"), { name: "TimeoutError" });
  });
  const client = createClient({ onEvent, onSlow });
  expect(await client.get("/api/x")).toEqual({
    ok: false,
    status: 0,
    data: {},
    error: "timeout",
  });
  expect(onEvent).toHaveBeenCalledWith("api_timeout", "GET /api/x");
  expect(onSlow).toHaveBeenCalledWith(
    expect.objectContaining({
      request: "GET /api/x",
      status: 0,
      error: "timeout",
    }),
  );
  vi.stubGlobal("fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  expect((await client.get("/api/x")).error).toBe("network");
  expect(onEvent).toHaveBeenCalledWith("api_network", "GET /api/x");
  vi.unstubAllGlobals();
});

test("a slow answer is reported with the server's own timing beside the wall clock", async () => {
  const onEvent = vi.fn();
  const onSlow = vi.fn();
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => (now += 2000));
  vi.stubGlobal("fetch", async () =>
    response(200, "{}", { "server-timing": "app;dur=1800" }),
  );
  await createClient({ onEvent, onSlow, slowMs: 1000 }).get("/api/x");
  expect(onEvent).toHaveBeenCalledWith("api_slow", "GET /api/x");
  expect(onSlow).toHaveBeenCalledWith({
    request: "GET /api/x",
    wall_ms: 2000,
    status: 200,
    server_timing: "app;dur=1800",
  });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("unwrap returns data or throws an ApiError that keeps status, body and transport", () => {
  expect(unwrap({ ok: true, status: 200, data: { x: 1 } })).toEqual({ x: 1 });
  const refused = () =>
    unwrap({ ok: false, status: 401, data: { message: "Sign in first" } });
  expect(refused).toThrow(ApiError);
  expect(refused).toThrow("Sign in first");
  try {
    unwrap({ ok: false, status: 0, data: {}, error: "network" });
  } catch (err) {
    const e = err as ApiError;
    expect(e.status).toBe(0);
    expect(e.transport).toBe("network");
    expect(e.message).toBe("network");
    expect(transportFailed(e)).toBe(true);
  }
  expect(
    transportFailed(new ApiError({ ok: false, status: 503, data: {} })),
  ).toBe(true);
  expect(
    transportFailed(new ApiError({ ok: false, status: 404, data: {} })),
  ).toBe(false);
  expect(transportFailed(new Error("x"))).toBe(false);
});

test("the query client retries once, only when the API never answered", () => {
  const retry = createQueryClient().getDefaultOptions().queries!.retry as (
    n: number,
    e: unknown,
  ) => boolean;
  const never = new ApiError({
    ok: false,
    status: 0,
    data: {},
    error: "timeout",
  });
  const refused = new ApiError({ ok: false, status: 401, data: {} });
  expect(retry(0, never)).toBe(true);
  expect(retry(1, never)).toBe(false);
  expect(retry(0, refused)).toBe(false);
});

test("routeLabel is the route, never the record", () => {
  expect(routeLabel("GET", "/api/me/usage?days=14")).toBe("GET /api/me/usage");
  expect(routeLabel("GET", "/api/admin/calls/abc-123")).toBe(
    "GET /api/admin/calls/*",
  );
  expect(routeLabel("POST", "/api/claims")).toBe("POST /api/claims");
});

test("a surface can name its own routes, so a tag in the path never reaches an event", async () => {
  const onEvent = vi.fn();
  vi.stubGlobal("fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  await createClient({
    onEvent,
    routeLabel: (m, p) => `${m} ${p.replace(/\/clans\/[^/]+/, "/clans/*")}`,
  }).get("/api/clans/J2RGCRVG/manage");
  expect(onEvent).toHaveBeenCalledWith(
    "api_network",
    "GET /api/clans/*/manage",
  );
  vi.unstubAllGlobals();
});
