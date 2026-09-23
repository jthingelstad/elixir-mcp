#!/usr/bin/env node
/**
 * The Gym's door: one MCP call as the `gym` agent principal (its own
 * account and hourly bucket, /a/cd9e89e10d09/mcp), not Jamie's
 * connection. The token comes from .claude/skills/gym/.env (mode 0600,
 * ignored by git) and is never printed.
 *
 *   node .claude/skills/gym/call.mjs --list              names + titles
 *   node .claude/skills/gym/call.mjs --schema <tool>     one tool's full declaration
 *   node .claude/skills/gym/call.mjs <tool> '<json args>' [--save <file>]
 *
 * A call prints the response body as JSON (a refusal is a body too) and
 * a last stderr line with request_id, ms and isError. --save also writes
 * the body to a file, so arithmetic can be checked in code against the
 * exact answer that was read.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, makeDoor } from "../../../acceptance/door.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = loadEnv(path.join(here, ".env"));
if (!env) {
  console.error(
    "gym: no .claude/skills/gym/.env (ELIXIR_MCP_URL + ELIXIR_MCP_TOKEN). See SKILL.md, 'The Gym's account'.",
  );
  process.exit(2);
}
const door = makeDoor({ url: env.ELIXIR_MCP_URL, token: env.ELIXIR_MCP_TOKEN });
const argv = process.argv.slice(2);

if (argv[0] === "--list") {
  const tools = await door.toolsList();
  for (const t of tools.sort((a, b) => a.name.localeCompare(b.name)))
    console.log(`${t.name}\t${t.annotations?.title ?? t.title ?? ""}`);
  process.exit(0);
}

if (argv[0] === "--schema") {
  const tools = await door.toolsList();
  const t = tools.find((x) => x.name === argv[1]);
  if (!t) {
    console.error(`gym: no tool ${argv[1]} on this connection`);
    process.exit(2);
  }
  console.log(JSON.stringify(t, null, 2));
  process.exit(0);
}

const [tool, rawArgs = "{}", ...rest] = argv;
if (!tool) {
  console.error("usage: call.mjs --list | --schema <tool> | <tool> '<json>' [--save file]");
  process.exit(2);
}
let args;
try {
  args = JSON.parse(rawArgs);
} catch (e) {
  console.error(`gym: args are not JSON: ${e.message}`);
  process.exit(2);
}
const r = await door.call(tool, args);
const out = JSON.stringify(r.body, null, 2);
console.log(out);
const save = rest.indexOf("--save");
if (save !== -1 && rest[save + 1]) {
  mkdirSync(path.dirname(rest[save + 1]), { recursive: true });
  writeFileSync(rest[save + 1], out);
}
console.error(
  `request_id=${r.body?.meta?.request_id ?? r.body?.error?.request_id ?? "-"} ms=${r.ms ?? "-"} isError=${r.isError}`,
);
