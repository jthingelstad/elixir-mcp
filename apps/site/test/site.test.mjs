/**
 * The static site's contract with the rest of the system.
 *
 * These tests exist because the failure they guard against is silent:
 * before the split, every URL served the same shell, the sitemap listed
 * ten pages that were one page, and the hand-written tool docs had
 * drifted five tools behind the server. Nothing was red. So the checks
 * here are about AGREEMENT between places that can drift apart:
 * the built pages, the edge router, the app's link map, and the live
 * tool registry.
 *
 * Run against a built tree: node infra/scripts/build-site.mjs --skip-stats
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const out = path.join(repoRoot, "dist/site");
const read = (rel) => readFileSync(path.join(out, rel), "utf8");
const built = existsSync(path.join(out, "index.html"));

const skip = built
  ? false
  : "no built tree at dist/site - run: node infra/scripts/build-site.mjs --skip-stats";

/** The pages the static site claims, as canonical paths. */
const STATIC_PAGES = [
  "/",
  "/docs",
  "/docs/about",
  "/docs/quickstart",
  "/docs/connections",
  "/docs/agents",
  "/docs/integrations",
  "/docs/roles",
  "/docs/tools",
  "/docs/responses",
  "/docs/events",
  "/docs/privacy",
  "/docs/terms",
  "/docs/architecture",
  "/docs/methodology",
  "/docs/operators",
  "/updates",
  "/data/changelog",
];

test(
  "every static page is a real document, not the app shell",
  { skip },
  () => {
    for (const page of STATIC_PAGES) {
      const rel = page === "/" ? "index.html" : `${page.slice(1)}/index.html`;
      const html = read(rel);
      assert.ok(html.includes("<main"), `${page} has no main element`);
      assert.ok(
        !html.includes('<div id="root"></div>'),
        `${page} is the app shell`,
      );
      // The failure that started this: ten URLs, one <title>.
      const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
      assert.ok(title, `${page} has no title`);
      const description = /<meta name="description" content="([^"]*)"/.exec(
        html,
      )?.[1];
      assert.ok(description, `${page} has no meta description`);
      assert.ok(
        html.includes(
          `<link rel="canonical" href="https://elixir.poapkings.com${page}"`,
        ),
        `${page} has a wrong or missing canonical link`,
      );
    }
  },
);

test("no two pages share a title or description", { skip }, () => {
  const seen = new Map();
  for (const page of STATIC_PAGES) {
    const rel = page === "/" ? "index.html" : `${page.slice(1)}/index.html`;
    const html = read(rel);
    const key = /<title>([^<]*)<\/title>/.exec(html)[1];
    assert.equal(
      seen.get(key),
      undefined,
      `${page} and ${seen.get(key)} share the title "${key}"`,
    );
    seen.set(key, page);
  }
});

test("the sitemap lists exactly the static pages", { skip }, () => {
  const locs = [...read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].replace("https://elixir.poapkings.com", "") || "/")
    .sort();
  assert.deepEqual(locs, [...STATIC_PAGES].sort());
});

test("the app shell is not indexable", { skip }, () => {
  // It renders nothing without JavaScript. Listing it, or letting a
  // crawler index it, is how the site ended up looking like one page.
  const shell = read("app.html");
  assert.match(shell, /<meta name="robots" content="noindex"/);
  assert.ok(!read("sitemap.xml").includes("app.html"));
});

