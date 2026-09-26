// @vitest-environment node
import { COLLECTOR_RELEASE_KEYS } from "@elixir-mcp/contracts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "vitest";
import {
  fingerprintOf,
  keyDigest,
  randomartText,
} from "../src/lib/randomart.js";

/** What ssh-keygen itself draws for a key line: the reference, run
 *  fresh, so the page's picture is held to the tool, not to a paste. */
function sshKeygenPicture(line) {
  const dir = mkdtempSync(path.join(tmpdir(), "randomart-"));
  try {
    const file = path.join(dir, "key.pub");
    writeFileSync(file, `${line} test\n`);
    const out = execFileSync("ssh-keygen", ["-lvf", file], {
      encoding: "utf8",
    });
    const lines = out.trimEnd().split("\n");
    return {
      fingerprint: lines[0].split(" ")[1],
      picture: lines.slice(1).join("\n"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the release key's randomart is ssh-keygen's, character for character", async () => {
  for (const key of COLLECTOR_RELEASE_KEYS) {
    const digest = await keyDigest(key.line);
    const ref = sshKeygenPicture(key.line);
    expect(fingerprintOf(digest)).toBe(key.fingerprint);
    expect(fingerprintOf(digest)).toBe(ref.fingerprint);
    expect(randomartText(digest)).toBe(ref.picture);
  }
});

// Walls, corners and the visit cap are where a port goes wrong; a
// release key exercises few of them. Keys made on the spot do.
test("fresh keys draw the same picture ssh-keygen does", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "randomart-keys-"));
  try {
    for (let i = 0; i < 12; i += 1) {
      const file = path.join(dir, `k${i}`);
      execFileSync("ssh-keygen", [
        "-q",
        "-t",
        "ed25519",
        "-N",
        "",
        "-C",
        "t",
        "-f",
        file,
      ]);
      const line = execFileSync("cut", ["-d", " ", "-f1,2", `${file}.pub`], {
        encoding: "utf8",
      }).trim();
      const digest = await keyDigest(line);
      expect(randomartText(digest)).toBe(sshKeygenPicture(line).picture);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
