/**
 * The pure half of `npm run web-latency` (../web-latency.mjs): the Logs
 * Insights queries, route normalisation, percentiles, ceilings and
 * verdicts, and the text report. No network here; the script hands in
 * the CloudWatch Logs calls, so the tests run offline.
 *
 * The web-api door logs two lines per request. The outer one
 * (`packages/http/src/server.mjs`, `event: "http_request"`) carries the
 * real path, the status, `ms` and the build, and is what this report
 * times. The handler's own line carries a coarser route key and
 * `timed_out`; only its timeouts are read, joined to the outer line by
 * `request_id` (the handler's key is `GET /api/clan/*` or
 * `GET /api/v1/*` for whole families, so it cannot name the route). The Clan door logs a third,
 * stringified line with `elixir_ms` and `store_ms`.
 */

export const LOG_GROUPS = {
  web: "/aws/lambda/web/elixir-mcp-web-api-web",
  mcp: "/aws/lambda/web/elixir-mcp-mcp-web",
};

/** Logs Insights returns at most this many rows per query; a window
 * that fills it is split in half and asked again. */
export const INSIGHTS_ROW_CAP = 10_000;

export const QUERIES = {
  web: `filter message.event = "http_request" | fields @timestamp, message.http, message.status, message.ms, message.build, message.request_id | limit ${INSIGHTS_ROW_CAP}`,
  timeouts: `filter message.timed_out = 1 | fields @timestamp, message.http, message.status, message.request_id | limit ${INSIGHTS_ROW_CAP}`,
  clan: `filter @message like /elixir_ms/ | fields @timestamp, @message | limit ${INSIGHTS_ROW_CAP}`,
  mcp: `filter ispresent(message.tool) | fields @timestamp, message.tool, message.status, message.ms, message.request_id | limit ${INSIGHTS_ROW_CAP}`,
};

const SLOW_MS = 3000;
const DAY_S = 86_400;