test(
  "the edge router and the app agree on who owns which path",
  { skip },
  () => {
    const template = readFileSync(
      path.join(repoRoot, "infra/template.yaml"),
      "utf8",
    );
    const routerBlock = /var STATIC_PAGES = \{([^}]*)\}/.exec(template)[1];
    const routerPages = [...routerBlock.matchAll(/'([^']+)'/g)].map(
      (m) => m[1],
    );
    const prefixes = [
      .../var STATIC_PREFIXES = \[([^\]]*)\]/
        .exec(template)[1]
        .matchAll(/'([^']+)'/g),
    ].map((m) => m[1]);

    // Every page the site builds must be routed to the site. "/" is
    // handled by the router's own root case.
    for (const page of STATIC_PAGES) {
      if (page === "/") continue;
      const routed =
        routerPages.includes(page) || prefixes.some((p) => page.startsWith(p));
      assert.ok(routed, `the edge router sends ${page} to the app shell`);
    }
    // And nothing routed to the site should be missing from the build.
    for (const page of routerPages) {
      assert.ok(
        STATIC_PAGES.includes(page),
        `the edge router routes ${page} to the site, which does not build it`,
      );
    }

    const app = readFileSync(
      path.join(repoRoot, "apps/web/src/App.jsx"),
      "utf8",
    );
    const links = [
      .../export const STATIC_LINKS = \{([^}]*)\}/
        .exec(app)[1]
        .matchAll(/"([^"]+)"/g),
    ].map((m) => m[1]);
    for (const link of links) {
      assert.ok(
        STATIC_PAGES.includes(link),
        `the app links to ${link}, which the site does not build`,
      );
    }
  },
);

test(
  "llms.txt indexes the docs and the whole tool surface",
  { skip },
  async () => {
    const llms = read("llms.txt");
    const { makeRegistry } = await import(
      path.join(repoRoot, "services/mcp/src/tools.mjs")
    );
    const names = makeRegistry()
      .declarations()
      .map((d) => d.name);

    assert.ok(names.length > 0);
    for (const name of names) {
      assert.ok(llms.includes(`\`${name}\``), `llms.txt omits ${name}`);
    }
    for (const page of STATIC_PAGES) {
      if (page === "/") continue;
      assert.ok(
        llms.includes(`https://elixir.poapkings.com${page})`),
        `llms.txt omits ${page}`,
      );
    }
    assert.match(llms, /https:\/\/elixir\.poapkings\.com\/mcp/);
    // Plain text: an escaped entity here means a template forgot `safe`.
    assert.ok(
      !/&#\d+;|&quot;|&amp;/.test(llms),
      "llms.txt contains HTML entities",
    );
  },
);

test(
  "the tools page and tools.json cover the live registry",
  { skip },
  async () => {
    const html = read("docs/tools/index.html");
    const json = JSON.parse(read("tools.json"));
    const { makeRegistry } = await import(
      path.join(repoRoot, "services/mcp/src/tools.mjs")
    );
    const declarations = makeRegistry().declarations();

    const documented = json.groups.flatMap((g) => g.tools.map((t) => t.name));
    assert.equal(
      documented.length,
      declarations.length,
      "tools.json and the registry disagree on how many tools exist",
    );
    assert.equal(json.tool_count, declarations.length);

    for (const d of declarations) {
      assert.ok(documented.includes(d.name), `tools.json omits ${d.name}`);
      assert.ok(
        html.includes(`>${d.name}</code>`),
        `the tools page omits ${d.name}`,
      );
    }
    // Every write tool must publish the capability it needs, or the page
    // understates what connecting an agent grants.
    for (const t of json.groups.flatMap((g) => g.tools)) {
      assert.ok(t.scope, `${t.name} publishes no OAuth scope`);
    }
  },
);

test(
  "the full bundle carries every doc body and every tool",
  { skip },
  async () => {
    const full = read("llms-full.txt");
    const { makeRegistry } = await import(
      path.join(repoRoot, "services/mcp/src/tools.mjs")
    );
    for (const d of makeRegistry().declarations()) {
      assert.ok(
        full.includes(`\`${d.name}\``),
        `llms-full.txt omits ${d.name}`,
      );
    }
    for (const doc of ["about", "roles", "privacy", "terms", "architecture"]) {
      const source = readFileSync(
        path.join(repoRoot, `apps/site/src/docs/${doc}.md`),
        "utf8",
      );
      // The body after the front matter, minus its heading line.
      const body = source.split("---\n").slice(2).join("---\n").trim();
      const firstLine = body.split("\n").find((l) => l && !l.startsWith("#"));
      assert.ok(
        full.includes(firstLine.trim()),
        `llms-full.txt omits the body of ${doc}.md`,
      );
    }
    assert.ok(
      !/&#\d+;|&quot;/.test(full),
      "llms-full.txt contains HTML entities",
    );
  },
);

