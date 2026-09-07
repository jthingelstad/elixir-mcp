#!/usr/bin/env node
/**
 * Debug runner: call any Clash Royale API endpoint directly and print the
 * raw JSON. For answering "what does the API ACTUALLY return right now?"
 * without going through the recorder, the projectors, or a deploy.
 *
 *   node infra/scripts/cr-api.mjs /clans/#J2RGCRVG/currentriverrace
 *   node infra/scripts/cr-api.mjs /players/#20JJJ2CCRU
 *   node infra/scripts/cr-api.mjs /clans/#J2RGCRVG/riverracelog --query limit=2
 *   node infra/scripts/cr-api.mjs /cards | jq '.items | length'
 *
 * Tags: `#` is url-encoded for you, so quote the arg or let the shell see
 * it as a comment at your peril -- both `'#J2RG...'` and `%23J2RG...` work.
 *
 * Body JSON goes to STDOUT and nothing else, so it pipes into jq/python.
 * Status, timing and which credential answered go to STDERR.
 *
 * Credentials: CR API keys are bound to allowlisted IPs, so the key that
 * works from this Mac is not the one the deployed collector uses. Rather
 * than make you guess, this tries each known name in order and reports
 * which one answered. Token VALUES are never printed or logged -- only
 * their names.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://api.clashroyale.com/v1";
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");

// Name -> file, in the order we try them. Drop's key leads by Jamie's
// call: Drop ran the fixed-IP CR bridge, so its key is the one allowlisted
// for interactive use. The rest are fallbacks -- elixir-mcp's own service
// tokens, then elixir-bot's local key. A name is repeated per file on
// purpose; CR_API_KEY means a different credential in each repo.
const SOURCES = [
  ["CR_API_KEY", path.resolve(repo, "../drop.poapkings.com/.env")],
  ["CR_API_TOKEN", path.join(repo, ".env")],
  ["CR_API_TOKEN-TWO", path.join(repo, ".env")],
  ["CR_API_KEY", path.resolve(repo, "../elixir-bot/.env")],
];

function readEnvFile(file) {
  const out = new Map();
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    out.set(t.slice(0, eq).trim(), v);
  }
  return out;
}

function credentials(only) {
  const creds = [];
  const cache = new Map();
  for (const [name, file] of SOURCES) {
    if (only && name !== only) continue;
    if (process.env[name]) {
      creds.push({ name, from: "environment", token: process.env[name] });
      continue;
    }
    if (!cache.has(file)) cache.set(file, readEnvFile(file));
    const token = cache.get(file).get(name);
    if (token) creds.push({ name, from: path.relative(repo, file), token });
  }
  return creds;
}

function usage(message) {
  if (message) process.stderr.write(`cr-api: ${message}\n\n`);
  process.stderr.write(
    "usage: node infra/scripts/cr-api.mjs <path> [--query k=v]... [--token NAME]\n" +
      "       --token NAME   use only this credential " +
      `(${[...new Set(SOURCES.map(([n]) => n))].join(", ")})\n` +
      "       --list         show which credentials are available, then exit\n",
  );
  process.exit(message ? 2 : 0);
}

const argv = process.argv.slice(2);
let endpoint = null;
let only = null;
const query = new URLSearchParams();
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === "--help" || a === "-h") usage();
  else if (a === "--list") {
    const found = credentials(null);
    if (!found.length) process.stderr.write("no credentials found\n");
    for (const c of found)
      process.stderr.write(`${c.name}  (from ${c.from})\n`);
    process.exit(0);
  } else if (a === "--token") {
    only = argv[++i];
    if (!only) usage("--token needs a name");
  } else if (a === "--query") {
    const kv = argv[++i];
    if (!kv || !kv.includes("=")) usage("--query needs k=v");
    const eq = kv.indexOf("=");
    query.append(kv.slice(0, eq), kv.slice(eq + 1));
  } else if (a.startsWith("-")) usage(`unknown flag ${a}`);
  else if (endpoint === null) endpoint = a;
  else usage("only one path");
}
if (endpoint === null) usage("a path is required");

// `#` is the tag sigil, not a fragment: encode it before URL parsing eats it.
const cleaned = endpoint.replace(/^https?:\/\/[^/]+\/v1/, "");
const url =
  BASE +
  (cleaned.startsWith("/") ? cleaned : `/${cleaned}`).replace(/#/g, "%23") +
  (query.size ? `?${query}` : "");

const creds = credentials(only);
if (!creds.length) {
  process.stderr.write(
    only
      ? `no credential named ${only} in the environment or .env files\n`
      : "no CR API credentials found (checked environment and .env files)\n",
  );
  process.exit(1);
}

let last = null;
process.exitCode = 1;
for (const cred of creds) {
  const started = Date.now();
  let res;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${cred.token}`,
        Accept: "application/json",
      },
    });
  } catch (error) {
    process.stderr.write(`${cred.name}: request failed — ${error.message}\n`);
    continue;
  }
  const elapsed = Date.now() - started;
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep the raw text for the error path */
  }

  if (res.ok) {
    process.stderr.write(
      `${res.status} ${url}  ${elapsed}ms  via ${cred.name}\n`,
    );
    // NOT process.exit(0): stdout writes are async on a pipe, and exiting
    // here truncates any payload bigger than the pipe buffer (riverracelog
    // lost its tail at ~64KB). Set the code and let the runtime drain.
    process.stdout.write(`${JSON.stringify(body ?? text, null, 2)}\n`);
    process.exitCode = 0;
    break;
  }

  // An IP-bound key rejected from the wrong network is the single most
  // common failure here, and CR names the offending IP in the message.
  const reason = body?.reason ? ` ${body.reason}` : "";
  const detail = body?.message ? ` — ${body.message}` : "";
  process.stderr.write(
    `${cred.name}: ${res.status}${reason}${detail} (${elapsed}ms)\n`,
  );
  last = { status: res.status, body: body ?? text };
}

if (process.exitCode !== 0) {
  process.stderr.write(`no credential succeeded for ${url}\n`);
  if (last) process.stdout.write(`${JSON.stringify(last.body, null, 2)}\n`);
  process.exitCode = 1;
}
