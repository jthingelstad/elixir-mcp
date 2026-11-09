#!/usr/bin/env node
/**
 * How fast the signed-in web app and the MCP tools answer, from the
 * doors' own request lines (read-only Logs Insights; lib/web-latency.mjs
 * has the rules and the report).
 *
 *   npm run web-latency -- --days 7
 *   npm run web-latency -- --days 7 --json
 *   npm run web-latency -- --check     # exit 1 when a judged route is over
 *
 * Not a deploy or CI gate: natural traffic is too sparse to gate on.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CloudWatchLogsClient,
  GetQueryResultsCommand,
  StartQueryCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import {
  LOG_GROUPS,
  QUERIES,
  USAGE,
  buildReport,
  collectRows,
  parseArgs,
  renderReport,
  rowObject,
} from "./lib/web-latency.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`${error.message}\n\n${USAGE}`);
  process.exit(2);
}
if (options.help) {
  console.log(USAGE);
  process.exit(0);
}

const config = { region: "us-east-1", profile: "cloud-engineer" };
const arn = (await new STSClient(config).send(new GetCallerIdentityCommand({})))
  .Arn;
if (!/:assumed-role\/ProjectsCloudEngineer\//.test(arn ?? "")) {
  console.error(
    `web-latency: refusing: the caller is ${arn}, not ProjectsCloudEngineer`,
  );
  process.exit(2);
}

const ceilings = JSON.parse(
  readFileSync(
    options.ceilings ?? path.join(repoRoot, "infra/web-latency-ceilings.json"),
    "utf8",
  ),
);
const logs = new CloudWatchLogsClient(config);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One Logs Insights query over [start, end) seconds, polled to the end. */
async function runInsights(logGroupName, queryString, { start, end }) {
  const { queryId } = await logs.send(
    new StartQueryCommand({
      logGroupName,
      queryString,
      startTime: start,
      endTime: end,
    }),
  );
  for (let tries = 0; tries < 300; tries += 1) {
    await sleep(1000);
    const result = await logs.send(new GetQueryResultsCommand({ queryId }));
    if (result.status === "Complete")
      return (result.results ?? []).map(rowObject);
    if (["Failed", "Cancelled", "Timeout"].includes(result.status))
      throw new Error(`Logs Insights ${result.status} on ${logGroupName}`);
  }
  throw new Error(`Logs Insights did not finish on ${logGroupName}`);
}

const end = Math.floor(Date.now() / 1000);
const start = end - Math.round(options.days * 86_400);
const read = (group, query) =>
  collectRows((window) => runInsights(group, query, window), start, end);

const [web, timeouts, clan, mcp] = await Promise.all([
  read(LOG_GROUPS.web, QUERIES.web),
  read(LOG_GROUPS.web, QUERIES.timeouts),
  read(LOG_GROUPS.web, QUERIES.clan),
  read(LOG_GROUPS.mcp, QUERIES.mcp),
]);

const report = buildReport(
  { web: web.rows, timeouts: timeouts.rows, clan: clan.rows, mcp: mcp.rows },
  ceilings,
  {
    minSamples: options.minSamples ?? ceilings.min_samples ?? 10,
    window: {
      from: new Date(start * 1000).toISOString(),
      to: new Date(end * 1000).toISOString(),
      days: options.days,
    },
  },
);
const truncated = [web, timeouts, clan, mcp].some((part) => part.truncated);
if (truncated) report.truncated = true;

if (options.json) console.log(JSON.stringify(report, null, 2));
else {
  console.log(renderReport(report));
  if (truncated)
    console.log(
      "WARNING: a minute of logs filled the Insights row cap; counts are low.",
    );
}
if (options.check && report.over > 0) process.exitCode = 1;
