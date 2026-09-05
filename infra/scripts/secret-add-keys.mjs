/**
 * Merge new keys into the existing app secret from the repo-root .env
 * (bootstrap.mjs owns CREATION; this owns later additions). Secret
 * values flow file -> AWS inside this process — never through a
 * terminal, log line, or agent context. Existing keys are never
 * overwritten unless --overwrite names them.
 *
 *   AWS_PROFILE=jamie node infra/scripts/secret-add-keys.mjs \
 *     tinylytics_api_token=TINYLYTICS_API_TOKEN \
 *     buttondown_api_token=BUTTONDOWN_API_TOKEN
 *
 * Each arg is <secret-json-key>=<.env var name>. Prints key NAMES and
 * outcomes only.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const REGION = "us-east-1";
const SECRET_NAME = "elixir-mcp/app";
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

const specs = [];
let overwrite = false;
for (const arg of process.argv.slice(2)) {
  if (arg === "--overwrite") {
    overwrite = true;
    continue;
  }
  const m = /^([a-z0-9_]+)=([A-Z0-9_]+)$/.exec(arg);
  if (!m) {
    console.error(`bad arg (want secretkey=ENV_VAR): ${arg}`);
    process.exit(2);
  }
  specs.push({ key: m[1], envVar: m[2] });
}
if (specs.length === 0) {
  console.error("usage: secret-add-keys.mjs key=ENV_VAR [key=ENV_VAR ...]");
  process.exit(2);
}

const envText = await readFile(path.join(repoRoot, ".env"), "utf8");
function envValue(name) {
  for (const line of envText.split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, "");
  }
  return null;
}

const secrets = new SecretsManagerClient({ region: REGION });
const current = JSON.parse(
  (await secrets.send(new GetSecretValueCommand({ SecretId: SECRET_NAME })))
    .SecretString,
);

const merged = { ...current };
let changed = 0;
for (const { key, envVar } of specs) {
  const value = envValue(envVar);
  if (!value) {
    console.error(`${envVar} missing from .env; aborting (nothing written).`);
    process.exit(2);
  }
  if (key in current && !overwrite) {
    console.log(`kept:  ${key} (exists; use --overwrite to replace)`);
    continue;
  }
  merged[key] = value;
  changed += 1;
  console.log(`${key in current ? "replaced" : "added"}: ${key}`);
}

if (changed === 0) {
  console.log("no changes.");
} else {
  await secrets.send(
    new PutSecretValueCommand({
      SecretId: SECRET_NAME,
      SecretString: JSON.stringify(merged),
    }),
  );
  console.log(
    `wrote ${SECRET_NAME}: keys now [${Object.keys(merged).sort().join(", ")}]`,
  );
}
