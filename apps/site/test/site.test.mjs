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
  "/data",
  "/family",
  "/examples/play",
  "/examples/deck",
  "/examples/ladder",
  "/examples/friends",
  "/examples/clan",
  "/examples/roster",
  "/examples/scout",
  "/examples/recap",
  "/examples/discord",
  "/examples/publish",
  "/examples/collector",
  "/family/drop",
  "/family/agent",
  "/family/discord",
  "/family/crdocs",
  "/family/mcp",
  "/family/royaledle",
  "/family/royaleapi",
  "/docs",
  "/docs/about",
  "/docs/quickstart",
  "/docs/connections",
  "/docs/agents",
  "/docs/integrations",
  "/docs/roles",
  "/docs/choosing-a-tool",
  "/docs/protocol",
  "/docs/tools",
  "/docs/tools/account",
  "/docs/tools/players",
  "/docs/tools/battles",
  "/docs/tools/cards",
  "/docs/tools/clans",
  "/docs/tools/war",
  "/docs/tools/collections",
  "/docs/tools/live",
  "/docs/tools/feed",
  "/docs/tools/service",
  "/docs/tools/help",
  "/docs/responses",
  "/docs/events",
  "/docs/privacy",
  "/docs/terms",
  "/docs/limits",
  "/docs/architecture",
  "/docs/recording",
  "/docs/battles",
  "/docs/clocks",
  "/docs/glossary",
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
      // A shared link renders a card from these; a page without them
      // shares as a bare URL.
      for (const tag of [
        '<meta property="og:title" content="',
        '<meta property="og:description" content="',
        '<meta property="og:image" content="https://elixir.poapkings.com/assets/og.png"',
        '<meta name="twitter:card" content="summary_large_image"',
      ])
        assert.ok(html.includes(tag), `${page} lacks ${tag}`);
    }
  },
);

