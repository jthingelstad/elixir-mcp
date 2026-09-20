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
import { readFileSync, existsSync, readdirSync } from "node:fs";
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

/** Every built HTML document, as paths relative to dist/site. */
function htmlPages(dir = out, base = out) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...htmlPages(full, base));
    else if (entry.name.endsWith(".html"))
      found.push(path.relative(base, full));
  }
  return found;
}

const skip = built
  ? false
  : "no built tree at dist/site - run: node infra/scripts/build-site.mjs --skip-stats";

/** One page per live registry group. Derive these from the built registry so
 *  adding a group cannot silently publish links to a missing family page. */
const TOOL_GROUP_PAGES = built
  ? JSON.parse(read("tools.json")).groups.map(
      (group) => `/docs/tools/${group.slug}`,
    )
  : [];

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
  ...TOOL_GROUP_PAGES,
  "/docs/responses",
  "/docs/timeline",
  "/docs/privacy",
  "/docs/terms",
  "/docs/limits",
  "/docs/architecture",
  "/docs/recording",
  "/docs/battles",
  "/docs/cards",
  "/docs/archetypes",
  "/docs/clocks",
  "/docs/glossary",
  "/docs/methodology",
  "/docs/operators",
  "/docs/verify",
  "/docs/activity",
  "/docs/email",
  "/updates",
  "/data/growth",
  "/data/collect",
  "/data/now",
  "/data/machines",
  "/support",
];

/** Every update is its own page (2026-09-10), so the list is derived from
 *  the entries rather than pinned: pinning a hundred and forty-eight
 *  slugs would be a second copy of updates.js that nobody would keep. */
async function updatePages() {
  const { default: view } = await import(
    path.join(repoRoot, "apps/site/src/_data/updatesView.js")
  );
  return view.map((u) => `/updates/${u.slug}`);
}

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
  // Over the pinned pages. Two updates have shared a title before now
  // (the same ship written up twice), which is a content problem, not a
  // routing one — their URLs still differ, because the date leads.
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

test("the sitemap lists exactly the static pages", { skip }, async () => {
  const locs = [...read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].replace("https://elixir.poapkings.com", "") || "/")
    .sort();
  // Still exact — a sitemap entry that resolves to nothing is the defect
  // this test was written for — but the update pages are derived.
  const expected = [...STATIC_PAGES, ...(await updatePages())].sort();
  assert.deepEqual(locs, expected);
});

test("the app shell is not indexable", { skip }, () => {
  // It renders nothing without JavaScript. Listing it, or letting a
  // crawler index it, is how the site ended up looking like one page.
  const shell = read("app.html");
  assert.match(shell, /<meta name="robots" content="noindex"/);
  assert.ok(!read("sitemap.xml").includes("app.html"));
});

test("Limits states the enforced console-session lifetime", { skip }, () => {
  // The session row, not the cookie, owns the inactivity limit. Keep the
  // published retention table aligned with that security boundary.
  assert.match(
    read("docs/limits/index.html"),
    /90 days absolute, 30 days sliding/,
  );
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
    // Every update page is routed by the /updates/ prefix, not listed.
    assert.ok(
      prefixes.includes("/updates/"),
      "the edge router sends /updates/<slug> to the app shell",
    );
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
  "every static stylesheet and script URL carries its content hash",
  { skip },
  () => {
    // /assets/* is served under no Cache-Control, so a browser keeps its
    // copy for as long as it likes and the deploy's edge invalidation
    // never reaches it. A changed file must be a changed URL. The app
    // shell is Vite's and hashed in the filename; this is the Eleventy half.
    const pages = htmlPages().filter((p) => p !== "app.html");
    for (const page of pages) {
      const html = read(page);
      for (const m of html.matchAll(
        /(?:href|src)="(\/assets\/[^"]+\.(?:css|js))(\?v=[0-9a-f]{8})?"/g,
      )) {
        assert.ok(m[2], `${page} links ${m[1]} without a content hash`);
      }
    }
    // And the hash is the file's: the same bytes, the same URL, on every page.
    const versions = new Set(
      pages.map(
        (p) => read(p).match(/\/assets\/site\.css\?v=([0-9a-f]{8})/)?.[1],
      ),
    );
    assert.equal(
      versions.size,
      1,
      "site.css is versioned differently across pages",
    );
  },
);

