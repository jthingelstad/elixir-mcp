import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "vitest";

/**
 * One time format on member pages (Jamie, 2026-11-05): a member page says
 * when through `when`, `whenDay`, `calendar` or `clock` from `useClock`, and
 * never prints a raw timestamp or an ISO date. This keeps the old ways out.
 * Staff pages keep their wall clock, and a slice that fills a date input or
 * a date key stays: those are named here, with the reason.
 */
const ROOT = resolve(import.meta.dirname, "../../..");
const PATHS = ["apps/web/src"];
const STAFF = /\/views\/Admin|\/views\/admin\//;
const OLD = [
  "\\bstamp\\(",
  "\\bstampDay\\(",
  "\\bstampTime\\(",
  "toLocaleDateString\\(",
  "toLocaleTimeString\\(",
  "_at\\??\\.slice\\(0, 10\\)",
].join("|");

function hits() {
  let out = "";
  try {
    out = execFileSync(
      "grep",
      ["-rnE", OLD, "--include=*.jsx", "--include=*.js", ...PATHS],
      { cwd: ROOT, encoding: "utf8" },
    );
  } catch (err) {
    if (err.status !== 1) throw err;
  }
  return out
    .split("\n")
    .filter(Boolean)
    .filter((l) => !STAFF.test(l));
}

test("member pages use the one time format", () => {
  // MemberActivity's `stamp` is its own name for `when`, with "Unknown".
  const left = hits().filter((l) => !l.includes("views/MemberActivity.jsx"));
  expect(left).toEqual([]);
});