test("the share image is a 1200x630 PNG", { skip }, () => {
  const png = readFileSync(path.join(out, "assets/og.png"));
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  // IHDR: width and height are the two big-endian uint32s at 16 and 20.
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

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

test("versioned examples follow the generated contract", { skip }, () => {
  const version = JSON.parse(read("tools.json")).contract_version;
  for (const rel of ["docs/agents/index.html", "docs/protocol/index.html"]) {
    assert.ok(
      read(rel).includes(version),
      `${rel} does not show the current contract ${version}`,
    );
  }
});

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
  // Scoped to the doc body: the top bar now carries an inline icon, so
  // the page's FIRST <svg> is the Console button rather than the
  // diagram this test is about.
  const page = read("docs/architecture/index.html");
  const html = page.slice(page.indexOf("<article"));
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

test(
  "published methodology uses the reader floors and discloses statistical limits",
  { skip },
  async () => {
    const { PILOT_METHODOLOGY } =
      await import("../../../services/mcp/src/level-curve.mjs");
    const page = read("docs/methodology/index.html");
    assert.ok(
      page.includes(
        `${PILOT_METHODOLOGY.curve_min_observations} player-battle observations`,
      ),
    );
    assert.ok(
      page.includes(
        `${PILOT_METHODOLOGY.player_min_battles} battles in supported bins`,
      ),
    );
    assert.ok(
      page.includes(
        `${PILOT_METHODOLOGY.monthly_min_battles} battles in supported bins`,
      ),
    );
    assert.ok(!page.includes("{{ statistics"));
    assert.match(
      page,
      /not a calibrated error estimate or confidence interval for Pilot Score/,
    );
    assert.match(page, /unchanged counts do not identify an unchanged curve/);
    assert.match(page, /draws and unresolved outcomes are excluded/i);
    // The meta floors and the corpus prior are published from the same
    // declaration the SQL readers use (0.39.0).
    const { META_METHODOLOGY } =
      await import("../../../services/mcp/src/tools/shared.mjs");
    assert.ok(
      page.includes(
        `${META_METHODOLOGY.segment_min_decided} decided observations`,
      ),
    );
    assert.match(page, /whole recorded corpus/);
    assert.match(page, /itemizes what the window held and left out/);
  },
);

test(
  "the published response example is a valid current metadata envelope",
  { skip },
  async () => {
    const { assertResponseMeta } = await import("@elixir-mcp/contracts");
    const html = read("docs/responses/index.html");
    const encoded = /<code class="language-json">([\s\S]*?)<\/code>/.exec(
      html,
    )?.[1];
    assert.ok(encoded, "the response guide must include a JSON example");
    const decoded = encoded.replace(
      /&(quot|amp|lt|gt|#39);/g,
      (_, entity) =>
        ({ quot: '"', amp: "&", lt: "<", gt: ">", "#39": "'" })[entity],
    );
    assertResponseMeta(JSON.parse(decoded));
  },
);

test(
  "the narrow menu opens, closes, and never swallows Console",
  { skip },
  async () => {
    // The static half's menu is hand-written JavaScript, so it gets the
    // same exercise the app's React one does. Two properties: the six tabs
    // collapse behind one button, and the CONSOLE BUTTON IS NOT IN THERE —
    // it is the way into the product, and a menu is the wrong place for it.
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM(read("index.html"), { runScripts: "outside-only" });
    const { window } = dom;
    const script = readFileSync(
      path.join(repoRoot, "apps/site/src/assets/chrome-menu.js"),
      "utf8",
    );
    window.eval(script);

    const button = window.document.querySelector("[data-chrome-menu]");
    const sheet = window.document.getElementById("chrome-sheet");
    assert.ok(button && sheet, "the narrow menu is not in the markup");
    assert.equal(sheet.dataset.open, "false");
    // Present with JavaScript off too: a crawler and a reader without it
    // both still find every destination.
    assert.equal(sheet.querySelectorAll("a").length, 6);
    assert.ok(!/Console/.test(sheet.textContent), "Console is inside the menu");

    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    assert.equal(sheet.dataset.open, "true");
    assert.equal(button.getAttribute("aria-expanded"), "true");

    // Escape, and a tap on the page behind it, both close it. A sheet you
    // can only dismiss by finding the same small button again is a trap.
    window.document.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape" }),
    );
    assert.equal(sheet.dataset.open, "false");

    button.dispatchEvent(new window.Event("click", { bubbles: true }));
    window.document.body.dispatchEvent(
      new window.Event("click", { bubbles: true }),
    );
    assert.equal(sheet.dataset.open, "false");
  },
);

test(
  "every tool a transcript names is in the registry, and links to its heading",
  { skip },
  async () => {
    // The home page and the use-case pages promise that every tool under
    // a transcript window is real. Eight of the design's placeholder
    // names were not (2026-09-10); the copy claimed they were anyway.
    const { makeRegistry } = await import(
      path.join(repoRoot, "services/mcp/src/tools.mjs")
    );
    const names = new Set(
      makeRegistry()
        .declarations()
        .map((d) => d.name),
    );
    const pages = [
      "index.html",
      ...STATIC_PAGES.filter((p) => p.startsWith("/examples/")).map(
        (p) => `${p.slice(1)}/index.html`,
      ),
    ];
    let seen = 0;
    for (const rel of pages) {
      const html = read(rel);
      for (const m of html.matchAll(
        /<a class="mono" href="([^"]+)">([a-z_]+)<\/a>/g,
      )) {
        const [, href, name] = m;
        seen += 1;
        assert.ok(names.has(name), `${rel} names ${name}, not in the registry`);
        assert.match(
          href,
          new RegExp(`^/docs/tools/[a-z-]+#${name}$`),
          `${rel}: ${name} should link to its own heading`,
        );
        const [family, anchor] = href.replace("/docs/tools/", "").split("#");
        assert.ok(
          read(`docs/tools/${family}/index.html`).includes(`id="${anchor}"`),
          `${href} has no heading to land on`,
        );
      }
    }
    assert.ok(seen >= 14, `expected transcript tool links, saw ${seen}`);
  },
);

test("every family project has somewhere to go", { skip }, () => {
  // /family described eight products and linked to none of them: the
  // data carried the links and the template never rendered them. One
  // page per product now, each linking to the thing itself.
  const html = read("family/index.html");
  for (const label of ["POAP KINGS", "Elixir Drop", "Royaledle", "RoyaleAPI"])
    assert.ok(html.includes(label), `the family rail lost ${label}`);
  for (const [rel, href] of [
    ["family/index.html", "https://poapkings.com"],
    ["family/drop/index.html", "https://drop.poapkings.com"],
    ["family/agent/index.html", "/docs/agents"],
    ["family/royaledle/index.html", "https://royaledle.org"],
    ["family/royaleapi/index.html", "https://royaleapi.com"],
  ])
    assert.ok(
      read(rel).includes(`href="${href}"`),
      `${rel} has no link to ${href}`,
    );
  // Third-party projects carry their own byline, never ours.
  const theirs = read("family/royaledle/index.html");
  assert.match(theirs, /Not ours/);
  assert.doesNotMatch(theirs, /Run by POAP KINGS/);
  assert.match(theirs, /More we like/);
  assert.match(read("family/drop/index.html"), /Also in the family/);
});

test(
  "updates carry a kind, a month anchor and a version where one shipped",
  { skip },
  () => {
    const html = read("updates/index.html");
    assert.match(html, /<h2 id="2026-09"/);
    assert.match(html, /data-kind="shipped"/);
    assert.match(html, /data-kind="contract"/);
    assert.ok(existsSync(path.join(out, "assets/updates-filter.js")));
    assert.ok(existsSync(path.join(out, "assets/rail-anchors.js")));
  },
);