// A segment after one of these names is an identifier: a clan or player
// tag, an action, battle, award or send id.
const ID_AFTER = new Set([
  "clans",
  "players",
  "members",
  "actions",
  "awards",
  "battle",
  "battles",
  "battle-activity",
  "sends",
  "profile-refreshes",
  "accounts",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `GET /api/clan/clans/J2RGCRVG/actions/96` → `GET /api/clan/clans/*\/actions/*`:
 * tags, ids and uuids collapse so a route aggregates. The method stays. */
export function normaliseRoute(http) {
  const text = String(http ?? "").trim();
  const space = text.indexOf(" ");
  const method = space > 0 ? text.slice(0, space) : "";
  const path = (space > 0 ? text.slice(space + 1) : text).split("?")[0];
  const segments = path.split("/");
  const out = segments.map((segment, i) => {
    if (i === 0 || segment === "") return segment;
    if (segment === "*") return segment;
    if (ID_AFTER.has(segments[i - 1])) return "*";
    if (UUID.test(segment) || /^\d+$/.test(segment)) return "*";
    if (/^(%23|#)/i.test(segment)) return "*";
    return segment;
  });
  const route = out.join("/");
  return method ? `${method} ${route}` : route;
}

/** The web report times the API reads and battle pages, not the app
 * shell, static files or scanner noise. */
function isReportedWebRoute(route) {
  const path = route.slice(route.indexOf(" ") + 1);
  return path.startsWith("/api/") || path.startsWith("/battle/");
}

/** Nearest-rank percentile of an ascending array; null when empty. */
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** Samples, p50, p95, max, count over 3 s and 5xx count of rows
 * `{ ms, status }`. */
export function stats(rows) {
  const ms = rows
    .map((row) => row.ms)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return {
    samples: ms.length,
    p50: percentile(ms, 50),
    p95: percentile(ms, 95),
    max: ms.length ? ms[ms.length - 1] : null,
    over_3s: ms.filter((value) => value > SLOW_MS).length,
    errors_5xx: rows.filter((row) => row.status >= 500).length,
  };
}

function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function globToRegExp(pattern) {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`);
}

/** The ceiling that applies to a route: an exact pattern first, else
 * the longest matching glob (`*` matches anything, slashes included).
 * Null when no pattern names the route: it is reported, never judged. */
export function ceilingFor(ceilings, door, key) {
  if (door === "mcp") {
    const named = ceilings.mcp?.tools?.[key];
    return named ?? ceilings.mcp?.default_p95_ms ?? null;
  }
  const routes = ceilings.web ?? [];
  const exact = routes.find((entry) => entry.route === key);
  if (exact) return exact.p95_ms;
  const matching = routes
    .filter((entry) => entry.route.includes("*"))
    .filter((entry) => globToRegExp(entry.route).test(key))
    .sort((a, b) => b.route.length - a.route.length);
  return matching[0]?.p95_ms ?? null;
}

/** `thin` under the minimum sample count (never judged), `over` when p95
 * passes the ceiling, `ok` otherwise; `none` with no ceiling. */
export function verdict(stat, ceiling, minSamples) {
  if (ceiling == null) return "none";
  if (stat.samples < minSamples) return "thin";
  return stat.p95 > ceiling ? "over" : "ok";
}

/** A Logs Insights result row (`[{field, value}]`) as an object. */
export function rowObject(row) {
  return Object.fromEntries(
    row
      .filter((cell) => cell.field !== "@ptr")
      .map((cell) => [cell.field, cell.value]),
  );
}

/** The Clan door's trace line, stringified inside the log envelope:
 * `{http, ms, elixir_ms, store_ms, status}`, or null when it is not one. */
export function parseClanLine(raw) {
  try {
    const envelope = typeof raw === "string" ? JSON.parse(raw) : raw;
    const inner =
      typeof envelope?.message === "string"
        ? JSON.parse(envelope.message)
        : envelope?.message;
    if (!inner || !Number.isFinite(inner.elixir_ms) || !inner.http) return null;
    return {
      http: inner.http,
      ms: Number(inner.ms),
      elixir_ms: Number(inner.elixir_ms),
      store_ms: Number(inner.store_ms ?? 0),
      status: Number(inner.status ?? 0),
    };
  } catch {
    return null;
  }
}

/** Split [start, end) seconds into whole-day windows (the last may be
 * shorter), oldest first. */
function dayWindows(start, end) {
  const windows = [];
  for (let from = start; from < end; from += DAY_S)
    windows.push([from, Math.min(end, from + DAY_S)]);
  return windows;
}

/** A row's identity across windows: its request id, else the whole log
 * line; null keeps the row unconditionally. */
function rowKey(row) {
  return row["message.request_id"] ?? row["@message"] ?? null;
}

/**
 * Every row a query returns over [start, end), asked a day at a time; a
 * day that fills the row cap is halved until it does not (down to a
 * minute, where the cap is reported rather than hidden).
 * `runQuery({start, end})` resolves to an array of row objects.
 * StartQuery's start and end are both inclusive, so an event on a
 * window's edge comes back from both neighbours: rows are kept once by
 * `rowKey`.
 */
export async function collectRows(runQuery, start, end) {
  const rows = [];
  const seen = new Set();
  let truncated = false;
  const ask = async (from, to) => {
    const got = await runQuery({ start: from, end: to });
    if (got.length >= INSIGHTS_ROW_CAP && to - from > 60) {
      const mid = Math.floor((from + to) / 2);
      await ask(from, mid);
      await ask(mid, to);
      return;
    }
    if (got.length >= INSIGHTS_ROW_CAP) truncated = true;
    for (const row of got) {
      const key = rowKey(row);
      if (key != null) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      rows.push(row);
    }
  };
  for (const [from, to] of dayWindows(start, end)) await ask(from, to);
  return { rows, truncated };
}

const num = (value) => (value === undefined ? NaN : Number(value));

/**
 * The report from raw rows: `web` and `timeouts` rows from the web-api
 * group, `clan` rows (`@message`), `mcp` rows from the MCP group.
 */
export function buildReport(
  { web = [], timeouts = [], clan = [], mcp = [] },
  ceilings,
  { minSamples = ceilings.min_samples ?? 10, window = null } = {},
) {
  const webRows = web
    .map((row) => ({
      at: row["@timestamp"],
      route: normaliseRoute(row["message.http"]),
      status: num(row["message.status"]),
      ms: num(row["message.ms"]),
      build: row["message.build"] ?? "unknown",
      request_id: row["message.request_id"] ?? null,
    }))
    .filter((row) => isReportedWebRoute(row.route));

  // A timeout belongs to the outer line with its request id; the
  // handler's own key is only a fallback.
  const routeOfRequest = new Map(
    webRows
      .filter((row) => row.request_id)
      .map((row) => [row.request_id, row.route]),
  );
  const timeoutsByRoute = groupBy(
    timeouts.map(
      (row) =>
        routeOfRequest.get(row["message.request_id"]) ??
        normaliseRoute(row["message.http"]),
    ),
    (route) => route,
  );

  const judge = (door, key, rows) => {
    const stat = stats(rows);
    const ceiling = ceilingFor(ceilings, door, key);
    return {
      key,
      ...stat,
      ceiling_p95_ms: ceiling,
      verdict: verdict(stat, ceiling, minSamples),
    };
  };

  const routes = [...groupBy(webRows, (row) => row.route)]
    .map(([key, rows]) => ({
      ...judge("web", key, rows),
      timed_out: timeoutsByRoute.get(key)?.length ?? 0,
    }))
    .sort(byP95);

  const tools = [
    ...groupBy(
      mcp.map((row) => ({
        tool: row["message.tool"],
        status: num(row["message.status"]),
        ms: num(row["message.ms"]),
      })),
      (row) => row.tool,
    ),
  ]
    .map(([key, rows]) => judge("mcp", key, rows))
    .sort(byP95);

  // Home by build, newest build first, so a deploy's effect shows.
  const latestAt = webRows.reduce(
    (latest, row) => (row.at > latest ? row.at : latest),
    "",
  );
  const latestBuild = webRows.find((row) => row.at === latestAt)?.build ?? null;
  const home = [
    ...groupBy(
      webRows.filter((row) => row.route.startsWith("GET /api/me/home")),
      (row) => `${row.route}\u0000${row.build}`,
    ),
  ]
    .map(([key, rows]) => {
      const [route, build] = key.split("\u0000");
      const at = rows.map((row) => row.at).sort();
      return {
        route,
        build,
        live: build === latestBuild,
        first_seen: at[0],
        last_seen: at[at.length - 1],
        ...stats(rows),
      };
    })
    .sort(
      (a, b) =>
        a.route.localeCompare(b.route) ||
        b.last_seen.localeCompare(a.last_seen),
    )
    // The newest build that served each route: the live one may have
    // served no Home read yet.
    .map((row, i, all) => ({
      ...row,
      newest: i === 0 || all[i - 1].route !== row.route,
    }));

  const clanRows = clan
    .map((row) => parseClanLine(row["@message"]))
    .filter(Boolean);
  const clanSplit = [...groupBy(clanRows, (row) => normaliseRoute(row.http))]
    .map(([key, rows]) => {
      const sorted = (field) =>
        rows.map((row) => row[field]).sort((a, b) => a - b);
      const total = rows.reduce((sum, row) => sum + row.ms, 0);
      const elixir = rows.reduce((sum, row) => sum + row.elixir_ms, 0);
      const store = rows.reduce((sum, row) => sum + row.store_ms, 0);
      return {
        key,
        samples: rows.length,
        p50: percentile(sorted("ms"), 50),
        p95: percentile(sorted("ms"), 95),
        elixir_p50: percentile(sorted("elixir_ms"), 50),
        store_p50: percentile(sorted("store_ms"), 50),
        elixir_share: total ? round2(elixir / total) : null,
        store_share: total ? round2(store / total) : null,
      };
    })
    .sort(byP95);

  const judged = [...routes, ...tools];
  return {
    window,
    min_samples: minSamples,
    latest_build: latestBuild,
    over: judged.filter((row) => row.verdict === "over").length,
    routes,
    tools,
    home_by_build: home,
    clan_split: clanSplit,
  };
}

function byP95(a, b) {
  return (b.p95 ?? -1) - (a.p95 ?? -1) || a.key.localeCompare(b.key);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/** A UTC stamp (ISO or Insights' `YYYY-MM-DD HH:MM:SS.mmm`) in US Central. */
function central(stamp) {
  if (!stamp) return "";
  const iso = stamp.includes("T") ? stamp : `${stamp.replace(" ", "T")}Z`;
  const date = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  if (Number.isNaN(date.getTime())) return stamp;
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)} CT`;
}

function table(header, rows) {
  const cells = [header, ...rows].map((row) =>
    row.map((cell) => String(cell ?? "")),
  );
  const widths = header.map((_, i) =>
    Math.max(...cells.map((row) => row[i].length)),
  );
  return cells
    .map((row) =>
      row
        .map((cell, i) =>
          i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]),
        )
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

const msCell = (value) => (value == null ? "-" : String(value));

/** The readable report. */
export function renderReport(report) {
  const parts = [];
  if (report.window)
    parts.push(
      `Window: ${central(report.window.from)} to ${central(report.window.to)} (${report.window.days} d). Verdicts need ${report.min_samples} samples; fewer is thin, never judged.`,
    );
  const judgedRow = (row) => [
    row.key,
    row.samples,
    msCell(row.p50),
    msCell(row.p95),
    msCell(row.max),
    row.over_3s,
    row.errors_5xx,
    msCell(row.ceiling_p95_ms),
    row.verdict,
  ];
  parts.push(
    "Web routes (web-api door, ms)",
    table(
      [
        "route",
        "n",
        "p50",
        "p95",
        "max",
        ">3s",
        "5xx",
        "timeout",
        "ceiling",
        "verdict",
      ],
      report.routes.map((row) => {
        const cells = judgedRow(row);
        cells.splice(7, 0, row.timed_out);
        return cells;
      }),
    ),
    "",
    "MCP tools (mcp door, ms)",
    table(
      ["tool", "n", "p50", "p95", "max", ">3s", "5xx", "ceiling", "verdict"],
      report.tools.map(judgedRow),
    ),
    "",
    `Home by build (newest first; * = the newest build that served the route; live build ${report.latest_build ?? "unknown"})`,
    table(
      ["route", "build", "n", "p50", "p95", "max", "5xx", "first", "last"],
      report.home_by_build.map((row) => [
        row.route,
        `${row.build}${row.newest ? " *" : ""}`,
        row.samples,
        msCell(row.p50),
        msCell(row.p95),
        msCell(row.max),
        row.errors_5xx,
        central(row.first_seen),
        central(row.last_seen),
      ]),
    ),
    "",
    "Clan door split (its trace line: total vs Elixir calls vs its store)",
    report.clan_split.length
      ? table(
          [
            "route",
            "n",
            "p50",
            "p95",
            "elixir p50",
            "store p50",
            "elixir share",
            "store share",
          ],
          report.clan_split.map((row) => [
            row.key,
            row.samples,
            msCell(row.p50),
            msCell(row.p95),
            msCell(row.elixir_p50),
            msCell(row.store_p50),
            row.elixir_share ?? "-",
            row.store_share ?? "-",
          ]),
        )
      : "(no Clan trace lines in the window)",
    "",
    report.over
      ? `${report.over} judged route(s) or tool(s) over their p95 ceiling.`
      : "Every judged route and tool is within its p95 ceiling.",
  );
  return parts.join("\n");
}

export const USAGE = `npm run web-latency -- [--days N] [--json] [--check] [--min-samples N] [--ceilings PATH]

Read-only. Logs Insights over the web-api and MCP doors' request lines:
per route and per tool, samples, p50, p95, max, count over 3 s, 5xx,
against infra/web-latency-ceilings.json. --check exits 1 when any judged
route or tool is over its ceiling; a thin one (under --min-samples,
default from the ceilings file) is never judged.`;

/** The flags; unknown ones are refused. */
export function parseArgs(argv) {
  const options = {
    days: 7,
    json: false,
    check: false,
    minSamples: null,
    ceilings: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[(i += 1)];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--json") options.json = true;
    else if (arg === "--check") options.check = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--days") options.days = Number(value());
    else if (arg === "--min-samples") options.minSamples = Number(value());
    else if (arg === "--ceilings") options.ceilings = value();
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!(options.days > 0 && options.days <= 30))
    throw new Error("--days must be between 1 and 30");
  if (
    options.minSamples !== null &&
    !(Number.isInteger(options.minSamples) && options.minSamples > 0)
  )
    throw new Error("--min-samples must be a positive integer");
  return options;
}
