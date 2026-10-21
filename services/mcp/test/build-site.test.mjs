/**
 * The site build's merge and its refusal to ship a broken tree
 * (infra/scripts/build-site.mjs), on small trees in a temporary
 * directory. The real tree is built and walked by apps/site's tests.
 */
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { mergeSite, verifySite } from "../../../infra/scripts/build-site.mjs";

function tree(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
}

const CSS = `@font-face { src: url("/assets/fonts/Inter-latin.woff2") }`;
const SITE = {
  "index.html": "<main>home</main>",
  "404.html": "<main>missing</main>",
  "docs/index.html": "<main>docs</main>",
  "robots.txt": "Sitemap: https://elixir.poapkings.com/sitemap.xml",
  "sitemap.xml":
    "<loc>https://elixir.poapkings.com/</loc><loc>https://elixir.poapkings.com/docs</loc>",
  "llms.txt":
    "[Docs](https://elixir.poapkings.com/docs) [MCP](https://elixir.poapkings.com/mcp) [API](https://elixir.poapkings.com/api/v1/x)",
  "llms-full.txt": "all",
  "tools.json": "{}",
  "feed.xml": "<feed/>",
  "feed.json": "{}",
  "assets/site.css": CSS,
  "assets/og.png": "png",
  "assets/elixir-logo-96.webp": "webp",
  "assets/fonts/Inter-latin.woff2": "font",
};
const WEB = {
  "index.html": '<script src="/assets/index-BTm8TzAt.js"></script>',
  "assets/index-BTm8TzAt.js": "app",
  "assets/fonts/Inter-latin.woff2": "font",
  "favicon.ico": "ico",
};

function workspace(t, { site = SITE, web = WEB } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "build-site-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dirs = {
    siteDist: path.join(root, "site"),
    webDist: path.join(root, "web"),
    outDir: path.join(root, "out"),
    designCss: path.join(root, "styles.css"),
  };
  tree(dirs.siteDist, site);
  tree(dirs.webDist, web);
  writeFileSync(dirs.designCss, CSS);
  return dirs;
}

test("build-site: the app layers onto the static site, its shell renamed app.html", (t) => {
  const dirs = workspace(t);
  mergeSite(dirs);
  const out = (rel) => readFileSync(path.join(dirs.outDir, rel), "utf8");
  assert.equal(out("index.html"), SITE["index.html"]);
  assert.equal(out("app.html"), WEB["index.html"]);
  assert.equal(out("assets/index-BTm8TzAt.js"), "app");
  assert.equal(out("favicon.ico"), "ico");
  const { problems, files, pages } = verifySite(dirs);
  assert.deepEqual(problems, []);
  assert.equal(files.size, Object.keys(SITE).length + 3);
  assert.equal(pages, 2);
});

test("build-site: two builds writing different bytes to one path, or no app shell, refuse the merge", (t) => {
  assert.throws(
    () =>
      mergeSite(
        workspace(t, {
          web: { ...WEB, "assets/fonts/Inter-latin.woff2": "other" },
        }),
      ),
    /both builds emit different content at: assets\/fonts\/Inter-latin\.woff2/,
  );
  const noShell = Object.fromEntries(
    Object.entries(WEB).filter(([rel]) => rel !== "index.html"),
  );
  assert.throws(
    () => mergeSite(workspace(t, { web: noShell })),
    /produced no index\.html/,
  );
});

test("build-site: each kind of broken tree is named, never shipped", (t) => {
  const without = (files, rel) =>
    Object.fromEntries(Object.entries(files).filter(([key]) => key !== rel));
  for (const [why, site, want, web = WEB] of [
    [
      "a required file missing",
      { ...SITE, "feed.json": undefined },
      ["feed.json is missing"],
    ],
    [
      "a sitemap entry with no page",
      {
        ...SITE,
        "sitemap.xml": "<loc>https://elixir.poapkings.com/gone</loc>",
      },
      ["sitemap lists missing /gone"],
    ],
    [
      "a dangling llms.txt link",
      { ...SITE, "llms.txt": "[x](https://elixir.poapkings.com/docs/nope)" },
      ["llms.txt links missing /docs/nope"],
    ],
    [
      "a font the stylesheet names, shipped by neither build",
      { ...SITE, "assets/fonts/Inter-latin.woff2": undefined },
      ["site.css references missing /assets/fonts/Inter-latin.woff2"],
      without(WEB, "assets/fonts/Inter-latin.woff2"),
    ],
    [
      "a file the publisher has no content type for",
      { ...SITE, "assets/logo.svg": "<svg/>" },
      [
        "assets/logo.svg has no content type in lib/site-publish.mjs CONTENT_TYPES",
      ],
    ],
  ]) {
    const files = Object.fromEntries(
      Object.entries(site).filter(([, body]) => body !== undefined),
    );
    const dirs = workspace(t, { site: files, web });
    mergeSite(dirs);
    assert.deepEqual(verifySite(dirs).problems, want, why);
  }
  // The shared stylesheet must be packages/design's own bytes.
  const drift = workspace(t);
  mergeSite(drift);
  writeFileSync(drift.designCss, `${CSS} /* newer */`);
  assert.deepEqual(verifySite(drift).problems, [
    "assets/site.css differs from packages/design/dist/styles.css",
  ]);
  // The app shell naming a chunk the merge does not have.
  const shell = workspace(t, {
    web: {
      ...WEB,
      "index.html": '<script src="/assets/index-MISSING0.js"></script>',
    },
  });
  mergeSite(shell);
  assert.deepEqual(verifySite(shell).problems, [
    "app.html references missing /assets/index-MISSING0.js",
  ]);
});
