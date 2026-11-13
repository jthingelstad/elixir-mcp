/**
 * The web latency report's pure half (infra/scripts/lib/web-latency.mjs):
 * route normalisation, percentiles and verdicts, ceilings matching, the
 * Clan trace line, row-cap splitting and the report. No network.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  INSIGHTS_ROW_CAP,
  buildReport,
  ceilingFor,
  collectRows,
  normaliseRoute,
  parseArgs,
  parseClanLine,
  percentile,
  renderReport,
  rowObject,
  stats,
  verdict,
} from "../../../infra/scripts/lib/web-latency.mjs";

const ceilings = JSON.parse(
  readFileSync(
    new URL("../../../infra/web-latency-ceilings.json", import.meta.url),
    "utf8",
  ),
);

test("routes collapse tags, ids and uuids so they aggregate", () => {
  const cases = {
    "GET /api/clan/clans/J2RGCRVG/actions": "GET /api/clan/clans/*/actions",
    "GET /api/clan/clans/J2RGCRVG/actions/96":
      "GET /api/clan/clans/*/actions/*",
    "POST /api/clan/clans/J2RGCRVG/actions/2xglkbZ91pXR/decide":
      "POST /api/clan/clans/*/actions/*/decide",
    "GET /api/clan/clans/J2RGCRVG/members/00JRQGUCG/activity":
      "GET /api/clan/clans/*/members/*/activity",
    "GET /api/me/battle-activity/20JJJ2CCRU": "GET /api/me/battle-activity/*",
    "GET /api/v1/players/%230G9L8QCVV": "GET /api/v1/players/*",
    "GET /api/v1/clans/%23J2RGCRVG/war-history":
      "GET /api/v1/clans/*/war-history",
    "GET /battle/69dcc4e93f15": "GET /battle/*",
    "GET /api/me/email/sends/12c74397-b7a5-4bbc-baef-29c5469af6a4":
      "GET /api/me/email/sends/*",
    "GET /api/me/home/feed": "GET /api/me/home/feed",
    "GET /api/me/clans": "GET /api/me/clans",
    "GET /api/agent/*": "GET /api/agent/*",
    "GET /api/me/home?x=1": "GET /api/me/home",
  };
  for (const [raw, want] of Object.entries(cases))
    assert.equal(normaliseRoute(raw), want, raw);
});

test("percentile is nearest-rank and stats count slow and failed rows", () => {
  const sorted = Array.from({ length: 20 }, (_, i) => (i + 1) * 100);
  assert.equal(percentile(sorted, 50), 1000);
  assert.equal(percentile(sorted, 95), 1900);
  assert.equal(percentile([7], 95), 7);
  assert.equal(percentile([], 50), null);
  const got = stats([
    { ms: 100, status: 200 },
    { ms: 3500, status: 200 },
    { ms: 18_500, status: 504 },
    { ms: 3000, status: 200 },
  ]);
  assert.deepEqual(got, {
    samples: 4,
    p50: 3000,
    p95: 18_500,
    max: 18_500,
    over_3s: 2,
    errors_5xx: 1,
  });
});

test("ceilings: exact first, then the longest glob; unnamed routes unjudged", () => {
  assert.equal(ceilingFor(ceilings, "web", "GET /api/me"), 500);
  assert.equal(ceilingFor(ceilings, "web", "GET /api/me/first-answer"), 500);
  assert.equal(ceilingFor(ceilings, "web", "GET /api/me/home"), 2000);
  assert.equal(ceilingFor(ceilings, "web", "GET /api/me/home/feed"), 2000);
  assert.equal(
    ceilingFor(ceilings, "web", "GET /api/clan/clans/*/actions/*"),
    1500,
  );
  assert.equal(ceilingFor(ceilings, "web", "GET /api/me/timeline"), null);
  assert.equal(ceilingFor(ceilings, "web", "POST /api/clan/clans/*/x"), null);
  assert.equal(ceilingFor(ceilings, "mcp", "cards_card"), 2000);
  const named = { mcp: { default_p95_ms: 2000, tools: { slow_tool: 5000 } } };
  assert.equal(ceilingFor(named, "mcp", "slow_tool"), 5000);
  const nested = {
    web: [
      { route: "GET /api/*", p95_ms: 9000 },
      { route: "GET /api/me/home*", p95_ms: 2000 },
    ],
  };
  assert.equal(ceilingFor(nested, "web", "GET /api/me/home/clan"), 2000);
});

