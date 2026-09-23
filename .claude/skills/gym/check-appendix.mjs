#!/usr/bin/env node
/**
 * Check a Gym report's appendix before anything is merged into
 * acceptance/gym.json:
 *   node .claude/skills/gym/check-appendix.mjs <report.md>
 *
 * It runs the same load rules as the suite: gymCases rejects a duplicate
 * id and a finding with no control. It checks ids against gym.json as it
 * stands, and applies the brief's rules the loader cannot see: no
 * `live: true`, no write tool, and `player_tag` named on player tools.
 * Exit 0 prints the case count; anything else prints every problem.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gymCases } from "../../../acceptance/gym-interp.mjs";
import { makeRegistry } from "../../../services/mcp/src/tools.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
if (!file) {
  console.error("usage: check-appendix.mjs <report.md>");
  process.exit(2);
}
const text = readFileSync(file, "utf8");
const at = text.search(/^## Appendix/m);
if (at === -1) {
  console.error("no '## Appendix' section");
  process.exit(1);
}
const fence = /```json\s*\n([\s\S]*?)```/.exec(text.slice(at));
if (!fence) {
  console.error("the Appendix has no ```json block");
  process.exit(1);
}
let cases;
try {
  cases = JSON.parse(fence[1]);
} catch (e) {
  console.error(`the Appendix is not JSON: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(cases)) {
  console.error("the Appendix must be one JSON array");
  process.exit(1);
}

const problems = [];
try {
  gymCases(cases);
} catch (e) {
  problems.push(e.message);
}

const existing = JSON.parse(
  readFileSync(path.join(here, "../../../acceptance/gym.json"), "utf8"),
);
const taken = new Set(existing.map((c) => c.id));

const WRITE_TOOLS = new Set([
  "live_fetch",
  "elixir_track_player",
  "elixir_track_clan",
  "collections_edit",
  "elixir_nickname",
  "elixir_identify",
  "elixir_send_feedback",
]);
const TAKES_PLAYER_TAG = new Set(
  makeRegistry()
    .declarations()
    .filter((d) => Object.hasOwn(d.inputSchema?.properties ?? {}, "player_tag"))
    .filter((d) => d.name.startsWith("players_"))
    .map((d) => d.name),
);
const reads = (c) =>
  c.calls ? Object.values(c.calls) : c.tool ? [{ tool: c.tool, args: c.args }] : [];

for (const c of cases) {
  if (taken.has(c.id)) problems.push(`${c.id}: already in gym.json`);
  for (const r of reads(c)) {
    const a = r.args ?? {};
    if (a.live === true) problems.push(`${c.id}: sends live: true`);
    if (WRITE_TOOLS.has(r.tool)) problems.push(`${c.id}: calls ${r.tool}`);
    // Only a tool that TAKES player_tag needs it named (players_search
    // and players_names do not, and refuse an unknown argument).
    if (TAKES_PLAYER_TAG.has(r.tool) && !a.player_tag)
      problems.push(`${c.id}: ${r.tool} without player_tag`);
  }
  // The bite is the defect's answer; a control asserts what must hold and
  // may have none (82.2, 82.3 in gym.json).
  if (!c.control && !c.needs_fixture && !c.open_question && !c.request_id)
    problems.push(`${c.id}: no request_id (the bite)`);
}

if (problems.length) {
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}
console.log(`ok: ${cases.length} cases`);
