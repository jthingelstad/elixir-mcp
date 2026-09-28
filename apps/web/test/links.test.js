import { test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A ratchet on links (review 2026-09-27 §7.5). Explore promises that
 * "every record has a real URL", yet 65 anchors in the console and the
 * kit rendered with a click handler and no href: no keyboard focus, no
 * new tab, no copying the link, and axe does not flag one. Both counts
 * here are pinned at zero:
 *
 * - every anchor has an href (a place to go is the kit's Link; an
 *   action is `<button className="link">`);
 * - no anchor in the console carries its own click handler, because a
 *   handler that calls preventDefault takes a Cmd-click's new tab away.
 *   The kit's Link, Rail and Chrome leave a modified click to the
 *   browser (isPlainClick); the console uses them.
 *
 * oxlint's jsx-a11y/anchor-is-valid guards the first as well; this
 * test is the one that also sees the kit's TypeScript sources.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const CONSOLE = path.resolve(here, "../src");
const KIT = path.resolve(here, "../../../packages/ui/src");

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory()
      ? walk(p)
      : /\.[jt]sx$/.test(name)
        ? [p]
        : [];
  });
}

/** Comments out, so prose that names an anchor is not one. */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

/** Every `<a ...>` opening tag in a file, with its line. */
function anchors(file) {
  const source = code(readFileSync(file, "utf8"));
  const found = [];
  const open = /<a(?=[\s>])/g;
  let m;
  while ((m = open.exec(source))) {
    let depth = 0;
    let quote = null;
    let i = m.index + 2;
    for (; i < source.length; i++) {
      const c = source[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    found.push({
      at: `${path.basename(file)}:${source.slice(0, m.index).split("\n").length}`,
      tag: source.slice(m.index, i + 1),
    });
  }
  return found;
}

const all = [...walk(CONSOLE), ...walk(KIT)].flatMap(anchors);

test("the scan sees the kit's own anchors", () => {
  // A scan that found nothing would pass everything.
  expect(all.some((a) => a.at.startsWith("Link.tsx"))).toBe(true);
});

test("every anchor in the console and the kit has an href", () => {
  const bare = all
    .filter((a) => !/\bhref=/.test(a.tag) && !/\{\.\.\./.test(a.tag))
    .map((a) => a.at);
  expect(bare, `anchors without an href: ${bare.join(", ")}`).toEqual([]);
});

test("no console anchor takes its own click (use the kit's Link)", () => {
  const handled = walk(CONSOLE)
    .flatMap(anchors)
    .filter((a) => /\bonClick=/.test(a.tag))
    .map((a) => a.at);
  expect(handled, `anchors with onClick: ${handled.join(", ")}`).toEqual([]);
});