test("verdict: thin is never judged, over is strictly past the ceiling", () => {
  assert.equal(verdict({ samples: 9, p95: 99_999 }, 2000, 10), "thin");
  assert.equal(verdict({ samples: 10, p95: 2000 }, 2000, 10), "ok");
  assert.equal(verdict({ samples: 10, p95: 2001 }, 2000, 10), "over");
  assert.equal(verdict({ samples: 50, p95: 1 }, null, 10), "none");
});

test("a Clan request line parses, folded into the web API's or stringified as it was", () => {
  const inner = {
    http: "GET /api/clans/*/awards",
    status: 200,
    ms: 1961,
    elixir_ms: 1753,
    store_ms: 137,
  };
  const raw = JSON.stringify({ level: "INFO", message: JSON.stringify(inner) });
  assert.deepEqual(parseClanLine(raw), {
    http: "GET /api/clans/*/awards",
    ms: 1961,
    elixir_ms: 1753,
    store_ms: 137,
    status: 200,
  });
  // Since 2026-11-13 the story is folded into the web API's own line,
  // an object in the envelope, keyed by the route under /api/clan.
  assert.deepEqual(
    parseClanLine(
      JSON.stringify({
        level: "INFO",
        message: {
          ...inner,
          http: "GET /api/clan/clans/*/awards",
          connect_ms: 3,
          request_id: "r1",
        },
      }),
    ),
    {
      http: "GET /api/clan/clans/*/awards",
      ms: 1961,
      elixir_ms: 1753,
      store_ms: 137,
      status: 200,
    },
  );
  assert.equal(parseClanLine("not json"), null);
  assert.equal(
    parseClanLine(JSON.stringify({ message: { http: "GET /x", ms: 1 } })),
    null,
  );
});

test("a window that fills the row cap is split until it does not", async () => {
  const asked = [];
  const runQuery = async ({ start, end }) => {
    asked.push([start, end]);
    // The first whole day is too big; its halves are not.
    const size = end - start === 86_400 && start === 0 ? INSIGHTS_ROW_CAP : 3;
    return Array.from({ length: size }, () => ({}));
  };
  const { rows, truncated } = await collectRows(runQuery, 0, 2 * 86_400);
  assert.equal(truncated, false);
  assert.deepEqual(asked, [
    [0, 86_400],
    [0, 43_200],
    [43_200, 86_400],
    [86_400, 172_800],
  ]);
  assert.equal(rows.length, 9);
});

test("the report judges routes and tools and breaks Home down by build", () => {
  const web = (at, http, ms, status = 200, build = "b1") => ({
    "@timestamp": at,
    "message.http": http,
    "message.ms": String(ms),
    "message.status": String(status),
    "message.build": build,
  });
  const rows = [
    ...Array.from({ length: 10 }, (_, i) =>
      web(`2026-11-06 10:0${i}:00.000`, "GET /api/me/home", 5000, 200, "old"),
    ),
    web("2026-11-09 12:00:00.000", "GET /api/me/home", 900, 200, "new"),
    web("2026-11-09 12:01:00.000", "GET /api/me/home", 18_500, 504, "new"),
    web("2026-11-09 13:00:00.000", "GET /signin", 3),
    ...Array.from({ length: 3 }, () =>
      web("2026-11-09 13:30:00.000", "GET /api/clan/clans/J2RGCRVG/week", 9000),
    ),
  ];
  const report = buildReport(
    {
      web: rows,
      timeouts: [{ "message.http": "GET /api/me/home", "message.status": 504 }],
      mcp: Array.from({ length: 12 }, () => ({
        "message.tool": "cards_card",
        "message.ms": "100",
        "message.status": "200",
      })),
      clan: [
        {
          "@message": JSON.stringify({
            message: JSON.stringify({
              http: "GET /api/clans/*/week",
              ms: 9000,
              elixir_ms: 8000,
              store_ms: 500,
              status: 200,
            }),
          }),
        },
      ],
    },
    ceilings,
  );
  const home = report.routes.find((r) => r.key === "GET /api/me/home");
  assert.equal(home.samples, 12);
  assert.equal(home.verdict, "over");
  assert.equal(home.timed_out, 1);
  assert.equal(home.errors_5xx, 1);
  assert.equal(
    report.routes.find((r) => r.key === "GET /api/clan/clans/*/week").verdict,
    "thin",
  );
  assert.equal(
    report.routes.some((r) => r.key === "GET /signin"),
    false,
    "pages are not reported",
  );
  assert.equal(report.tools[0].verdict, "ok");
  assert.equal(report.over, 1);
  assert.equal(report.latest_build, "b1");
  assert.deepEqual(
    report.home_by_build.map((row) => [row.build, row.samples, row.newest]),
    [
      ["new", 2, true],
      ["old", 10, false],
    ],
  );
  assert.equal(report.clan_split[0].elixir_share, 0.89);
  const text = renderReport(report);
  assert.match(text, /GET \/api\/me\/home\s+12/);
  assert.match(text, /1 judged route\(s\) or tool\(s\) over/);
});

