/**
 * Which way a deploy goes (structural assessment, Phase 4, 2026-09-29).
 *
 * A bundle is named by what it holds, not by its zip: `zip` stamps each
 * entry's mtime, so the same code zipped twice hashed differently and
 * every deploy flipped all seven Lambdas through CloudFormation. Keyed by
 * content, a Lambda whose code did not change keeps its S3 key, and the
 * stack sees no change for it.
 *
 * When no Lambda's key and not the template differ from the live stack,
 * the deploy takes the SITE lane: no migrate push, no migrations, no
 * stack update; the site publishes and the gates run as always. Anything
 * else is the PLATFORM lane, the whole deploy as it was.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Every file under `dir`, as sorted paths relative to it. */
function filesUnder(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}

/** A bundle directory's content hash: each file's path and bytes, in
 *  path order. Two builds of the same tree give the same value. */
export function bundleFingerprint(dir) {
  const hash = createHash("sha256");
  for (const rel of filesUnder(dir)) {
    const bytes = readFileSync(path.join(dir, rel));
    hash.update(`${rel}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return hash.digest("hex").slice(0, 16);
}

/** The S3 key a bundle is uploaded under. */
export const codeKey = (name, fingerprint) => `code/${name}/${fingerprint}.zip`;

/** CloudFormation keeps the template it was given with every non-ASCII
 *  character as "?" (measured 2026-09-29: the section signs and dashes in
 *  its comments), so the comparison does the same to the local file. */
export function sameTemplate(local, live) {
  return (
    typeof live === "string" &&
    local.replace(/[\u{80}-\u{10FFFF}]/gu, "?") === live
  );
}

/**
 * @param {{
 *   codeKeys: Record<string, string>,       // parameter name -> this build's key
 *   liveParameters: { ParameterKey: string, ParameterValue?: string }[],
 *   template: string,                       // infra/template.yaml
 *   liveTemplate: string | undefined,       // GetTemplate, stage Original
 *   platform?: boolean,                     // --platform
 *   parameterChange?: boolean,              // --param or --rotate-origin-secret
 * }} input
 * @returns {{ lane: "site" | "platform", changed: string[] }}
 */
export function chooseLane({
  codeKeys,
  liveParameters,
  template,
  liveTemplate,
  platform = false,
  parameterChange = false,
}) {
  const live = Object.fromEntries(
    (liveParameters ?? []).map((p) => [p.ParameterKey, p.ParameterValue]),
  );
  const changed = Object.entries(codeKeys)
    .filter(([param, key]) => live[param] !== key)
    .map(([param]) => param);
  if (!sameTemplate(template, liveTemplate)) changed.push("template");
  if (parameterChange) changed.push("parameters");
  if (platform) changed.push("--platform");
  return { lane: changed.length ? "platform" : "site", changed };
}
