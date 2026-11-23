#!/usr/bin/env node
/**
 * Mints a key for a test account (acceptance, the Gym) on this machine.
 *
 *   node infra/scripts/mint-test-key.mjs <name> <env-file>
 *
 * The raw value goes only into <env-file>, written mode 0600 beside the
 * door's URL, and is never printed: no agent, log or Lambda sees it
 * (golden rule 1). What is printed is the `{test_account}` op payload,
 * which carries only the sha256 (docs/notes/2026-11-23-test-identities-are-people.md).
 * The payload is a dry run; send it, read the plan, then send it again
 * with "dry_run": false.
 *
 * The file must not exist yet: a mint never overwrites a working key.
 */
import { writeFileSync, existsSync } from "node:fs";
import { mintServiceTokenValue } from "../../packages/auth/src/oauth.mjs";

const PRESETS = {
  acceptance: { scope: "cr:read", hourly_rate_limit: 2400 },
  gym: { scope: "cr:read feedback:write", hourly_rate_limit: 1000000 },
};
const DOOR = "https://elixir.poapkings.com/mcp";

const [name, file] = process.argv.slice(2);
if (!PRESETS[name] || !file) {
  console.error(
    `usage: mint-test-key.mjs <${Object.keys(PRESETS).join("|")}> <env-file>`,
  );
  process.exit(2);
}
if (existsSync(file)) {
  console.error(`refusing: ${file} exists; move it aside first`);
  process.exit(1);
}
const { raw, hash } = mintServiceTokenValue();
writeFileSync(file, `ELIXIR_MCP_URL=${DOOR}\nELIXIR_MCP_TOKEN=${raw}\n`, {
  mode: 0o600,
  flag: "wx",
});
console.log(`wrote ${file} (mode 0600; the key is not shown)`);
console.log(
  JSON.stringify({
    test_account: {
      name,
      clan_tag: "#J2RGCRVG",
      token_hash: hash,
      ...PRESETS[name],
      mcp_daily_quota: 50000,
      dry_run: true,
    },
  }),
);
