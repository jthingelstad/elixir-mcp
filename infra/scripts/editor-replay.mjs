#!/usr/bin/env node
/**
 * Replay one run of a clan's model as its activity channel's editor
 * (2026-10-11), from the raw record the quality ledger keeps 30 days in
 * the archive bucket (`discord-runs/`), through today's editor.
 *
 *   npm run editor-replay -- <run_id> [--checks-only] [--model <id>] [--json]
 *
 * <run_id> is a `discord_run` row's (Admin ▸ Discord, or the
 * `{discord_review}` op), such as `clan-J2RGCRVG.1760191200000`, or the
 * row's `raw_key`.
 *
 * --checks-only   the run's own answer through today's checks: no model
 *                 call and no key.
 * otherwise       today's instructions sent with the run's own stories
 *                 and context to the run's model (or --model), on a
 *                 maintainer's own Anthropic key from the environment
 *                 variable ELIXIR_REPLAY_ANTHROPIC_KEY, which this script
 *                 hands to the model client and never prints or logs. A
 *                 clan's own key is never used, or reachable. Lookups
 *                 are answered from what the run looked up then.
 *
 * Nothing is posted, written or recorded: no Discord, no database, no
 * outbox. It reads one object with the cloud-engineer profile. The
 * output carries the clan's members' names and the run's text, so it
 * stays on the maintainer's machine: never paste it into this public
 * repository or a public issue.
 */

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { createAnthropicClient } from "../../packages/clan/src/anthropic.mjs";
import {
  checksOnly,
  originalOf,
  readRawRun,
  replayRun,
} from "../../packages/syndication/src/editor-replay.mjs";
import { runRawKey } from "../../packages/syndication/src/quality.mjs";

const KEY_ENV = "ELIXIR_REPLAY_ANTHROPIC_KEY";
const USAGE =
  "usage: npm run editor-replay -- <run_id | discord-runs/... key> [--checks-only] [--model <id>] [--json]";
const ENGINEER = /:assumed-role\/ProjectsCloudEngineer\//;

const argv = process.argv.slice(2);
let target = null;
let only = false;
let model = null;
let json = false;
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === "--checks-only") only = true;
  else if (a === "--json") json = true;
  else if (a === "--model") model = argv[++i] ?? null;
  else if (a === "--help" || a === "-h") {
    console.log(USAGE);
    process.exit(0);
  } else if (a.startsWith("--")) {
    console.error(`unknown flag ${a}\n${USAGE}`);
    process.exit(2);
  } else target = a;
}
if (!target || (model !== null && !model)) {
  console.error(USAGE);
  process.exit(2);
}

/** The raw record's key: given, or from the run id's own time. */
function rawKeyOf(t) {
  if (t.startsWith("discord-runs/")) return t;
  const ms = Number(t.slice(t.lastIndexOf(".") + 1));
  if (!/^clan-[0-9A-Z]+\.\d{12,}$/.test(t) || !Number.isFinite(ms)) return null;
  return runRawKey(t, ms);
}
const rawKey = rawKeyOf(target);
if (!rawKey) {
  console.error(
    `${target} is not a run id (clan-<TAG>.<ms>) or a discord-runs/ key.`,
  );
  process.exit(2);
}

const key = only ? null : process.env[KEY_ENV];
if (!only && !key) {
  console.error(
    `Set ${KEY_ENV} to your own Anthropic key to replay with a model, or pass --checks-only. A clan's key is never used.`,
  );
  process.exit(2);
}

const aws = {
  region: "us-east-1",
  profile: process.env.AWS_PROFILE ?? "cloud-engineer",
  maxAttempts: 1,
};
const arn = (await new STSClient(aws).send(new GetCallerIdentityCommand({})))
  .Arn;
if (!ENGINEER.test(arn ?? "")) {
  console.error(
    `editor-replay: the caller is ${arn}, not the ProjectsCloudEngineer role; nothing was read.`,
  );
  process.exit(2);
}
const bucket = process.env.ARCHIVE_BUCKET ?? "elixir-mcp-archive-999153317627";
let raw;
try {
  const out = await new S3Client(aws).send(
    new GetObjectCommand({ Bucket: bucket, Key: rawKey }),
  );
  raw = JSON.parse(await out.Body.transformToString("utf8"));
} catch (err) {
  console.error(
    `No raw run at ${rawKey} (${err?.name ?? "error"}): raw runs are kept 30 days, and a run whose capture failed has none.`,
  );
  process.exit(1);
}
const { run, error } = readRawRun(raw);
if (error) {
  console.error(`${rawKey} is not a raw editor run (${error}).`);
  process.exit(1);
}

const original = originalOf(run);
let replay;
if (only) replay = { mode: "checks_only", ...checksOnly(run) };
else {
  const client = createAnthropicClient();
  const use = model ?? run.model;
  if (!use) {
    console.error("The run recorded no model: pass --model <id>.");
    process.exit(2);
  }
  replay = {
    mode: "model",
    model: use,
    ...(await replayRun(run, {
      turn: (request) => client.turn(key, { model: use, ...request }),
    })),
  };
}

if (json) {
  console.log(
    JSON.stringify({ run_id: run.run_id, raw_key: rawKey, original, replay }),
  );
  process.exit(0);
}

const line = (s = "") => console.log(s);
const list = (title, rows, fmt) => {
  line(`  ${title}: ${rows.length}`);
  for (const r of rows) line(`    - ${fmt(r)}`);
};
const side = (title, x) => {
  line(title);
  if (x.error || x.ok === false) {
    line(`  no answer: ${x.error ?? x.code}`);
    return;
  }
  list("posts", x.posts, (p) => `[${p.keys.join(", ")}] ${p.text}`);
  list("skips", x.skips, (s) => `[${s.key}] ${s.reason}`);
  list(
    "refused by the checks",
    x.rejected,
    (r) => `[${r.keys.join(", ")}] ${r.why}${r.text ? `: ${r.text}` : ""}`,
  );
};
line(
  `${run.run_id} (${run.clan_tag}, ${run.at}): ${run.stories.length} stories, model ${run.model ?? "none"}, outcome ${run.outcome}`,
);
line();
side("THEN, as posted", original);
line();
side(
  only
    ? "NOW, the same answer through today's checks"
    : `NOW, today's editor on ${replay.model}`,
  replay,
);
for (const r of replay.rounds ?? [])
  for (const l of r.lookups ?? [])
    line(
      `  round ${r.round} looked up ${l.name} ${JSON.stringify(l.input)}${l.recorded ? "" : " (not in the run: answered as unavailable)"}`,
    );
line();
console.error(
  "This output names the clan's members: keep it off the public repository and public issues.",
);