test("rows, flags and refusals", () => {
  assert.deepEqual(
    rowObject([
      { field: "message.ms", value: "12" },
      { field: "@ptr", value: "x" },
    ]),
    { "message.ms": "12" },
  );
  assert.deepEqual(parseArgs(["--days", "3", "--json", "--check"]), {
    days: 3,
    json: true,
    check: true,
    minSamples: null,
    ceilings: null,
    help: false,
  });
  assert.throws(() => parseArgs(["--deploy"]), /unknown argument/);
  assert.throws(() => parseArgs(["--days", "0"]), /--days/);
  assert.throws(() => parseArgs(["--days"]), /needs a value/);
  assert.throws(() => parseArgs(["--min-samples", "-1"]), /--min-samples/);
});

test("an event on a window edge is kept once (StartQuery is inclusive at both ends)", async () => {
  const edge = { "message.request_id": "r-edge", "message.ms": "5" };
  const runQuery = async ({ start }) =>
    start === 0
      ? [{ "message.request_id": "r-1" }, edge, {}]
      : [edge, { "@message": "line" }, { "@message": "line" }, {}];
  const { rows } = await collectRows(runQuery, 0, 2 * 86_400);
  assert.equal(rows.filter((row) => row === edge).length, 1);
  assert.equal(rows.filter((row) => row["@message"] === "line").length, 1);
  assert.equal(
    rows.filter((row) => Object.keys(row).length === 0).length,
    2,
    "a row with no identity is never dropped",
  );
  assert.equal(rows.length, 5);
});

test("a timeout is joined to its outer request, not the handler's coarse key", () => {
  const outer = (id, http, ms, status) => ({
    "@timestamp": "2026-11-09 12:00:00.000",
    "message.http": http,
    "message.ms": String(ms),
    "message.status": String(status),
    "message.build": "b1",
    "message.request_id": id,
  });
  const report = buildReport(
    {
      web: [
        outer("r1", "GET /api/clan/clans/J2RGCRVG/week", 18_500, 504),
        outer("r2", "GET /api/v1/clans/%23J2RGCRVG/roster", 18_400, 504),
        outer("r3", "GET /api/me/home", 18_500, 504),
      ],
      timeouts: [
        { "message.http": "GET /api/clan/*", "message.request_id": "r1" },
        { "message.http": "GET /api/v1/*", "message.request_id": "r2" },
        { "message.http": "GET /api/me/home", "message.request_id": "r3" },
      ],
    },
    ceilings,
  );
  const timedOut = Object.fromEntries(
    report.routes.map((row) => [row.key, row.timed_out]),
  );
  assert.deepEqual(timedOut, {
    "GET /api/clan/clans/*/week": 1,
    "GET /api/v1/clans/*/roster": 1,
    "GET /api/me/home": 1,
  });
});
