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
  // The access-request form's script. An external file rather than an
  // inline block because the CSP forbids inline script (#25).
  eleventyConfig.addPassthroughCopy("src/assets/request-form.js");
  eleventyConfig.addPassthroughCopy("src/assets/data-live.js");
  eleventyConfig.addPassthroughCopy("src/assets/chrome-menu.js");
  eleventyConfig.addPassthroughCopy("src/assets/transcript.js");

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
    ["connections", "Connections"],
    ["reference", "Reference"],
    ["data", "The data"],
    ["collector", "Run a collector"],
    ["policies", "Policies"],
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

  eleventyConfig.addFilter("number", (n) =>
    typeof n === "number" ? n.toLocaleString("en-US") : "—",
  );
  eleventyConfig.addFilter("day", (s) => (s ? String(s).slice(0, 10) : "—"));

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

  /** Where a named tool is documented. Unknown names fall back to the
   *  index rather than a 404: the transcript names a couple of tools by
   *  their display grouping rather than their registry name. */
  eleventyConfig.addFilter("toolHref", function (name) {
    const data = this.ctx?.tools ?? {};
    const hit = (data.all ?? []).find((t) => t.name === name);
    const group = (data.groups ?? []).find((g) => g.group === hit?.group);
    return group ? `/docs/tools/${group.slug}` : "/docs/tools";
  });

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
