import { test, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Three retired words stay out of the front end's names (2026-11-14):
 *
 * - **Console**, the signed-in app until it folded into Home and Settings
 *   (2026-11-12). The app is "the app", its page wrapper `PageShell`.
 * - **Family**, the set of sibling products the shared top bar once
 *   switched between. The bar and its manifest are the shell
 *   (`packages/ui/src/shell.json`, `SHELL_*`, the site's `shell` global).
 * - **Tracking**, the old word for following. The page is Players
 *   (`/settings/players`) and its doc keys are `players*`.
 *
 * Like stats-name.test.js, this looks only at the shapes a name takes:
 * file names, identifiers, class names and doc keys. Prose may still tell
 * the history ("the Console folded"). These stay, because the word is
 * still true or is stored or on the wire:
 *
 * - `console.*` calls and `page.on("console")`: the browser's console.
 * - The feedback area value `console` (and `ladder`): stored on every
 *   feedback row and sent by the help drawer; the label reads "Elixir".
 * - The analytics event `console.invite_copied`: a Tinylytics event name
 *   with history behind it.
 * - Tests that pin the dead `/console` and `/ladder` addresses as a miss.
 * - The family role and tier (`family` in limits and Usage), the family
 *   OAuth client (`family_oauth_client`, `family_id`, `oauth_family`),
 *   card archetype families, tool families (`toolFamily`,
 *   `.docrail__family`), the mode family and `font-family`.
 * - `trackEvent`, typographic tracking, and the wire names that say
 *   tracked (`tracked_since`, `players_tracked`, `clans_tracked`,
 *   `leads_tracked_clan`, `signals.tracking`, `not_tracked`, the mail kind
 *   `tracking_report`). Their renames are contract changes.
 */
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(web, "../..");

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "dist") return [];
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const roots = [
  "apps/web/src",
  "apps/web/test",
  "apps/web/e2e",
  "packages/ui/src",
  "packages/ui/test",
  "packages/design/src",
  "apps/site/src/_data",
  "apps/site/src/_includes",
  "apps/site/src/assets",
  "apps/site/test",
];
const files = roots
  .flatMap((d) => walk(path.join(repo, d)))
  // Updates are dated entries: their slugs tell the history.
  .filter((f) => !f.includes(`${path.sep}_data${path.sep}updates${path.sep}`));
const code = files.filter((f) => /\.(?:[cm]?[jt]sx?|css|njk|json)$/.test(f));

test("no front-end file is named for the Console, the family or tracking", () => {
  for (const gone of ["family.json", "family.ts"])
    expect(existsSync(path.join(repo, "packages/ui/src", gone))).toBe(false);
  expect(existsSync(path.join(repo, "apps/site/src/_data/familyBar.js"))).toBe(
    false,
  );
  const named = files
    .map((f) => path.relative(repo, f))
    .filter((f) => /console|family|tracking/i.test(path.basename(f)));
  expect(named).toEqual([]);
});

test("no identifier, class or doc key carries a retired word", () => {
  const shapes = [
    // ConsoleShell, CONSOLE; consoleSignedIn, isConsole.
    /\bConsole[A-Z]\w*/,
    /\bCONSOLE\w*/,
    /\b(?:is|use)Console\b/,
    /\bconsole[A-Z]\w*/,
    // FAMILY_ORIGIN, FamilyProduct, familyBar, the family manifest import.
    /\bFAMILY_\w*/,
    /\bFamily[A-Z]\w*/,
    /\bfamily(?:Bar|Products?|Tabs?)\b/,
    /ui\/(?:src\/)?family\b/,
    // A class: .console-x, .tracking-x, .disclaimer__family (now __maker).
    /(?<![\w/-])(?:console|tracking)-[a-z]/,
    /disclaimer__family\b/,
    // The help drawer's doc keys.
    /["'`](?:agent:)?tracking(?::|["'`]\s*:)/,
  ];
  const hits = [];
  for (const f of code) {
    if (f.endsWith("retired-names.test.js")) continue;
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (shapes.some((rx) => rx.test(line)))
          hits.push(`${path.relative(repo, f)}:${i + 1}: ${line.trim()}`);
      });
  }
  expect(hits).toEqual([]);
});
