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
  eleventyConfig.addPassthroughCopy("src/assets/nav-session.js");

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
