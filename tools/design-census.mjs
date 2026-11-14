/** Reproducible source counts, excluding comments and Tailwind aliases. */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const ref = process.argv[2];
const read = (file) =>
  ref
    ? execFileSync("git", ["show", `${ref}:${file}`], { encoding: "utf8" })
    : readFileSync(file, "utf8");
const clean = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const css = clean(read("packages/design/src/components.css"));
const root = clean(read("packages/design/src/tokens.css")).match(
  /:root\s*\{([\s\S]*?)\n\}/,
)[1];
const count = (pattern, text) => [...text.matchAll(pattern)].length;
const files = execFileSync(
  "git",
  ["ls-files", "apps/web/src", "packages/ui/src"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter((f) => /\.[jt]sx?$/.test(f));
const inline = (prefix) =>
  files
    .filter((f) => f.startsWith(prefix))
    .reduce((n, f) => n + count(/style=\{/g, read(f)), 0);
console.log(
  JSON.stringify(
    {
      rootTokens: count(/--[\w-]+\s*:/g, root),
      typeTokens: count(/--t-[\w-]+\s*:/g, root),
      radiusTokens: count(/--r-[\w-]+\s*:/g, root),
      selectorRules: [...css.matchAll(/([^{}]+)\{/g)].filter(
        (m) => !m[1].trim().startsWith("@"),
      ).length,
      componentBytes: Buffer.byteLength(
        read("packages/design/src/components.css"),
      ),
      componentDeclarations: count(/[\w-]+\s*:[^;{}]+;/g, css),
      literalSpacingPixels: [
        ...css.matchAll(
          /(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z]+)?\s*:\s*([^;{}]+);/g,
        ),
      ].reduce((n, m) => n + count(/\b\d+(?:\.\d+)?px/g, m[1]), 0),
      componentShadows: count(/box-shadow\s*:/g, css),
      componentGradients: count(/(?:linear|radial|conic)-gradient\(/g, css),
      appInlineStyles: inline("apps/web/"),
      kitInlineStyles: inline("packages/ui/"),
    },
    null,
    2,
  ),
);
