import type { Envelope, TransportError } from "./envelope.ts";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ClientOptions {
  /** Sent on every request. The console sends the contract header
   *  web-api requires as its CSRF marker on state changes. */
  headers?: Record<string, string>;
  /** Just past the API's own soft deadline (web-api answers 504 at
   *  ~18.5 s), so no request the server would have answered is cut
   *  short, and a stall in front of the edge fails here as a reported
   *  event instead of hanging the view. */
  timeoutMs?: number;
  /** A request that took this long is reported as `api_slow`. */
  slowMs?: number;
  /** Analytics hook: `(event, label)`; events are `api_timeout`,
   *  `api_network`, `api_bad_response`, `api_slow`. The surface
   *  prefixes them (`web.`, `clan.`). */
  onEvent?: (event: string, label: string) => void;
  /** Called for every slow or failed request with what only the
   *  browser knows: wall-clock ms beside the server's own timing. */
  onSlow?: (info: SlowRequest) => void;
  /** How a request is named in an event. The default collapses
   *  anything past three path segments; a surface whose routes carry a
   *  tag earlier than that (Elixir Clan's /api/clans/<tag>/...) passes
   *  its own, so no tag reaches the analytics. */
  routeLabel?: (method: string, path: string) => string;
}

export interface SlowRequest {
  request: string;
  wall_ms: number;
  status: number;
  server_timing: string | null;
  error?: TransportError;
}

export interface Client {
  request<T = unknown>(
    method: Method,
    path: string,
    body?: unknown,
  ): Promise<Envelope<T>>;
  get<T = unknown>(path: string): Promise<Envelope<T>>;
  post<T = unknown>(path: string, body?: unknown): Promise<Envelope<T>>;
}

/** The route key a failure reports: method and path with any id
 *  collapsed to `*`, so /api/admin/calls/<id> is one event, not one per
 *  record, and no tag or token ever reaches the analytics. */
export function routeLabel(method: string, path: string): string {
  const segments = (path.split("?")[0] ?? "").split("/").filter(Boolean);
  const head = segments.slice(0, 3).join("/");
  return `${method} /${head}${segments.length > 3 ? "/*" : ""}`;
}

export function createClient(options: ClientOptions = {}): Client {
  const {
    headers = {},
    timeoutMs = 20_000,
    slowMs = 3_000,
    onEvent = () => {},
    onSlow = () => {},
    routeLabel: label = routeLabel,
  } = options;

  function report(
    method: string,
    path: string,
    started: number,
    res: Response | null,
    error?: TransportError,
  ) {
    const ms = Math.round(performance.now() - started);
    // An edge error page carries the status the edge chose, and that
    // status is the evidence (a 502 is the origin down, a 403 is the
    // WAF); the label keeps it.
    if (error === "bad_response")
      onEvent(`api_${error}`, `${res?.status ?? 0} ${label(method, path)}`);
    else if (error) onEvent(`api_${error}`, label(method, path));
    else if (ms >= slowMs) onEvent("api_slow", label(method, path));
    if (ms < slowMs && !error) return;
    onSlow({
      request: `${method} ${path}`,
      wall_ms: ms,
      status: res?.status ?? 0,
      server_timing: res?.headers?.get?.("server-timing") ?? null,
      ...(error ? { error } : {}),
    });
  }

  async function request<T>(
    method: Method,
    path: string,
    body?: unknown,
  ): Promise<Envelope<T>> {
    const started = performance.now();
    let res: Response;
    try {
      res = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          ...headers,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const error: TransportError =
        (err as { name?: string })?.name === "TimeoutError"
          ? "timeout"
          : "network";
      report(method, path, started, null, error);
      return { ok: false, status: 0, data: {} as T, error };
    }
    const text = await res.text();
    let data: T;
    try {
      data = (text ? JSON.parse(text) : {}) as T;
    } catch {
      // Every /api route answers JSON. Anything else was produced in
      // FRONT of the API - an edge error page - so whatever status it
      // arrived with, this is a failure and must never read as success.
      report(method, path, started, res, "bad_response");
      return {
        ok: false,
        status: res.status,
        data: {} as T,
        error: "bad_response",
      };
    }
    report(method, path, started, res);
    return { ok: res.ok, status: res.status, data };
  }

  return {
    request,
    get: (path) => request("GET", path),
    post: (path, body = {}) => request("POST", path, body),
  };
}