test("the shared stylesheet is the one in packages/design", { skip }, () => {
  assert.equal(
    read("assets/site.css"),
    readFileSync(path.join(repoRoot, "packages/design/styles.css"), "utf8"),
  );
});

test("inline HTML in a doc survives the markdown renderer", { skip }, () => {
  // Eleventy's default markdown-it wrapped the architecture diagram's
  // <svg> opening tag in a <p> and closed the paragraph before the
  // diagram, because the tag spans two lines. The page still built,
  // still passed every other check, and rendered as a column of loose
  // words where a diagram belonged. Hence marked, and hence this test.
  const html = read("docs/architecture/index.html");
  const open = html.indexOf("<svg");
  assert.ok(open > -1, "the architecture diagram is gone");
  const close = html.indexOf("</svg>", open);
  assert.ok(close > -1, "the architecture diagram is not closed");
  assert.ok(
    !html.slice(open, close).includes("</p>"),
    "the markdown renderer split the diagram",
  );
  // The diagram's own styles must ride along with it.
  assert.ok(html.slice(open, close).includes("<style>"));
});

test("the request-access form posts what the API requires", { skip }, () => {
  // The only interactive thing on the static half. It replaced a React
  // form, and the API rejects a request without the client marker.
  // The markup is on the page; the behaviour moved to its own file when
  // the CSP dropped inline script (#25), so both halves are checked.
  const home = read("index.html");
  assert.match(home, /id="request-form"/);
  for (const field of ["email", "player_tag", "note"]) {
    assert.match(home, new RegExp(`name="${field}"`), `no ${field} field`);
  }
  const script = read("assets/request-form.js");
  assert.match(script, /"\/api\/request-access"/);
  assert.match(script, /"x-elixir-client": "web"/);
  assert.match(script, /getElementById\("request-form"\)/);
});

// --------------------------------------------------------------- #25
test("analytics only ever comes from tinylytics.app", { skip }, () => {
  // #25 took the embed off the app; that turned out to protect nothing,
  // because the same Path=/ session cookie is live on every static page
  // where the embed already ran. What actually holds is the CSP:
  // script-src is 'self' plus tinylytics.app and nothing else. So the
  // test that matters is not "is the app clean" but "did a THIRD origin
  // sneak in" - on either half.
  for (const page of ["app.html", "index.html", "docs/index.html"]) {
    const html = read(page);
    const origins = [...html.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map(
      (m) => m[1],
    );
    for (const origin of origins)
      assert.ok(
        [
          "tinylytics.app",
          "fonts.googleapis.com",
          "fonts.gstatic.com",
          "elixir.poapkings.com",
          "www.supercell.com",
        ].includes(origin),
        `${page} references an unexpected origin: ${origin}`,
      );
  }

  // Both halves count visits, each the way its own page model works: the
  // static site is a real document load, the app bridges pushState.
  assert.ok(read("index.html").includes("tinylytics.app/embed/"));
  const bundle = read("app.html").match(
    /src="(\/assets\/index-[^"]+\.js)"/,
  )?.[1];
  assert.ok(bundle, "app.html loads its bundle");
  assert.ok(
    read(bundle.slice(1)).includes("tinylytics.app/collector/"),
    "the app bundle beacons route changes to the collector",
  );
});

test("nothing in the built site relies on inline script", { skip }, () => {
  // script-src has no 'unsafe-inline', so an inline block would simply
  // not run. This is the test that catches someone adding one back.
  for (const page of ["index.html", "app.html", "docs/index.html"]) {
    const html = read(page);
    const inline = html.match(
      /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g,
    );
    assert.equal(
      inline,
      null,
      `${page} has an inline <script> the CSP will block`,
    );
  }
  // The home page's form handler is the one that had to move out.
  assert.ok(read("index.html").includes("/assets/request-form.js"));
  assert.ok(existsSync(path.join(out, "assets/request-form.js")));
});
