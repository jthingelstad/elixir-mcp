import assert from "node:assert/strict";
import test from "node:test";
import { auditFindings } from "../../../infra/scripts/audit-dependencies.mjs";

const url = "https://github.com/advisories/GHSA-fc5q-39xc-vjpf";
function fixture() {
  return {
    report: {
      auditReportVersion: 2,
      vulnerabilities: {
        picomatch: {
          severity: "high",
          nodes: ["node_modules/picomatch"],
          via: [{ name: "picomatch", severity: "high", url, range: "<=4.0.7" }],
        },
        vite: {
          severity: "high",
          nodes: ["node_modules/vite"],
          via: ["picomatch"],
        },
      },
    },
    lock: {
      packages: {
        "node_modules/picomatch": { dev: true },
        "node_modules/vite": { dev: true },
      },
    },
  };
}

test("only the accepted development advisory and its dependent packages pass", () => {
  const { report, lock } = fixture();
  assert.deepEqual(auditFindings(report, lock), {
    blocked: [],
    accepted: ["picomatch", "vite"],
  });
  assert.deepEqual(
    auditFindings({ auditReportVersion: 2, vulnerabilities: {} }, lock),
    { blocked: [], accepted: [] },
  );
});

test("a production installation anywhere in the chain fails", () => {
  for (const name of ["picomatch", "vite"]) {
    const { report, lock } = fixture();
    delete lock.packages[`node_modules/${name}`].dev;
    assert.ok(auditFindings(report, lock).blocked.includes(name));
  }
  const { report, lock } = fixture();
  report.vulnerabilities.picomatch.nodes.push(
    "node_modules/other/node_modules/picomatch",
  );
  lock.packages["node_modules/other/node_modules/picomatch"] = {};
  assert.deepEqual(auditFindings(report, lock).blocked, ["picomatch", "vite"]);
});

test("another advisory, changed affected range or critical severity still fails", () => {
  for (const change of [
    (v) => {
      v.via[0].url = "https://github.com/advisories/GHSA-another-advisory";
    },
    (v) => {
      v.via[0].range = "<=4.0.8";
    },
    (v) => {
      v.severity = v.via[0].severity = "critical";
    },
    (v) => {
      v.via.push({ name: "picomatch", severity: "high", url: "other" });
    },
  ]) {
    const { report, lock } = fixture();
    change(report.vulnerabilities.picomatch);
    assert.deepEqual(auditFindings(report, lock).blocked, [
      "picomatch",
      "vite",
    ]);
  }
});

test("an unrelated high advisory alongside the accepted one fails", () => {
  const { report, lock } = fixture();
  report.vulnerabilities.vite.via.push({
    name: "vite",
    severity: "high",
    url: "other",
  });
  assert.deepEqual(auditFindings(report, lock), {
    blocked: ["vite"],
    accepted: ["picomatch"],
  });
});

test("a high finding cannot escape through a lower-severity dependency", () => {
  const { report, lock } = fixture();
  report.vulnerabilities.other = {
    severity: "moderate",
    nodes: ["node_modules/other"],
    via: [{ name: "other", severity: "moderate", url: "other" }],
  };
  report.vulnerabilities.vite.via.push("other");
  // Even with a dev-only installation, this is a different advisory.
  lock.packages["node_modules/other"] = { dev: true };
  assert.deepEqual(auditFindings(report, lock).blocked, ["vite"]);
  delete lock.packages["node_modules/other"].dev;
  assert.deepEqual(auditFindings(report, lock).blocked, ["vite"]);
  // The ordinary full-audit threshold still permits moderate-only findings.
  delete report.vulnerabilities.vite;
  assert.deepEqual(auditFindings(report, lock).blocked, []);
});

test("audit errors, malformed reports and missing or cyclic chains fail closed", () => {
  const { report, lock } = fixture();
  for (const invalid of [
    {},
    { ...report, error: { code: "ENETWORK" } },
    { ...report, auditReportVersion: 3 },
  ])
    assert.throws(() => auditFindings(invalid, lock), /unrecognized/);
  for (const via of ["missing", "vite"]) {
    const f = fixture();
    f.report.vulnerabilities.picomatch.via = [via];
    assert.throws(
      () => auditFindings(f.report, f.lock),
      /invalid npm audit dependency chain/,
    );
  }
  delete report.vulnerabilities.picomatch.via;
  assert.deepEqual(auditFindings(report, lock).blocked, ["picomatch", "vite"]);
});
