import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

/** The headers the site API's CloudFront origin request policy forwards:
 *  a whitelist, so a header not on it is stripped before any Lambda. */
function forwardedHeaders(template) {
  const start = template.indexOf("  SiteApiOriginRequestPolicy:");
  const block = template.slice(start, template.indexOf("\n  # ", start + 1));
  const list = /Headers:\s*\[([^\]]*)\]/.exec(block);
  assert.ok(list, "SiteApiOriginRequestPolicy lists its headers");
  return list[1]
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
}

// 0184 read x-collector-binary-sha256 and x-collector-release-key at the
// door, the door tests passed (they call the handler directly), and in
// production every collector read unverified: CloudFront dropped both.
test("every collector header the door reads is forwarded by the edge", () => {
  const forwarded = forwardedHeaders(read("../../../infra/template.yaml"));
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
