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
  "/cards",
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
  "/docs/war-decks",
  "/docs/cards",
  "/docs/archetypes",
  "/docs/clocks",
  "/docs/glossary",
  "/docs/methodology",
  "/docs/operators",
  "/docs/verify",
  "/docs/activity",
  "/docs/ladder",
  "/docs/email",
  "/docs/your-account",
  "/docs/follow-a-friend",
  "/docs/watch-a-player",
  "/docs/milestones",
  "/docs/turn-an-email-off",
  "/docs/modes",
  "/docs/sign-in-with-elixir",
  "/docs/json-api",
  "/docs/bring-your-clan",
  "/docs/clan-week",
  "/docs/standing",
  "/docs/clan-actions",
  "/docs/clan-awards",
  "/docs/clan-policy",
  "/updates",
  "/data/growth",
  "/data/collect",
  "/data/now",
  "/data/machines",
  "/support",
];

/** Every card is its own page, built from the catalog: in a test build
 *  the six real rows in test/fixtures/public-cards.json, so the list is
 *  derived from the same data module the build reads, not pinned. */
async function cardPages() {
  const { shapeCards } = await import(
    path.join(repoRoot, "apps/site/src/_lib/cards.mjs")
  );
  const fixture = JSON.parse(
    readFileSync(
      path.join(repoRoot, "apps/site/test/fixtures/public-cards.json"),
      "utf8",
    ),
  );
  return shapeCards(fixture).map((c) => `/cards/${c.id}`);
}

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
  const expected = [
    ...STATIC_PAGES,
    ...(await updatePages()),
    ...(await cardPages()),
  ].sort();
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

/** The edge router's function, evaluated from the template: the rule is
 *  tested as the edge runs it, not as a copy of it here. */
function edgeRouter() {
  const template = readFileSync(
    path.join(repoRoot, "infra/template.yaml"),
    "utf8",
  );
  const from = template.indexOf(
    "FunctionCode: |",
    template.indexOf("\n  SpaRouter:"),
  );
  const code = [];
  for (const line of template.slice(from).split("\n").slice(1)) {
    if (line.trim() && !line.startsWith("        ")) break;
    code.push(line);
  }
  const handler = new Function(`${code.join("\n")}\nreturn handler;`)();
  return (uri) => handler({ request: { uri } }).uri;
}

test(
  "the edge router sends /console, /ladder and /clan to their apps and every other page to its document",
  { skip },
  async () => {
    const route = edgeRouter();
    const doc = (page) => (page === "/" ? "/index.html" : `${page}/index.html`);

    // Every page the site builds is its own document, with or without
    // the trailing slash; the update pages are routed the same way.
    for (const page of [
      ...STATIC_PAGES,
      ...(await updatePages()),
      ...(await cardPages()),
    ]) {
      assert.equal(route(page), doc(page), `${page} is not its document`);
      if (page !== "/")
        assert.equal(route(`${page}/`), doc(page), `${page}/ differs`);
    }

    // The Console owns its prefix, and nothing else: the app resolves
    // its own paths under it. A document the site built under /console
    // could never be reached.
    for (const uri of [
      "/console",
      "/console/",
      "/console/signin",
      "/console/account/overview",
      "/console/explore/player/%2320JJJ2CCRU",
      "/console/data/dashboard",
    ])
      assert.equal(route(uri), "/app.html", `${uri} is not the app`);
    assert.ok(!existsSync(path.join(out, "console")));
    assert.equal(route("/consoles"), "/consoles/index.html");

    // Ladder is a section of the same app beside the Console
    // (2026-09-28): its prefix is the app shell too, and only its prefix.
    for (const uri of ["/ladder", "/ladder/", "/ladder/days", "/ladder/decks"])
      assert.equal(route(uri), "/app.html", `${uri} is not the app`);
    assert.ok(!existsSync(path.join(out, "ladder")));
    assert.equal(route("/ladders"), "/ladders/index.html");

    // Elixir Clan owns /clan the same way, from its own bucket, where its
    // build sits under clan/ (2026-09-28).
    for (const uri of [
      "/clan",
      "/clan/",
      "/clan/J2RGCRVG",
      "/clan/J2RGCRVG/actions",
      "/clan/verify",
    ])
      assert.equal(route(uri), "/clan/index.html", `${uri} is not Clan`);
    assert.equal(
      route("/clan/assets/index-a1b2c3d4.js"),
      "/clan/assets/index-a1b2c3d4.js",
    );
    assert.ok(!existsSync(path.join(out, "clan")));
    assert.equal(route("/clans"), "/clans/index.html");

    // A file is itself, found or honestly missing.
    for (const uri of ["/llms.txt", "/assets/site.css", "/app.html"])
      assert.equal(route(uri), uri);

    // The Console's old addresses at the root are not aliased (Jamie,
    // 2026-09-28): each is a site document the site does not build, so
    // the edge answers it with a miss, never the app shell.
    for (const old of ["/account/overview", "/signin", "/explore", "/admin"]) {
      const target = route(old);
      assert.equal(target, doc(old));
      assert.ok(!existsSync(path.join(out, target)), `${old} resolves`);
    }
  },
);

