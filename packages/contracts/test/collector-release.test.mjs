import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COLLECTOR_RELEASE_KEYS,
  COLLECTOR_RELEASE_SIGNER,
} from "../dist/index.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

test("each release key's fingerprint is its line's", () => {
  assert.ok(COLLECTOR_RELEASE_KEYS.length > 0);
  for (const key of COLLECTOR_RELEASE_KEYS) {
    const [type, blob] = key.line.split(" ");
    assert.equal(type, "ssh-ed25519");
    const digest = createHash("sha256")
      .update(Buffer.from(blob, "base64"))
      .digest("base64")
      .replace(/=+$/, "");
    assert.equal(key.fingerprint, `SHA256:${digest}`);
  }
});

// The operators page is the second place an operator checks the key
// (the first is the collector's SECURITY.md): it must print this one.
test("the operators page publishes every release key and its fingerprint", () => {
  const page = readFileSync(
    path.join(repoRoot, "apps/site/src/docs/operators.md"),
    "utf8",
  );
  for (const key of COLLECTOR_RELEASE_KEYS) {
    assert.ok(
      page.includes(`${key.line} ${COLLECTOR_RELEASE_SIGNER}`),
      `operators.md is missing ${key.line}`,
    );
    assert.ok(page.includes(key.fingerprint), key.fingerprint);
  }
});
