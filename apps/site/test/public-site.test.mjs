/**
 * The public site after the redesign (step 7): the links that must keep
 * working, the 404 page's forwarding, the pages' promises. Needs the built
 * tree (`npm test` here builds it first).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { movedTo } from "../../web/src/lib/moved.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const out = path.join(repoRoot, "dist/site");
const site = path.join(repoRoot, "apps/site/src");
const skip = existsSync(path.join(out, "index.html"))
  ? false
  : "no built tree at dist/site";
const read = (rel) => readFileSync(path.join(out, rel), "utf8");
const DISCLAIMER =
  "This material is unofficial and is not endorsed by Supercell. For more information see Supercell’s Fan Content Policy: www.supercell.com/fan-content-policy.";

/** Every built HTML page: its URL, with the app's merged shell left out. */
function pages(dir = out) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...pages(full));
    else if (entry.name === "index.html")
      found.push(`/${path.relative(out, dir).split(path.sep).join("/")}`);
  }
  return found;
}

/** Paths the app answers, not the static tree. */
const APP =
  /^\/(home|signin|settings|console|ladder|clan|battle|data\/service|api|mcp|oauth)(\/|$)/;

async function forwards() {
  return (await import(`${site}/_data/docForwards.js`)).default;
}

const isHistory = (page) => /^\/updates\/\d{4}-\d{2}-\d{2}-/.test(page);
const inHistoryMonth = (page) => /^\/updates(\/|$)/.test(page);

test(
  "every internal link in the docs and the site resolves, fragment included",
  { skip },
  async () => {
    const moved = await forwards();
    const ids = new Map();
    const idsOf = (url) => {
      if (!ids.has(url)) {
        const rel = url === "/" ? "index.html" : `${url.slice(1)}/index.html`;
        const html = existsSync(path.join(out, rel)) ? read(rel) : null;
        ids.set(
          url,
          html === null
            ? null
            : new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])),
        );
      }
      return ids.get(url);
    };
    const broken = [];
    for (const page of pages()) {
      // Old Updates entries are history: they say what was true that day.
      if (isHistory(page) || inHistoryMonth(page)) continue;
      const html = read(
        page === "/" ? "index.html" : `${page.slice(1)}/index.html`,
      );
      const hrefs = [...html.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)].map(
        (m) => m[1],
      );
      for (const raw of new Set(hrefs)) {
        if (!raw.startsWith("/") && !raw.startsWith("#")) continue;
        const [pathPart, fragment] = raw.replaceAll("&amp;", "&").split("#");
        const url = (pathPart.split("?")[0] || page).replace(/(.)\/$/, "$1");
        if (APP.test(url)) continue;
        if (/\.[a-z]+$/.test(url)) {
          if (!existsSync(path.join(out, url))) broken.push(`${page}: ${raw}`);
          continue;
        }
        const known = idsOf(url);
        if (known === null) {
          broken.push(`${page}: ${raw}`);
          continue;
        }
        if (!fragment || known.has(fragment)) continue;
        const key = `${url.split("/").pop()}#${fragment}`;
        if (!moved[key]) broken.push(`${page}: ${raw}`);
      }
    }
    assert.deepEqual(broken, []);
  },
);

test("every doc forward lands on a real section", { skip }, async () => {
  const moved = await forwards();
  for (const [from, to] of Object.entries(moved)) {
    const [page, fragment] = to.split("#");
    const html = read(`docs/${page}/index.html`);
    assert.ok(html.includes(` id="${fragment}"`), `${from} -> ${to} is gone`);
    assert.ok(
      existsSync(path.join(out, `docs/${from.split("#")[0]}/index.html`)),
      `${from}: its old page is gone, so the browser cannot follow it`,
    );
  }
});

test(
  "every static page carries the disclaimer, word for word",
  { skip },
  () => {
    for (const page of [...pages(), "/404"]) {
      const rel =
        page === "/404"
          ? "404.html"
          : page === "/"
            ? "index.html"
            : `${page.slice(1)}/index.html`;
      const text = new JSDOM(read(rel)).window.document.body.textContent
        .replace(/\s+/g, " ")
        .trim();
      assert.ok(text.includes(DISCLAIMER), `${page} lost the disclaimer`);
      assert.match(text, /a POAP KINGS product/, page);
    }
  },
);

test("member docs use step 1's words", { skip: false }, () => {
  // The banned list from the design contract. Reference pages may name a real
  // field; privacy and terms change only with Jamie's word; a word inside code
  // is a field name.
  const banned = [
    /\bConsole\b/,
    /\bcorpus\b/i,
    /capture incomplete/i,
    /recorded-quiet/i,
    /\bcomprehensive\b/i,
    /Evidence held/,
    /Mean level gap/,
    /4-card cycle/,
    /\bsnapshots?\b/i,
    /\bobserved\b/i,
    /—/,
  ];
  const skipPages = new Set(["privacy.md", "terms.md"]);
  const dir = path.join(site, "docs");
  const hits = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md") || skipPages.has(name)) continue;
    const prose = readFileSync(path.join(dir, name), "utf8")
      .replace(/^---[\s\S]*?\n---/, "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`]*`/g, "")
      .replace(/\{\{[\s\S]*?\}\}/g, "")
      .replace(/\{%[\s\S]*?%\}/g, "");
    for (const re of banned)
      if (re.test(prose)) hits.push(`${name}: ${re} (${prose.match(re)[0]})`);
  }
  assert.deepEqual(hits, []);
});