test(
  "every link the app and the bar give to the site is a page the site builds",
  { skip },
  async () => {
    const app = readFileSync(
      path.join(repoRoot, "apps/web/src/App.jsx"),
      "utf8",
    );
    const links = [
      .../export const STATIC_LINKS = \{([^}]*)\}/
        .exec(app)[1]
        .matchAll(/"([^"]+)"/g),
    ].map((m) => m[1]);
    assert.ok(links.length > 0, "STATIC_LINKS was found");
    const { FAMILY_DOCS, FAMILY_ORIGIN, FAMILY_PRODUCTS } = await import(
      path.join(repoRoot, "packages/ui/src/family.ts")
    );
    const { default: siteNav } = await import(
      path.join(repoRoot, "apps/site/src/_data/siteNav.js")
    );
    const siteLinks = [
      ...siteNav.pages.map((p) => p.path),
      ...siteNav.footer.elixir.links.map((l) => l.path),
      ...siteNav.footer.policy.links.map((l) => l.path),
      FAMILY_DOCS.href.slice(FAMILY_ORIGIN.length),
    ];
    for (const link of [...links, ...siteLinks]) {
      assert.ok(
        STATIC_PAGES.includes(link),
        `the app or the site links to ${link}, which the site does not build`,
      );
    }
    // The Console's own button is the app, on this origin.
    const product = FAMILY_PRODUCTS.find((p) => p.key === "console");
    assert.equal(product.href, `${FAMILY_ORIGIN}/console`);
    assert.equal(edgeRouter()("/console"), "/app.html");
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

