#!/usr/bin/env node
/**
 * The call catalogue: what agents actually called this week, as the
 * input every generic rule runs over (checks/catalogue.mjs). Derived,
 * not written: the migrate lambda's {acceptance_catalogue} op returns
 * the most frequent argument sets per read-only tool among calls that
 * answered, with duration percentiles; this script shapes them, gives a
 * caller-default read a subject the acceptance principal can name, and
 * writes acceptance/catalogue.json - a committed file, so a refresh is a
 * reviewed diff and a run needs no AWS.
 *
 *   AWS_PROFILE=cloud-engineer node acceptance/catalogue.mjs --refresh [--days 7] [--per-tool 3]
 *
 * What is dropped: write tools (the token could not call them anyway),
 * live reads, caller identity (the op already drops on_behalf_of and
 * display_name), and the two tools whose answer is the caller's own
 * private state (elixir_my_feedback, elixir_my_identities) - an agent
 * principal has none.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { TOOL_GROUPS } from "@elixir-mcp/contracts";
import { makeRegistry } from "../services/mcp/src/tools.mjs";
import { validateArgs } from "../services/mcp/src/validate.mjs";
import { JAMIE } from "./lib.mjs";
import { canonical } from "./replay.mjs";

const sortKeys = (o) =>
  Object.fromEntries(
    Object.keys(o)
      .sort()
      .map((k) => [k, o[k]]),
  );

const here = path.dirname(fileURLToPath(import.meta.url));
export const CATALOGUE_FILE = path.join(here, "catalogue.json");

const PRIVATE_TO_THE_CALLER = new Set([
  "elixir_my_feedback",
  "elixir_my_identities",
  "elixir_my_players",
  "elixir_send_feedback",
]);

export function loadCatalogue() {
  return JSON.parse(readFileSync(CATALOGUE_FILE, "utf8"));
}

/** Shape the op's rows into the catalogue. Exported for the test. */
export function shapeCatalogue(raw, declarations, { stale = [] } = {}) {
  const byName = new Map(declarations.map((d) => [d.name, d]));
  const timing = new Map(raw.timing.map((t) => [t.tool, t]));
  const tools = {};
  for (const row of raw.sets) {
    const decl = byName.get(row.tool);
    if (!decl) continue;
    if (TOOL_GROUPS[row.tool]?.readOnly === false) continue;
    if (PRIVATE_TO_THE_CALLER.has(row.tool)) continue;
    const args = { ...row.args };
    delete args.live;
    // A caller-default read (omit player_tag to mean you) has no "you"
    // on an agent principal: the owner's primary player stands in.
    const props = decl.inputSchema?.properties ?? {};
    if (
      "player_tag" in props &&
      !("player_tag" in args) &&
      !("segment" in args) &&
      !("clan_tag" in args) &&
      !("card_id" in args) &&
      !("card" in args)
    )
      args.player_tag = JAMIE;
    // A set the current contract refuses is stale usage (a call from
    // before the argument became required), not a case: listed, dropped.
    const problem = validateArgs(decl.inputSchema, args);
    if (problem) {
      stale.push(`${row.tool} ${JSON.stringify(args)}: ${problem}`);
      continue;
    }
    const t = (tools[row.tool] ??= {
      calls: timing.get(row.tool)?.calls ?? null,
      p50_ms: timing.get(row.tool)?.p50_ms ?? null,
      p95_ms: timing.get(row.tool)?.p95_ms ?? null,
      sets: [],
    });
    // The same arguments in another key order are one set.
    const existing = t.sets.find((s) => canonical(s.args) === canonical(args));
    if (existing) existing.calls += row.calls;
    else t.sets.push({ args: sortKeys(args), calls: row.calls });
  }
  return {
    generated_at: new Date().toISOString(),
    days: raw.days,
    per_tool: raw.per_tool,
    tools: Object.fromEntries(
      Object.entries(tools).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

const isMain =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const args = process.argv.slice(2);
  if (!args.includes("--refresh")) {
    console.error("usage: catalogue.mjs --refresh [--days N] [--per-tool N]");
    process.exit(2);
  }
  const opt = (flag, dflt) =>
    args.includes(flag) ? Number(args[args.indexOf(flag) + 1]) : dflt;
  const lambda = new LambdaClient({});
  const res = await lambda.send(
    new InvokeCommand({
      FunctionName: "elixir-mcp-migrate",
      Payload: JSON.stringify({
        acceptance_catalogue: {
          days: opt("--days", 7),
          per_tool: opt("--per-tool", 3),
        },
      }),
    }),
  );
  const raw = JSON.parse(Buffer.from(res.Payload).toString("utf8"));
  if (raw.errorMessage) throw new Error(raw.errorMessage);
  const stale = [];
  const shaped = shapeCatalogue(raw, makeRegistry().declarations(), { stale });
  // Hand-picked sets beside the derived ones (catalogue-seed.json, a
  // reason each): reads that guarantee rows a docs section promises and
  // usage this week did not happen to make.
  const seeds = JSON.parse(
    readFileSync(path.join(here, "catalogue-seed.json"), "utf8"),
  );
  for (const [tool, sets] of Object.entries(seeds)) {
    if (tool.startsWith("_")) continue;
    const t = (shaped.tools[tool] ??= {
      calls: null,
      p50_ms: null,
      p95_ms: null,
      sets: [],
    });
    for (const seed of sets)
      if (!t.sets.some((s) => canonical(s.args) === canonical(seed.args)))
        t.sets.push({ args: sortKeys(seed.args), calls: 0, seed: seed.reason });
  }
  writeFileSync(CATALOGUE_FILE, JSON.stringify(shaped, null, 2) + "\n");
  // The committed file is formatted like everything else in the repo.
  const { spawnSync } = await import("node:child_process");
  spawnSync("npx", ["prettier", "--write", CATALOGUE_FILE], {
    stdio: "ignore",
  });
  for (const line of stale) console.log(`stale (dropped): ${line}`);
  const n = Object.values(shaped.tools).reduce((a, t) => a + t.sets.length, 0);
  console.log(
    `${CATALOGUE_FILE}: ${Object.keys(shaped.tools).length} tools, ${n} argument sets over ${shaped.days} days`,
  );
}