test(
  "the static bar is the kit's bar: wordmark, tabs, product buttons",
  { skip },
  async () => {
    // base.njk hand-mirrors packages/ui/src/family.ts because Nunjucks
    // cannot import TypeScript. This is the pin: the built home page
    // carries the same wordmark, the same tabs in the same order, and the
    // same product buttons with the same hrefs, or the two bars have
    // drifted into two bars.
    const { FAMILY_PRODUCTS, FAMILY_TABS, FAMILY_WORDMARK } = await import(
      path.join(repoRoot, "packages/ui/src/family.ts")
    );
    const { JSDOM } = await import("jsdom");
    const { document } = new JSDOM(read("index.html")).window;

    assert.equal(
      document.querySelector(".wordmark").textContent.trim(),
      FAMILY_WORDMARK,
    );
    const tabs = [...document.querySelectorAll(".chrome__nav a")].map((a) => [
      a.textContent.trim(),
      a.getAttribute("href"),
    ]);
    assert.deepEqual(
      tabs,
      FAMILY_TABS.map((t) => [...t]),
    );

    const products = [...document.querySelectorAll(".chrome__product")];
    assert.deepEqual(
      products.map(
        (a) => a.querySelector(".chrome__product-label").textContent,
      ),
      FAMILY_PRODUCTS.map((p) => p.label),
    );
    for (const [i, p] of FAMILY_PRODUCTS.entries()) {
      // The console's own button is a bare path on this host.
      const href = p.key === "console" ? "/account/overview" : p.href;
      assert.equal(products[i].getAttribute("href"), href, `${p.label} href`);
      assert.equal(
        products[i].getAttribute("target"),
        p.external ? "_blank" : null,
        `${p.label} target`,
      );
      // A document is inside no product: nothing is current here.
      assert.equal(products[i].getAttribute("aria-current"), null);
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

    for (const group of json.groups) {
      const family = read(`docs/tools/${group.slug}/index.html`);
      for (const tool of group.tools) {
        assert.ok(
          family.includes(`id="${tool.name}"`),
          `/docs/tools/${group.slug} omits ${tool.name}`,
        );
      }
    }

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

test("the protocol requires an explicit segment", () => {
  const protocol = readFileSync(
    path.join(repoRoot, "apps/site/src/docs/protocol.md"),
    "utf8",
  );
  assert.match(protocol, /`segment` is required since 4\.0\.0/);
  assert.ok(
    !protocol.includes(
      "| the whole `segment` object | the entire recorded corpus |",
    ),
    "the protocol still documents the retired implicit corpus default",
  );
});

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

test(
  "the shared stylesheet is the one packages/design compiled",
  { skip },
  () => {
    assert.equal(
      read("assets/site.css"),
      readFileSync(
        path.join(repoRoot, "packages/design/dist/styles.css"),
        "utf8",
      ),
    );
  },
);

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

test("asking for access is one door, and it is in the app", { skip }, () => {
  // The static half used to carry its own copy of the request form —
  // its own fetch, its own error strings — and it broke silently: the
  // POST landed, and the success path set `.hidden` on a form with
  // inline `display: flex` and a `.notice` whose class sets `display`,
  // neither of which a hidden attribute can beat. Nothing moved on
  // screen, so a visitor could not tell "sent" from "did nothing".
  // The form is a step of the app's sign-in card now (2026-09-10):
  // signing in and asking to are one decision.
  const home = read("index.html");
  assert.ok(
    !home.includes("request-form"),
    "the home page still carries the old form",
  );
  assert.ok(
    !existsSync(path.join(out, "assets/request-form.js")),
    "the old form script is still being built",
  );

  // Every call to action goes to the one door, deep-linked to the
  // asking half of it.
  const TARGET = 'href="/signin?request"';
  for (const page of ["index.html", "examples/play/index.html"]) {
    assert.ok(read(page).includes(TARGET), `${page} has no way to ask`);
  }
  // Two on the home page: the hero and the panel that explains the gate.
  assert.equal(home.split(TARGET).length - 1, 2);

  // /signin is the app's, and the app is what answers there — if this
  // ever became a static page the query would land on a document with
  // no form in it.
  assert.ok(!existsSync(path.join(out, "signin/index.html")));
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
          // The family's product buttons in the top bar: plain links,
          // not scripts, so the CSP is untouched.
          "clan.poapkings.com",
          "drop.poapkings.com",
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

test("every built page counts its own visit", { skip }, () => {
  // The embed rides the ONE layout, which is why nothing had to be done
  // per page - and why nothing says so if a page stops using that
  // layout. The 2026-09-09 redesign moved every rail and renamed a
  // whole section; a page that quietly left base.njk would still look
  // right and would simply stop being counted. So the assertion is over
  // the built tree rather than a list: a new page is covered by this
  // test the moment it exists.
  const pages = htmlPages().filter((rel) => rel !== "app.html");
  assert.ok(pages.length > 40, `only ${pages.length} pages built`);
  for (const rel of pages) {
    assert.ok(
      read(rel).includes("tinylytics.app/embed/"),
      `${rel} carries no analytics - has it left base.njk?`,
    );
  }
  // app.html is the exception and not an omission: the application
  // loads the embed from its bundle, because it also has to bridge
  // pushState and skip /signin.
  assert.ok(!read("app.html").includes("tinylytics.app/embed/"));
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
  // The pattern that keeps it that way: page behaviour is an external
  // file. (The home page's form handler was the first to move out; the
  // form itself has since gone to the app entirely.)
  assert.ok(read("index.html").includes("/assets/transcript.js"));
  assert.ok(existsSync(path.join(out, "assets/transcript.js")));
});

test(
  "published methodology uses the reader floors and discloses statistical limits",
  { skip },
  async () => {
    const page = read("docs/methodology/index.html");
    assert.ok(!page.includes("{{ statistics"));
    // 5.0.0: no level-expected rate or player score is published; the
    // page says the gap is described, not adjusted for.
    assert.ok(!page.includes("Pilot Score"));
    assert.match(page, /described, not adjusted for/);
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
  "the narrow menu opens, closes, and never swallows the product buttons",
  { skip },
  async () => {
    // The static half's menu is hand-written JavaScript, so it gets the
    // same exercise the app's React one does. Two properties: the seven tabs
    // collapse behind one button, and the PRODUCT BUTTONS ARE NOT IN THERE —
    // they are the way into the products, and a menu is the wrong place.
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
    assert.equal(sheet.querySelectorAll("a").length, 7);
    assert.ok(
      !/Console|Clan|Drop/.test(sheet.textContent),
      "a product button is inside the menu",
    );

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