test("the 404 page forwards only the old root paths", () => {
  const code = readFileSync(path.join(site, "assets/not-found.js"), "utf8");
  const run = (pathname, search = "", hash = "") => {
    const replaced = [];
    const sandbox = {
      location: {
        pathname,
        search,
        hash,
        replace: (to) => replaced.push(to),
      },
    };
    vm.runInNewContext(code, sandbox);
    return replaced[0] ?? null;
  };
  assert.equal(run("/admin"), "/console/admin");
  assert.equal(
    run("/explore/player/ABC", "?x=1", "#y"),
    "/console/explore/player/ABC?x=1#y",
  );
  assert.equal(run("/account/profile"), "/console/account/profile");
  assert.equal(run("/account/profile/"), "/console/account/profile");
  // Everything else stays a 404.
  for (const miss of [
    "/accounts",
    "/explored",
    "/administrator",
    "/nothing",
    "/docs/gone",
    "/",
  ])
    assert.equal(run(miss), null, miss);

  // The app's one map takes an old account path the rest of the way, query and
  // hash intact, so the 404 page keeps none of its own.
  assert.equal(movedTo("/console/account/profile"), "/settings/profile");
  assert.equal(movedTo("/console/account/usage"), "/settings/usage");
  assert.equal(movedTo("/console/admin"), "/console/admin/requests");
});

test(
  "the 404 page loads its forwarder and keeps the way home",
  { skip },
  () => {
    const html = read("404.html");
    assert.match(html, /src="\/assets\/not-found(\.[^"]*)?\.js[^"]*"/);
    assert.match(html, /Nothing at this address/);
    assert.match(html, /noindex/);
  },
);

test("the old /data pages answer 301 to their sections, at the edge", () => {
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
  const body = code.join("\n");
  assert.ok(
    Buffer.byteLength(body) < 10_240,
    "a CloudFront function holds 10 KB",
  );
  const handler = new Function(`${body}\nreturn handler;`)();
  for (const [old, section] of [
    ["/data/growth", "battles-by-day"],
    ["/data/collect", "what-is-recorded"],
    ["/data/now", "right-now"],
    ["/data/machines", "for-machines"],
  ])
    for (const uri of [old, `${old}/`]) {
      const answer = handler({ request: { uri } });
      assert.equal(answer.statusCode, 301, uri);
      assert.equal(answer.headers.location.value, `/data#${section}`);
      if (!skip)
        assert.ok(read("data/index.html").includes(` id="${section}"`));
    }
  assert.equal(handler({ request: { uri: "/data" } }).uri, "/data/index.html");
});

test("the charts in the app moved to the site's page", () => {
  assert.equal(movedTo("/console/data"), "/data");
  assert.equal(movedTo("/console/data/dashboard"), "/data");
});

test(
  "Updates: months have pages, contract entries wait behind the switch",
  { skip },
  () => {
    const doc = new JSDOM(read("updates/index.html")).window.document;
    assert.ok(doc.querySelector("[data-contract-switch] input"), "the switch");
    const contract = doc.querySelector('[data-kind="contract"]');
    assert.ok(contract, "contract entries are in the page");
    assert.ok(existsSync(path.join(out, "updates/2026-09/index.html")));
    // Every entry keeps its own address, and the feed keeps both kinds.
    assert.match(read("feed.json"), /"title"/);
  },
);

test("a static page can reach search and help", { skip }, () => {
  const doc = new JSDOM(read("docs/about/index.html")).window.document;
  assert.equal(
    doc
      .querySelector('.kit-top__search[data-session-face="in"]')
      .getAttribute("href"),
    "/home?search",
  );
  const box = doc.querySelector("dialog[data-help]");
  assert.ok(box, "the help drawer");
  assert.ok(box.querySelector("[data-help-note]"));
  assert.ok(
    doc.querySelector('.kit-top__icon[data-session-face="in"][data-help-open]'),
  );
  assert.ok(existsSync(path.join(out, "assets/site-help.js")));
});

test(
  "Support promises nothing for money, and links the record",
  { skip },
  () => {
    const text = new JSDOM(
      read("support/index.html"),
    ).window.document.body.textContent.replace(/\s+/g, " ");
    assert.match(
      text,
      /no extra quota, no longer retention, no features, no priority/,
    );
    assert.match(text, /Raise your hand/);
    assert.doesNotMatch(text, /corpus|Captured by/i);
  },
);