test("the bar has one source: the kit's product manifest", async () => {
  // packages/ui/src/family.json is the family's product manifest. The
  // kit's family.ts reads it for the React Chrome (the console, Clan),
  // and _data/familyBar.js hands it to base.njk, which loops over it.
  // Both must read the file itself, never a copy: base.njk used to
  // hand-mirror family.ts, and a copy is how two bars drift into two.
  // Needs no built tree: this is about where the bar comes from.
  const { default: manifest } = await import(
    path.join(repoRoot, "packages/ui/src/family.json"),
    { with: { type: "json" } }
  );
  const { default: familyBar } = await import(
    path.join(repoRoot, "apps/site/src/_data/familyBar.js")
  );
  // The same module, not an equal object: the data file IS the manifest.
  assert.equal(familyBar, manifest, "the site's bar is not the kit's file");

  const kit = await import(path.join(repoRoot, "packages/ui/src/family.ts"));
  assert.equal(kit.FAMILY_WORDMARK, manifest.wordmark);
  assert.equal(kit.FAMILY_ORIGIN, manifest.origin);
  assert.equal(kit.FAMILY_LOGO, manifest.logo);
  assert.deepEqual(
    kit.FAMILY_PRODUCTS.map((p) => p.key),
    manifest.products.map((p) => p.key),
  );
  for (const [i, p] of manifest.products.entries()) {
    // On the family origin a product is a path; elsewhere, an href.
    assert.ok(
      Boolean(p.path) !== Boolean(p.href),
      `${p.key} needs a path or an href, not both`,
    );
    assert.deepEqual(kit.FAMILY_PRODUCTS[i], {
      key: p.key,
      label: p.label,
      href: p.href ?? `${manifest.origin}${p.path}`,
      icon: p.icon,
      ...(p.external ? { external: true } : {}),
      ...(p.game ? { game: true, action: p.action, about: p.about } : {}),
    });
  }
  assert.equal(kit.FAMILY_DOCS.href, `${manifest.origin}${manifest.docs.path}`);
  assert.equal(
    kit.FAMILY_SIGN_IN.href,
    `${manifest.origin}${manifest.signIn.path}`,
  );

  // And the template keeps nothing of its own: no label, key, path or
  // href from the manifest, and no page of the site's own row, is
  // spelled out in it. (The logo's home link is "/" in its own right, so
  // the Home page's path is not a tell.)
  const { default: siteNav } = await import(
    path.join(repoRoot, "apps/site/src/_data/siteNav.js")
  );
  const njk = readFileSync(
    path.join(repoRoot, "apps/site/src/_includes/base.njk"),
    "utf8",
  );
  const spelled = [
    `>${manifest.wordmark}<`,
    ...[...manifest.products, manifest.docs, manifest.signIn].flatMap((p) => [
      `>${p.label}<`,
      ...(p.key ? [`"${p.key}"`] : []),
      ...(p.action ? [`>${p.action}<`] : []),
      `"${p.path ?? p.href}"`,
      `"${p.icon}"`,
    ]),
    ...siteNav.pages.flatMap((t) => [
      `>${t.label}<`,
      `"${t.key}"`,
      ...(t.path === "/" ? [] : [`"${t.path}"`]),
    ]),
    `>${siteNav.tagline}<`,
  ];
  for (const s of spelled)
    assert.ok(!njk.includes(s), `base.njk hand-writes ${s} again`);
});

test(
  "the static bar is the kit's bar: logo, places, Docs, the game, Sign in",
  { skip },
  async () => {
    // What base.njk renders from the manifest, built, against what the
    // kit's Chrome draws from it (packages/ui/test/chrome.test.tsx pins
    // the kit to the same shape): the same links in the same order, or
    // the two bars have drifted into two bars. A document is on this
    // origin, inside no product, and signed out.
    const kit = await import(path.join(repoRoot, "packages/ui/src/family.ts"));
    const { JSDOM } = await import("jsdom");
    const site = new JSDOM(read("index.html")).window.document;
    /** The bar's links, each as what a reader and a crawler get. */
    const links = (sel) =>
      [...site.querySelectorAll(sel)].map((a) => ({
        text: a.textContent.trim().replace(/\s+/g, " "),
        href: a.getAttribute("href"),
        target: a.getAttribute("target"),
        label: a.getAttribute("aria-label"),
        current: a.getAttribute("aria-current"),
        glyphs: a.querySelectorAll("svg").length,
      }));
    const link = (text, href, more = {}) => ({
      text,
      href,
      target: null,
      label: null,
      current: null,
      glyphs: 1,
      ...more,
    });
    const places = kit.FAMILY_PRODUCTS.filter((p) => !p.game).map((p) =>
      link(p.label, kit.onOrigin(p.href)),
    );
    const docs = link(
      kit.FAMILY_DOCS.label,
      kit.onOrigin(kit.FAMILY_DOCS.href),
    );
    const games = kit.FAMILY_PRODUCTS.filter((p) => p.game).map((p) =>
      link(p.action, p.href, {
        target: "_blank",
        label: kit.gameLabel(p),
        glyphs: 2,
      }),
    );
    const signIn = link(
      kit.FAMILY_SIGN_IN.label,
      kit.onOrigin(kit.FAMILY_SIGN_IN.href),
    );

    assert.deepEqual(links(".chrome__home"), [
      link(kit.FAMILY_WORDMARK, "/", {
        label: `${kit.FAMILY_WORDMARK} home`,
        glyphs: 0,
      }),
    ]);
    assert.equal(
      site.querySelector(".chrome__logo").getAttribute("src").split("?")[0],
      kit.FAMILY_LOGO,
    );
    assert.deepEqual(links(".chrome__nav a"), places);
    assert.deepEqual(links(".chrome__end a"), [docs, ...games, signIn]);
    assert.deepEqual(links("#chrome-sheet a"), [...places, docs, ...games]);
    for (const a of site.querySelectorAll('.chrome a[target="_blank"]'))
      assert.equal(a.getAttribute("rel"), "noopener");
    // The same blocks, in the same order, as the kit's.
    assert.deepEqual(
      [...site.querySelector(".chrome__inner").children].map((el) =>
        el.getAttribute("class"),
      ),
      [
        "chrome__home",
        "chrome__rule",
        "chrome__nav",
        "chrome__menu",
        "chrome__end",
      ],
    );
    // Inside nothing, the narrow button says Menu.
    assert.equal(
      site.querySelector(".chrome__menu").getAttribute("aria-label"),
      "Menu",
    );

    // A doc lights Docs, on the bar and in the sheet, and nothing else;
    // its narrow button names Docs, as the kit's does.
    const docsPage = new JSDOM(read("docs/index.html")).window.document;
    assert.deepEqual(
      [
        ...docsPage.querySelectorAll('.chrome__inner [aria-current="page"]'),
      ].map((a) => a.getAttribute("href")),
      ["/docs"],
    );
    assert.deepEqual(
      [...docsPage.querySelectorAll('#chrome-sheet [aria-current="page"]')].map(
        (a) => a.getAttribute("href"),
      ),
      ["/docs"],
    );
    assert.equal(
      docsPage.querySelector(".chrome__menu").getAttribute("aria-label"),
      `Product: ${kit.FAMILY_DOCS.label}`,
    );
  },
);

