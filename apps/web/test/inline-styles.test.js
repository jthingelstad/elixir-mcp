import { test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A ratchet on inline styles. The console reached past its stylesheet
 * 605 times (2026-09-13) - `style={{ marginLeft: "auto" }}` where a
 * utility class now exists - and every one is a rule no other screen
 * can share. The count may only go DOWN: retire them as a view is
 * touched (`className="ml-auto"`), then lower the number here. Dynamic
 * values (a width from a prop, a tone's colour) are the legitimate
 * remainder and are what the floor will settle at.
 */
const CEILING = 588;

const src = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src",
);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory()
      ? walk(p)
      : /\.[jt]sx?$/.test(name)
        ? [p]
        : [];
  });
}

test(`inline styles in the console never exceed ${CEILING}`, () => {
  const counts = walk(src).map((f) => [
    path.relative(src, f),
    (readFileSync(f, "utf8").match(/style=\{/g) ?? []).length,
  ]);
  const total = counts.reduce((n, [, c]) => n + c, 0);
  const worst = counts
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([f, c]) => `${f}: ${c}`)
    .join(", ");
  expect(total, `inline styles: ${total} (${worst})`).toBeLessThanOrEqual(
    CEILING,
  );
});
