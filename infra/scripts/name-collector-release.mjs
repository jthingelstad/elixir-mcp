#!/usr/bin/env node
/**
 * Name a collector release — the UPDATE AUTHORITY's missing last mile.
 *
 * The authority has been built and serving since 0039: collectors ask
 * GET /api/collector/config and install ONLY the version + SHA-256 this
 * server names for their platform. Nothing ever wrote those rows, so
 * `update: {}` went out to every collector and no released binary has
 * ever updated itself. This is the step that names one.
 *
 *   AWS_PROFILE=jamie node infra/scripts/name-collector-release.mjs [tag]
 *   AWS_PROFILE=jamie node infra/scripts/name-collector-release.mjs --dry-run
 *
 * With no tag it reads the collector repo's latest GitHub release. It
 * pulls that release's SHA256SUMS, re-derives each platform key from
 * the asset names, and upserts one row per platform through the migrate
 * lambda. Idempotent: naming the same tag twice changes nothing but
 * updated_at.
 *
 * SOAK FIRST. Every green push to the collector repo's main publishes a
 * release, so a tag existing means nothing about whether it is good.
 * Naming it here is what ships it to the fleet, within the hour. Run a
 * canary on that build and look at its log before naming it.
 *
 * Requires the `gh` CLI (authenticated) for release metadata, and owner
 * AWS credentials for the lambda invoke.
 */

import { execFileSync } from "node:child_process";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const REGION = "us-east-1";
const REPO = "jthingelstad/elixir-mcp-collector";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const tag = args.find((a) => !a.startsWith("-"));

/**
 * Asset name -> the config key that platform's binary actually asks for.
 *
 * The key is `go-${GOOS}-${GOARCH}`, built by the client from its own
 * runtime constants. Two of these do NOT match the asset name, and both
 * would fail silently — the collector would look up a key that is not
 * in the response and simply never update:
 *   - armv7 builds with GOARCH=arm (GOARM=7 is not part of GOARCH), so
 *     the asset collector_linux_armv7 answers to `go-linux-arm`.
 *   - Windows assets carry a .exe suffix the key does not.
 */
const KEY_BY_ASSET = {
  collector_darwin_arm64: "go-darwin-arm64",
  collector_darwin_amd64: "go-darwin-amd64",
  collector_linux_arm64: "go-linux-arm64",
  collector_linux_amd64: "go-linux-amd64",
  collector_linux_armv7: "go-linux-arm",
  "collector_windows_amd64.exe": "go-windows-amd64",
  "collector_windows_arm64.exe": "go-windows-arm64",
};

const gh = (...a) =>
  execFileSync("gh", a, { encoding: "utf8", maxBuffer: 8 << 20 });

let release;
try {
  release = JSON.parse(
    gh(
      "release",
      "view",
      ...(tag ? [tag] : []),
      "--repo",
      REPO,
      "--json",
      "tagName,assets,isDraft,isPrerelease",
    ),
  );
} catch (err) {
  console.error(
    `could not read ${tag ? `release ${tag}` : "the latest release"} from ${REPO}: ${err.message}`,
  );
  process.exit(1);
}

if (release.isDraft || release.isPrerelease) {
  console.error(
    `refusing to name ${release.tagName}: it is a ${release.isDraft ? "draft" : "prerelease"}.`,
  );
  process.exit(1);
}

// The checksums are the release's own SHA256SUMS asset, which is what
// the collector repo's release job generates from the built binaries.
let sums;
try {
  sums = gh(
    "release",
    "download",
    release.tagName,
    "--repo",
    REPO,
    "-p",
    "SHA256SUMS",
    "-O",
    "-",
  );
} catch (err) {
  console.error(
    `release ${release.tagName} has no readable SHA256SUMS: ${err.message}`,
  );
  process.exit(1);
}

const shaByAsset = new Map();
for (const line of sums.split("\n")) {
  const m = line.trim().match(/^([0-9a-f]{64})\s+(\S+)$/);
  if (m) shaByAsset.set(m[2], m[1]);
}

const urlByAsset = new Map(release.assets.map((a) => [a.name, a.url]));

const rows = [];
const skipped = [];
for (const [asset, platform] of Object.entries(KEY_BY_ASSET)) {
  const sha256 = shaByAsset.get(asset);
  const url = urlByAsset.get(asset);
  if (!sha256 || !url) {
    skipped.push(`${asset} (${!url ? "no asset" : "no checksum"})`);
    continue;
  }
  rows.push({ platform, version: release.tagName, sha256, url });
}

if (skipped.length) {
  console.error(
    `WARNING: not naming ${skipped.length} platform(s): ${skipped.join(", ")}`,
  );
}
if (!rows.length) {
  console.error(
    "nothing to name — no asset had both a checksum and a download URL.",
  );
  process.exit(1);
}

console.error(
  `${dryRun ? "Would name" : "Naming"} ${release.tagName} for ${rows.length} platform(s):`,
);
for (const r of rows) {
  console.error(
    `  ${r.platform.padEnd(20)} ${r.sha256.slice(0, 12)}…  ${r.url}`,
  );
}

if (dryRun) {
  console.error("\n--dry-run: nothing written.");
  process.exit(0);
}

const lambda = new LambdaClient({ region: REGION });
let failures = 0;
for (const row of rows) {
  const invoked = await lambda.send(
    new InvokeCommand({
      FunctionName: "elixir-mcp-migrate",
      Payload: Buffer.from(JSON.stringify({ collector_release: row })),
    }),
  );
  const result = JSON.parse(Buffer.from(invoked.Payload).toString() || "null");
  if (result?.ok) {
    console.error(`  named ${row.platform} -> ${row.version}`);
  } else {
    failures += 1;
    console.error(`  FAILED ${row.platform}: ${JSON.stringify(result)}`);
  }
}

if (failures) {
  console.error(`\n${failures} platform(s) failed; the rest are named.`);
  process.exit(1);
}
console.error(
  `\nNamed ${release.tagName}. Collectors pick it up on their next hourly config call.`,
);
