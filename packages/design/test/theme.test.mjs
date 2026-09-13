import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");

/** Compile the design's sources with ONE extra @source inline() of
 *  candidate classes, so the test sees what a consumer would get for
 *  those classes without depending on what the apps happen to use. */
function compile(candidates) {
  // Inside the package, not the OS tmpdir: Tailwind resolves the
  // "tailwindcss/..." imports from the entry file's own directory.
  const dir = mkdtempSync(path.join(pkg, ".test-"));
  const entry = path.join(dir, "entry.css");
  writeFileSync(
    entry,
    [
      "@layer theme, base, components, utilities;",
      '@import "tailwindcss/theme.css" layer(theme);',
      '@import "tailwindcss/utilities.css" layer(utilities);',
      `@source inline("${candidates.join(" ")}");`,
      '@source not inline("outline");',
      '@import "../src/tokens.css";',
      '@import "../src/components.css" layer(components);',
      "",
    ].join("\n"),
  );
  const out = path.join(dir, "out.css");
  try {
    execFileSync("npx", ["tailwindcss", "-i", entry, "-o", out], {
      cwd: pkg,
      stdio: "pipe",
    });
    return readFileSync(out, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the tokens are the utility vocabulary: colours, type, radii, fonts, the breakpoint", () => {
  const css = compile([
    "bg-ground",
    "text-ink-faint",
    "border-line-strong",
    "rounded-panel",
    "font-display",
    "text-body",
    "text-label",
    "shadow-float",
    "max-w-content",
    "wide:flex",
    "max-wide:hidden",
    "mt-2",
    "gap-4",
  ]);
  assert.match(css, /\.bg-ground \{\s*background-color: var\(--ground\)/);
  assert.match(css, /\.text-ink-faint \{\s*color: var\(--ink-faint\)/);
  assert.match(
    css,
    /\.border-line-strong \{\s*border-color: var\(--line-strong\)/,
  );
  assert.match(css, /\.rounded-panel \{\s*border-radius: var\(--r-panel\)/);
  assert.match(css, /\.font-display \{\s*font-family: var\(--font-display\)/);
  assert.match(css, /\.text-body \{[^}]*font-size: var\(--t-body\)/);
  assert.match(
    css,
    /\.text-body \{[^}]*line-height: var\(--tw-leading, var\(--lh-body\)\)/,
  );
  assert.match(css, /\.shadow-float \{[^}]*var\(--shadow-float\)/);
  assert.match(css, /\.max-w-content \{\s*max-width: var\(--content-max\)/);
  assert.match(css, /@media \(width >= 900px\)/);
  assert.match(css, /@media \(width < 900px\)/);
  // 4px unit = the design's --s-* scale.
  assert.match(css, /\.mt-2 \{\s*margin-top: calc\(var\(--spacing\) \* 2\)/);
});

test("Tailwind's own palette, type scale, radii and shadows do not exist here", () => {
  const css = compile([
    "bg-red-500",
    "text-slate-300",
    "text-sm",
    "text-2xl",
    "rounded-lg",
    "shadow-md",
    "font-serif",
    "md:flex",
  ]);
  for (const cls of [
    "bg-red-500",
    "text-slate-300",
    "text-sm",
    "text-2xl",
    "rounded-lg",
    "shadow-md",
    "font-serif",
  ])
    assert.ok(
      !css.includes(`.${cls} `) && !css.includes(`.${cls}{`),
      `${cls} leaked`,
    );
  assert.ok(!css.includes("md\\:flex"), "Tailwind's md breakpoint leaked");
});

test("the compiled sheet emits no theme variables of its own: :root in tokens.css is the only source of a value", () => {
  const css = compile(["bg-ground", "font-display"]);
  const theme = css.match(/@layer theme \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const vars = [...theme.matchAll(/--[\w-]+(?=:)/g)].map((m) => m[0]);
  assert.deepEqual(vars, ["--spacing"]);
});

test("the `outline` utility is refused: it shares a name with the design's definition-list component", () => {
  const css = compile(["outline", "outline-2"]);
  const utilities = css.match(/@layer utilities \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.ok(!/\n  \.outline \{/.test(utilities), ".outline utility present");
  assert.match(css, /\.outline-2 \{/);
  // and the component is still there
  assert.match(css, /@layer components \{[\s\S]*\.outline dt \{/);
});
