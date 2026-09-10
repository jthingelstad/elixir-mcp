/**
 * The static half of elixir.poapkings.com (2026-09-07 split).
 *
 * Everything that is CONTENT - home, docs, updates, the contract
 * changelog - is a real HTML page built here. Everything behind a
 * session, or drawn from live data at read time, stays in the React app
 * (apps/web) and is served from /app.html by the edge router.
 *
 * Why: the whole site used to be one bundle, and the deploy patched a
 * single crawlable block into the one shared shell. Every URL therefore
 * served byte-identical HTML - ten sitemap entries, one page. Docs and
 * the tool reference existed only inside JavaScript, so no crawler and
 * no agent fetching a URL could read them.
 *
 * Canonical URLs carry NO trailing slash (/docs/about, not
 * /docs/about/), which is what the old sitemap published and what the
 * app's redirect map assumes. Pages are emitted as <path>/index.html
 * and the edge router appends index.html, so both spellings resolve.
 */
import path from "node:path";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);

export default function (eleventyConfig) {
  // The design system is one file in packages/design, consumed by both
  // halves: the app imports it through Vite (hashed), the static site
  // links this copy. A test asserts the two are the same bytes.
  // Resolved by PACKAGE NAME, not a relative path reaching out of this
  // workspace: the dependency is declared, traceable, and survives a
  // move of either directory.
  eleventyConfig.addPassthroughCopy({
    [path.relative(
      process.cwd(),
      require.resolve("@elixir-mcp/design/styles.css"),
    )]: "assets/site.css",
  });
  eleventyConfig.addPassthroughCopy("src/robots.txt");
  eleventyConfig.addPassthroughCopy({
    "../../packages/contracts/integration-api.openapi.json":
      "docs/integration-api.json",
  });
  eleventyConfig.addPassthroughCopy("src/assets/data-live.js");
  eleventyConfig.addPassthroughCopy("src/assets/chrome-menu.js");
  eleventyConfig.addPassthroughCopy("src/assets/transcript.js");
  eleventyConfig.addPassthroughCopy("src/assets/rail-anchors.js");
  eleventyConfig.addPassthroughCopy("src/assets/updates-filter.js");
  eleventyConfig.addPassthroughCopy("src/assets/site-rail.js");
  // The share image every page's og:image and twitter:image name.
  eleventyConfig.addPassthroughCopy("src/assets/og.png");

  /** The site's canonical URL for a page: no /index.html, and no
   *  trailing slash. That is the spelling the previous sitemap
   *  published and the one the app's redirect map assumes, so it is
   *  what every link, canonical tag, sitemap entry and llms.txt line
   *  must use. The edge router resolves both spellings to the file. */
  eleventyConfig.addFilter("pageUrl", (data) => {
    const raw =
      typeof data === "string" ? data : (data?.canonical ?? data?.url ?? "/");
    const clean = String(raw).replace(/index\.html$/, "");
    return clean.length > 1 ? clean.replace(/\/$/, "") : "/";
  });

  /** Docs in their published order (front-matter `order`), so the
   *  sidebar, the docs index, the sitemap and llms.txt all agree. */
  eleventyConfig.addCollection("docs", (api) =>
    api.getFilteredByTag("doc").sort((a, b) => a.data.order - b.data.order),
  );

  /**
   * The same docs, grouped into sections for the sidebar and the index.
   *
   * Flat was fine at six pages. It stops being fine once the set spans four
   * audiences who each need a different third of it — somebody connecting
   * Claude, a clan leader creating an agent, a developer building on the
   * corpus, and the handful of people running a collector. Grouping is what
   * lets each of them ignore the other three.
   *
   * SECTIONS is the single ordered source; a page names its section in
   * front-matter and `order` sorts within it. A page whose section is unknown
   * is a build error rather than a silent orphan at the bottom of the nav.
   */
  const SECTIONS = [
    ["start", "Start here"],
    ["using", "Using it"],
    ["record", "The record"],
    ["policy", "Policy"],
  ];
  eleventyConfig.addCollection("docSections", (api) => {
    const pages = api
      .getFilteredByTag("doc")
      .sort((a, b) => a.data.order - b.data.order);
    for (const page of pages) {
      const key = page.data.section;
      if (!SECTIONS.some(([k]) => k === key))
        throw new Error(
          `doc "${page.data.slug}" has section "${key}", which is not one of: ${SECTIONS.map(([k]) => k).join(", ")}`,
        );
    }
    return SECTIONS.map(([key, label]) => ({
      key,
      label,
      pages: pages.filter((p) => p.data.section === key),
    })).filter((s) => s.pages.length > 0);
  });

  /**
   * A Lucide glyph, inlined from the package at build time.
   *
   * The design draws every rail with Lucide and the console uses
   * lucide-react; the static half has no React, so it reads the same
   * icons out of lucide-static — the package, not copies of it. Stroke
   * and size are pinned here so two icons in one row cannot disagree,
   * and every icon is aria-hidden: it decorates a text label and never
   * carries meaning alone. An unknown name fails the build.
   */
  const iconDir = path.join(
    path.dirname(require.resolve("lucide-static/package.json")),
    "icons",
  );
  const iconCache = new Map();
  eleventyConfig.addShortcode("icon", (name, size = 18) => {
    if (!iconCache.has(name)) {
      const file = path.join(iconDir, `${name}.svg`);
      if (!existsSync(file)) throw new Error(`icon "${name}" is not in Lucide`);
      const body = readFileSync(file, "utf8")
        .replace(/<!--[\s\S]*?-->\s*/g, "")
        .replace(/<svg[\s\S]*?>/, "")
        .replace(/<\/svg>\s*$/, "")
        .replace(/\s+/g, " ")
        .trim();
      iconCache.set(name, body);
    }
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: 0 0 auto">${iconCache.get(name)}</svg>`;
  });

  /** The H2 headings of a rendered page, for the docs rail's children
   *  and the "On this page" outline: [{ id, text }]. */
  eleventyConfig.addFilter("headings", (html, level = 2) => {
    const re = new RegExp(
      `<h${level} id="([^"]+)">([\\s\\S]*?)<\\/h${level}>`,
      "g",
    );
    return [...String(html ?? "").matchAll(re)].map((m) => ({
      id: m[1],
      text: m[2].replace(/<[^>]+>/g, ""),
    }));
  });
  /** A doc's body without its own H1: the layout draws the title in
   *  the display face with the page's lede under it, so the markdown's
   *  heading would repeat it. */
  eleventyConfig.addFilter("withoutH1", (html) =>
    String(html ?? "").replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/, ""),
  );
  /** When a source file last changed, from git — the "Updated" line
   *  under the outline. A file git does not know yet reads as today. */
  const updatedCache = new Map();
  eleventyConfig.addFilter("updated", (inputPath) => {
    const key = String(inputPath ?? "");
    if (!updatedCache.has(key)) {
      let stamp = "";
      try {
        stamp = execFileSync("git", ["log", "-1", "--format=%cs", "--", key], {
          encoding: "utf8",
        }).trim();
      } catch {
        stamp = "";
      }
      updatedCache.set(key, stamp || new Date().toISOString().slice(0, 10));
    }
    return updatedCache.get(key);
  });
  /** Where a source file is edited: the public repository, on main. */
  eleventyConfig.addFilter(
    "editUrl",
    (inputPath) =>
      `https://github.com/jthingelstad/elixir-mcp/blob/main/apps/site/${String(inputPath ?? "").replace(/^\.\//, "")}`,
  );
  /** A project's page: the first one is /family itself, the rest sit
   *  under it. One document per product, the way the design draws it. */
  eleventyConfig.addFilter("familyPath", (p, first) =>
    first ? "/family/index.html" : `/family/${p.key}/index.html`,
  );

  eleventyConfig.addFilter("number", (n) =>
    typeof n === "number" ? n.toLocaleString("en-US") : "—",
  );
  eleventyConfig.addFilter("day", (s) => (s ? String(s).slice(0, 10) : "—"));
  /** "2026-09-09 18:44Z" — a timestamp to the minute, for an as-of. */
  eleventyConfig.addFilter("stamp", (s) =>
    s ? String(s).slice(0, 16).replace("T", " ") + "Z" : "—",
  );
  eleventyConfig.addFilter("ofKind", (entries, kind) =>
    (entries ?? []).filter((e) => e.kind === kind),
  );
  /** Updates grouped by month, newest first, for the archive rail and
   *  the month headings — derived from the dates, never typed twice. */
  eleventyConfig.addFilter("byMonth", (entries) => {
    const months = new Map();
    for (const u of entries ?? []) {
      const key = String(u.date).slice(0, 7);
      if (!months.has(key)) months.set(key, []);
      months.get(key).push(u);
    }
    return [...months.entries()].map(([key, items]) => ({
      key,
      label: new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
      items,
    }));
  });

  /** Pick one group out of a grouped data file by name.
   *
   *  A filter rather than a loop with `set` inside it: Nunjucks has no
   *  namespace assignment, so a variable set inside a for-loop does not
   *  survive it — which rendered an entire page of use cases as an empty
   *  shell with a working nav around it. */
  eleventyConfig.addFilter(
    "pickGroup",
    (groups, name) => (groups ?? []).find((g) => g.group === name) ?? null,
  );
  /** The tools a transcript names, as a list. They arrive as one
   *  display string because that is how the design writes them. */
  eleventyConfig.addFilter("toolNames", (s) =>
    String(s ?? "")
      .split("·")
      .map((x) => x.trim())
      .filter(Boolean),
  );

  /** Where a named tool is documented: its family page, at the heading
   *  the tool-group include gives it (`id="<name>"`), so a reader lands
   *  on the tool and not the top of a page. A name the registry does not
   *  know falls back to the index rather than a 404 — and the build
   *  refuses it below, because the site's copy promises every tool it
   *  names is real. */
  eleventyConfig.addFilter("toolHref", function (name) {
    const data = this.ctx?.tools ?? {};
    const hit = (data.all ?? []).find((t) => t.name === name);
    const group = (data.groups ?? []).find((g) => g.group === hit?.group);
    return group ? `/docs/tools/${group.slug}#${name}` : "/docs/tools";
  });

  /** Where a use case's "To set this up" step goes. The design draws
   *  the steps as buttons and leaves their targets blank; these are the
   *  pages that actually do each thing, so a step is never a dead
   *  button. An unmapped label falls back to the quickstart. */
  const SETUP_HREF = {
    "Track your player": "/account/tracking",
    "Connect a client": "/docs/quickstart",
    "Read the methodology": "/docs/methodology",
    "Set your timezone": "/account/profile",
    "Track a friend's tag": "/account/tracking",
    "Turn on notifications": "/docs/events",
    "Track your clan": "/account/tracking",
    "Choose a recording scope": "/docs/recording#scope-what-is-actually-polled",
    "Track your clan, comprehensive": "/account/tracking",
    "Read about scopes": "/docs/recording#scope-what-is-actually-polled",
    "Look up a clan tag": "/explore/clans",
    "Read the privacy posture": "/docs/privacy",
    "Create an agent": "/account/agents",
    "Read the agents doc": "/docs/agents",
    "Read the integrations doc": "/docs/integrations",
    "Request a service key":
      "/docs/integrations#provisioning-and-administration",
    "Read the operators guide": "/docs/operators",
    "Raise your hand": "/status/collectors",
  };
  eleventyConfig.addFilter(
    "setupHref",
    (label) =>
      SETUP_HREF[String(label).replace(/’/g, "'")] ?? "/docs/quickstart",
  );

  /** The same, for the generated tool families. */
  eleventyConfig.addFilter(
    "pickToolGroup",
    (groups, name) => (groups ?? []).find((g) => g.group === name) ?? null,
  );

  /**
   * Daily battle counts -> a cumulative monthly curve, as SVG paths.
   *
   * Cumulative, because the question the Data page answers is "how much
   * is in here", and that only ever goes up. Bucketed by the month a
   * battle was PLAYED, so a backfilled archive lands where it belongs
   * rather than on the day it arrived.
   *
   * A month with no battles keeps its width: the shape of the corpus is
   * part of the truth, and compressing an empty stretch would draw a
   * line that never happened.
   */
  /**
   * Battles per DAY as bars (2026-09-10, Jamie: "I would rather show
   * daily as a bar chart").
   *
   * A cumulative monthly curve only ever goes up and to the right, which
   * makes it a picture of the corpus being big rather than of the
   * recorder working: a day the collectors stalled is invisible in it,
   * and that is the day worth seeing. Bars are per day, gaps included as
   * real zeroes, so a flat stretch reads as a flat stretch.
   */
  eleventyConfig.addFilter("dailyBars", (daily, days = 120) => {
    if (!Array.isArray(daily) || daily.length === 0) return {};
    const byDay = new Map(
      daily.map((d) => [String(d.day).slice(0, 10), d.battles ?? 0]),
    );
    const sorted = [...byDay.keys()].sort();
    // Every day between the first and the last, so an empty one keeps
    // its width instead of being closed over.
    const start = new Date(`${sorted.at(-1)}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    const keys = [];
    const cursor = new Date(
      Math.max(start, new Date(`${sorted[0]}T00:00:00Z`)),
    );
    const end = new Date(`${sorted.at(-1)}T00:00:00Z`);
    while (cursor <= end) {
      keys.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const values = keys.map((k) => byDay.get(k) ?? 0);
    const top = Math.max(...values, 1);
    const X0 = 20,
      X1 = 640,
      Y0 = 140,
      Y1 = 12;
    const slot = (X1 - X0) / keys.length;
    const round = (n) => Math.round(n * 10) / 10;
    const bars = keys.map((k, i) => {
      const h = ((Y0 - Y1) * values[i]) / top;
      return {
        x: round(X0 + slot * i),
        // A gap of at least a pixel between bars, and never wider than
        // the slot: with 120 days the bars are thin and the gaps matter.
        width: round(Math.max(slot - Math.min(1.5, slot * 0.25), 0.6)),
        y: round(Y0 - h),
        height: round(Math.max(h, values[i] > 0 ? 1 : 0)),
        day: k,
        battles: values[i],
      };
    });
    // A label every fortnight or so, and always the ends: a tick per day
    // is unreadable at this width.
    const step = Math.max(1, Math.round(keys.length / 6));
    const ticks = bars
      .filter((b, i) => i % step === 0 || i === bars.length - 1)
      .map((b) => ({
        x: round(b.x + b.width / 2),
        label: new Date(`${b.day}T12:00:00Z`).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }),
      }));
    const total = values.reduce((a, b) => a + b, 0);
    return {
      bars,
      ticks,
      top,
      half: Math.round(top / 2),
      first: keys[0],
      last: keys.at(-1),
      days: keys.length,
      total,
      mean: Math.round(total / keys.length),
      busiest: bars.reduce((a, b) => (b.battles > a.battles ? b : a), bars[0]),
    };
  });

  eleventyConfig.addFilter("cumulativeByMonth", (daily) => {
    if (!Array.isArray(daily) || daily.length === 0) return {};
    const byMonth = new Map();
    for (const d of daily) {
      const key = String(d.day).slice(0, 7);
      byMonth.set(key, (byMonth.get(key) ?? 0) + (d.battles ?? 0));
    }
    const months = [...byMonth.keys()].sort();
    // Fill the gaps so an empty month occupies its own width.
    const [y0, m0] = months[0].split("-").map(Number);
    const [y1, m1] = months.at(-1).split("-").map(Number);
    const keys = [];
    for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1);) {
      keys.push(`${y}-${String(m).padStart(2, "0")}`);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    let total = 0;
    const running = keys.map((k) => {
      total += byMonth.get(k) ?? 0;
      return { key: k, total };
    });
    const top = running.at(-1).total || 1;
    const X0 = 20,
      X1 = 640,
      Y0 = 140,
      Y1 = 12;
    const at = (i) =>
      running.length === 1 ? X1 : X0 + ((X1 - X0) * i) / (running.length - 1);
    const y = (v) => Y0 - (Y0 - Y1) * (v / top);
    const points = running.map((r, i) => ({
      x: Math.round(at(i) * 10) / 10,
      y: Math.round(y(r.total) * 10) / 10,
      label: new Date(`${r.key}-01T12:00:00Z`).toLocaleString("en-US", {
        month: "short",
        timeZone: "UTC",
      }),
      total: r.total,
    }));
    const line = points
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`)
      .join(" ");
    const short = (v) =>
      v >= 1000
        ? `${Math.round(v / 100) / 10}k`.replace(".0k", "k")
        : String(v);
    return {
      points,
      line,
      area: `${line} L${points.at(-1).x},${Y0} L${points[0].x},${Y0} Z`,
      tipX: points.at(-1).x,
      tipY: points.at(-1).y,
      top: short(top),
      half: short(Math.round(top / 2)),
      first: running[0].key,
      last: running.at(-1).key,
    };
  });

  /**
   * RFC-822, which is what RSS 2.0 actually requires.
   *
   * The feed was publishing <pubDate>2026-09-07</pubDate>. That is not a date
   * in RSS terms, so readers either showed no date at all or refused the item
   * — a feed nobody could have subscribed to successfully.
   */
  eleventyConfig.addFilter("rfc822", (s) => {
    const d = new Date(`${String(s).slice(0, 10)}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? "" : d.toUTCString();
  });
  eleventyConfig.addFilter("json", (v) => JSON.stringify(v, null, 2));

  /** Escape text that lands inside HTML we build by hand. */
  const esc = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  eleventyConfig.addFilter("esc", esc);

  /** Render doc bodies with marked - the renderer the app used - so the
   *  docs read identically after the move.
   *
   *  Not cosmetic: Eleventy's default markdown-it wrapped the
   *  architecture page's inline <svg> opening tag in a <p>, because the
   *  tag spans two lines, and closed the paragraph before the diagram.
   *  The whole diagram collapsed into flowing text. marked keeps the
   *  block intact, which is why that page looked right for months
   *  inside the app. */
  const { marked } = require("marked");
  /** Headings carry ids so pages can link to a section (marked stopped
   *  emitting them in v8). Slug: lower-case, non-alphanumerics to
   *  hyphens, trimmed - the same shape GitHub produces. */
  const slug = (text) =>
    text
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      // marked hands over ESCAPED text: an apostrophe arrives as &#39;
      // and a quote as &quot;, which used to slug "the game's own" into
      // the-game-39-s-own. Drop entities and quotes first so the site's
      // fragment and the docs corpus's section slug are the same string.
      .replace(/&#\d+;|&quot;|&#x[0-9a-f]+;|['"\u2019\u201c\u201d]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        return `<h${depth} id="${slug(text)}">${text}</h${depth}>\n`;
      },
    },
  });
  eleventyConfig.setLibrary("md", { render: (md) => marked.parse(md) });
  /** A doc's Markdown SOURCE with its variables resolved, for the
   *  text bundles (llms-full.txt): the same renderer the MCP corpus
   *  uses, so neither hands a reader "{{ statistics.meta.prior_strength }}". */
  eleventyConfig.addAsyncFilter("renderDoc", async (raw) => {
    const { renderDoc, docContext } = await import("./src/_lib/doc-render.mjs");
    return renderDoc(raw, await docContext());
  });
  /** Markdown in a data string - a transcript line - as HTML. A model
   *  answers in Markdown, so the page shows what a client would show. */
  eleventyConfig.addFilter("md", (s) => marked.parse(String(s ?? "")));

  /** First paragraph of a doc, as plain text, for meta descriptions and
   *  the docs index. */
  eleventyConfig.addFilter("firstParagraph", (md) => {
    const body = String(md ?? "")
      .split("\n")
      .filter((l) => !l.startsWith("#"))
      .join("\n")
      .trim();
    const para = body.split(/\n\s*\n/)[0] ?? "";
    return para
      .replace(/\s+/g, " ")
      .replace(/[*`_[\]]/g, "")
      .trim();
  });

  eleventyConfig.addFilter("clamp", (s, n) => {
    const t = String(s ?? "");
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  });

  return {
    dir: {
      input: "src",
      output: "dist",
      includes: "_includes",
      data: "_data",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
