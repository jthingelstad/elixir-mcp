#!/usr/bin/env node
/** Full dependency audit, with Jamie's one accepted dev-only risk (#1127).
 * The separate production audit still rejects every advisory. Remove this
 * exception when picomatch has a patched release and the lockfile moves.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ACCEPTED = "https://github.com/advisories/GHSA-fc5q-39xc-vjpf";
const SEVERITIES = ["info", "low", "moderate", "high", "critical"];
const root = fileURLToPath(new URL("../../", import.meta.url));

/** Follow metavulnerabilities to their actual advisories. Every affected
 * installation in an accepted chain must be development-only in the lock.
 * Missing links, cycles and unknown report shapes fail closed.
 */
export function auditFindings(report, lock) {
  if (
    report?.auditReportVersion !== 2 ||
    report.error ||
    !report.vulnerabilities ||
    typeof report.vulnerabilities !== "object" ||
    Array.isArray(report.vulnerabilities) ||
    !lock?.packages
  )
    throw new Error("unrecognized npm audit report or lockfile");

  const vulnerabilities = report.vulnerabilities;
  function accepted(name, visiting = new Set()) {
    const entry = vulnerabilities[name];
    if (!entry || !SEVERITIES.includes(entry.severity) || visiting.has(name))
      throw new Error(`invalid npm audit dependency chain: ${name}`);
    if (
      !Array.isArray(entry.nodes) ||
      !entry.nodes.length ||
      !entry.nodes.every((node) => lock.packages[node]?.dev === true) ||
      !Array.isArray(entry.via) ||
      !entry.via.length
    )
      return false;
    const next = new Set([...visiting, name]);
    return entry.via.every((via) => {
      if (typeof via === "string") return accepted(via, next);
      return (
        name === "picomatch" &&
        entry.severity === "high" &&
        via?.name === "picomatch" &&
        via.url === ACCEPTED &&
        via.severity === "high" &&
        via.range === "<=4.0.7"
      );
    });
  }
  const high = Object.keys(vulnerabilities).filter((name) => {
    const severity = vulnerabilities[name]?.severity;
    if (!SEVERITIES.includes(severity))
      throw new Error(`invalid npm audit severity: ${name}`);
    return ["high", "critical"].includes(severity);
  });
  const blocked = high.filter((name) => !accepted(name));
  return { blocked, accepted: high.filter((name) => !blocked.includes(name)) };
}

function main() {
  const audit = spawnSync("npm", ["audit", "--json", "--audit-level=high"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (audit.error || ![0, 1].includes(audit.status))
    throw new Error(
      `npm audit failed: ${audit.error?.message ?? audit.signal ?? audit.status}`,
    );
  const findings = auditFindings(
    JSON.parse(audit.stdout),
    JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8")),
  );
  if (
    audit.status === 1 &&
    !findings.blocked.length &&
    !findings.accepted.length
  )
    throw new Error("npm audit failed without high or critical findings");
  if (findings.accepted.length)
    console.log(
      `Accepted development risk (#1127): ${ACCEPTED}\nAffected packages: ${findings.accepted.join(", ")}`,
    );
  if (findings.blocked.length) {
    console.error(audit.stdout);
    throw new Error(
      `unaccepted high or critical findings: ${findings.blocked.join(", ")}`,
    );
  }
  console.log("Dependency audit passed under the recorded risk acceptance.");
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(`dependency audit: ${error.message}`);
    process.exitCode = 1;
  }
}