test(
  "the site's own pages are a row under the bar, lit by the page, and a footer",
  { skip },
  async () => {
    const { default: siteNav } = await import(
      path.join(repoRoot, "apps/site/src/_data/siteNav.js")
    );
    const { JSDOM } = await import("jsdom");
    for (const [page, key] of [
      ["index.html", "home"],
      ["cards/index.html", "cards"],
      ["cards/26000000/index.html", "cards"],
      ["data/index.html", "data"],
      ["updates/index.html", "updates"],
      ["support/index.html", "support"],
    ]) {
      const doc = new JSDOM(read(page)).window.document;
      const row = doc.querySelector('nav.sitenav[aria-label="Site"]');
      assert.deepEqual(
        [...row.querySelectorAll("a")].map((a) => [
          a.textContent,
          a.getAttribute("href"),
        ]),
        siteNav.pages.map((p) => [p.label, p.path]),
        page,
      );
      assert.deepEqual(
        [...row.querySelectorAll('[aria-current="page"]')].map((a) =>
          a.getAttribute("href"),
        ),
        [siteNav.pages.find((p) => p.key === key).path],
        `${page} lights ${key}`,
      );
      // No page of the site's is on the bar: the bar holds places.
      assert.equal(doc.querySelectorAll(".chrome__tab").length, 0);
    }
    // A doc has Docs lit on the bar and the docs' own rail instead.
    assert.equal(
      new JSDOM(read("docs/index.html")).window.document.querySelector(
        ".sitenav",
      ),
      null,
    );
    // The footer, on every page: the places, the site, the policies, and
    // Supercell's note. Family is on no menu (Jamie, 2026-09-29), and its
    // pages are still built.
    for (const page of ["index.html", "docs/index.html", "family/index.html"]) {
      const doc = new JSDOM(read(page)).window.document;
      const foot = doc.querySelector("footer.sitefoot");
      assert.ok(foot, `${page} has the footer`);
      assert.match(foot.textContent, /not endorsed by Supercell/);
      const hrefs = [...foot.querySelectorAll("a")].map((a) =>
        a.getAttribute("href"),
      );
      for (const want of ["/console", "/ladder", "/clan", "/docs/privacy"])
        assert.ok(hrefs.includes(want), `${page} footer links ${want}`);
      assert.ok(!hrefs.some((h) => h.startsWith("/family")), page);
      assert.ok(
        ![...doc.querySelectorAll(".chrome a, .sitenav a")].some((a) =>
          a.getAttribute("href").startsWith("/family"),
        ),
        `${page} links Family from a menu`,
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
      path.join(repoRoot, "packages/tools/src/tools.mjs")
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
      path.join(repoRoot, "packages/tools/src/tools.mjs")
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
      path.join(repoRoot, "packages/tools/src/tools.mjs")
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
  // Scoped to the doc body below the lede: the top bar and the
  // breadcrumb carry inline icons, so the page's FIRST <svg> is an
  // icon rather than the diagram this test is about.
  const page = read("docs/architecture/index.html");
  const html = page.slice(page.indexOf('class="docs__lede"'));
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
  const TARGET = 'href="/console/signin?request"';
  for (const page of ["index.html", "examples/play/index.html"]) {
    assert.ok(read(page).includes(TARGET), `${page} has no way to ask`);
  }
  // Two on the home page: the hero and the panel that explains the gate.
  assert.equal(home.split(TARGET).length - 1, 2);

  // /console/signin is the app's, and the app is what answers there;
  // the edge sends the whole prefix to it (the router test above).
  assert.ok(!existsSync(path.join(out, "console/signin/index.html")));
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
          // No font CDN: Inter is self-hosted, so a reader's page load
          // tells no third party what they read.
          "elixir.poapkings.com",
          // The family's product button in the top bar that lives
          // elsewhere: a plain link, not a script, so the CSP is untouched.
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
  // pushState and skip /console/signin.
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
      await import("../../../packages/tools/src/tools/shared.mjs");
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
  "the narrow menu opens and closes, and the account slot stays on the bar",
  { skip },
  async () => {
    // The static half's menu is hand-written JavaScript, so it gets the
    // same exercise the app's React one does. At narrow width the places,
    // Docs and the game fold behind one button; the account slot (here,
    // always Sign in) is never in there.
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
    assert.deepEqual(
      [...sheet.querySelectorAll("a")].map((a) => a.getAttribute("href")),
      ["/console", "/ladder", "/clan", "/docs", "https://drop.poapkings.com/"],
    );
    assert.ok(!/Sign in/.test(sheet.textContent), "Sign in is in the menu");

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
      path.join(repoRoot, "packages/tools/src/tools.mjs")
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
    ["family/discord/index.html", "/docs/agents"],
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

test(
  "the feeds' ids are each update's own page: unique, stable, never a position (#73)",
  { skip },
  async () => {
    const FEED_ITEMS = 50; // _data/feedItems.js
    const xml = read("feed.xml");
    const guids = [
      ...xml.matchAll(/<guid isPermaLink="true">([^<]+)<\/guid>/g),
    ].map((m) => m[1]);
    assert.equal(
      guids.length,
      [...xml.matchAll(/<item>/g)].length,
      "every item has a permalink GUID",
    );
    assert.ok(guids.length > 0 && guids.length <= FEED_ITEMS);
    assert.equal(new Set(guids).size, guids.length, "GUIDs are unique");
    const pages = new Set(await updatePages());
    for (const guid of guids) {
      // Until #73 the GUID was /updates#<date>-<n>: renumbered on every
      // ship, and a fragment that resolved to nothing.
      assert.doesNotMatch(guid, /#/, guid);
      const page = guid.replace("https://elixir.poapkings.com", "");
      assert.ok(pages.has(page), `${guid} is an update's page`);
      assert.ok(existsSync(path.join(out, page.slice(1), "index.html")), guid);
    }
    // Contract versions are in the stream, as on /updates.
    assert.match(xml, /<category>contract<\/category>/);
    // No double escaping: autoescape already escapes the title.
    assert.doesNotMatch(xml, /&amp;amp;/);

    const feed = JSON.parse(read("feed.json"));
    assert.equal(feed.version, "https://jsonfeed.org/version/1.1");
    assert.equal(feed.feed_url, "https://elixir.poapkings.com/feed.json");
    assert.deepEqual(
      feed.items.map((i) => i.id),
      guids,
      "feed.json carries the same items as feed.xml",
    );
    for (const item of feed.items) {
      assert.equal(item.url, item.id);
      assert.ok(item.title && item.content_html, item.id);
      assert.ok(!Number.isNaN(Date.parse(item.date_published)), item.id);
    }
  },
);

test(
  "the cards index lists every catalog card, A to Z, each a link to its page",
  { skip },
  async () => {
    // Canvas 2026-09-29 (CardsIndex). The list is baked from the catalog
    // and reads true with JavaScript off; cards-index.js redraws it by
    // mode from /api/public/cards. No season number is baked: a test
    // build's fixture carries none, and the page invents none.
    const { JSDOM } = await import("jsdom");
    const doc = new JSDOM(read("cards/index.html")).window.document;
    const tiles = [...doc.querySelectorAll("[data-cards-grid] a.card-tile")];
    const ids = (await cardPages()).map((p) => p.split("/").pop());
    assert.deepEqual(
      tiles.map((a) => a.getAttribute("href")),
      ids.map((id) => `/cards/${id}/`),
    );
    const names = tiles.map(
      (a) => a.querySelector(".card-tile__name").textContent,
    );
    assert.deepEqual(
      names,
      [...names].sort((a, b) => a.localeCompare(b)),
    );
    const knight = tiles.find((a) => a.href.endsWith("/26000000/"));
    assert.equal(
      knight.querySelector("img.card-art__img").getAttribute("src"),
      "/assets/cards/26000000-128.png",
    );
    assert.equal(knight.querySelector(".card-elixir").textContent, "3");
    assert.match(
      knight.querySelector(".card-tile__kind").textContent,
      /^Common troop · Evo and Hero$/,
    );
    // The controls wait for the script's data; the numbers are its.
    assert.ok(doc.querySelector("[data-cards-controls]").hidden);
    assert.equal(doc.querySelectorAll(".card-tile__pct").length, 0);
    assert.ok(
      doc.querySelector('script[src^="/assets/cards-index"]'),
      "the index loads its script",
    );
    assert.ok(existsSync(path.join(out, "assets/cards-index.js")));
  },
);

test(
  "a card's page draws its art, its kind and the call an agent makes",
  { skip },
  async () => {
    // Canvas 2026-09-29 (CardPage). Knight has an Evo and a Hero, so its
    // art is the Hero's, as the canvas draws it.
    const { JSDOM } = await import("jsdom");
    const doc = new JSDOM(read("cards/26000000/index.html")).window.document;
    const root = doc.querySelector("[data-card]");
    assert.equal(root.getAttribute("data-card"), "26000000");
    assert.equal(doc.querySelector("h1").textContent, "Knight");
    const crumb = doc.querySelector('nav[aria-label="Breadcrumb"]');
    assert.equal(crumb.querySelector("a").getAttribute("href"), "/cards/");
    const img = root.querySelector(".card-figure img.card-art__img");
    assert.equal(
      img.getAttribute("src"),
      "/assets/cards/26000000_hero-285.png",
    );
    assert.equal(img.getAttribute("alt"), "Hero Knight");
    assert.equal(
      root.querySelector(".card-art__form--hero").textContent,
      "Hero",
    );
    assert.match(
      root.textContent.replace(/\s+/g, " "),
      /Common troop · 3 elixir · also an Evo and a Hero/,
    );
    assert.match(
      root.querySelector(".card-call").textContent,
      /cards_card \{ card: "Knight", segment: "corpus", mode: "ranked" \}/,
    );
    // A card with no other form draws its own art and no ribbon.
    const fireball = new JSDOM(read("cards/28000000/index.html")).window
      .document;
    assert.equal(
      fireball.querySelector(".card-figure img").getAttribute("src"),
      "/assets/cards/28000000-285.png",
    );
    assert.equal(fireball.querySelector(".card-art__form"), null);
    // The CSP forbids inline script, handlers included.
    for (const page of await cardPages()) {
      const html = read(`${page.slice(1)}/index.html`);
      assert.doesNotMatch(html, /\son(error|load|click)=/, page);
    }
    assert.ok(existsSync(path.join(out, "assets/cards-live.js")));
  },
);
