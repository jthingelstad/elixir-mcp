import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

/** The headers an origin request policy forwards: a whitelist, so a
 *  header not on it is stripped before any Lambda. */
function forwardedHeaders(template, policy) {
  const start = template.indexOf(`  ${policy}:`);
  assert.ok(start >= 0, policy);
  const block = template.slice(start, template.indexOf("\n  # ", start + 1));
  const list = /Headers:\s*\[([^\]]*)\]/.exec(block);
  assert.ok(list, `${policy} lists its headers`);
  return list[1]
    .split("\n")
    .map((line) => line.replace(/#.*/, ""))
    .join("")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
}

/** The origin request policy of the behaviour the door is served by. */
function collectorPolicy(template) {
  const at = template.indexOf("- PathPattern: /api/collector/*");
  assert.ok(at >= 0, "the collector door has its own behaviour");
  const block = template.slice(at, template.indexOf("- PathPattern:", at + 1));
  const ref = /OriginRequestPolicyId: !Ref (\w+)/.exec(block);
  assert.ok(ref, "the collector behaviour names its origin request policy");
  return ref[1];
}

// 0184 read x-collector-binary-sha256 and x-collector-release-key at the
// door, the door tests passed (they call the handler directly), and in
// production every collector read unverified: CloudFront dropped both.
test("every collector header the door reads is forwarded by the edge", () => {
  const template = read("../../../infra/template.yaml");
  // The door is /api/collector/*, never the site API's /api/* (until
  // 2026-11-23 this read the site API's list, which the door never used).
  const forwarded = forwardedHeaders(template, collectorPolicy(template));
  const read_ = new Set(
    read("../src/door.mjs").match(/x-collector-[a-z0-9-]+/g),
  );
  assert.ok(read_.size >= 3, [...read_].join(", "));
  for (const header of read_)
    assert.ok(
      forwarded.includes(header),
      `${header} is read by the door but not forwarded by CloudFront`,
    );
  // CloudFront's quota: at most ten headers in an origin request policy.
  assert.ok(forwarded.length <= 10, `${forwarded.length} headers`);
});
