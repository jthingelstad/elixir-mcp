/**
 * Render a documentation page's Markdown SOURCE the way the site does:
 * its Nunjucks variables ({{ tools.contractVersion }}, the response
 * envelope, the methodology floors) resolved against the same data
 * files Eleventy hands the templates.
 *
 * One renderer, two readers. The docs corpus the MCP door serves and
 * llms-full.txt both used the raw source, so an agent was handed
 * "{{ statistics.meta.prior_strength }}" where a person saw the
 * number (Claude, reading the docs over MCP, 2026-09-10). Anything
 * that turns a source file into text for a reader goes through here.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const nunjucks = require("nunjucks");
const here = path.dirname(fileURLToPath(import.meta.url));

let contextPromise;
/** The data a doc may reference, loaded once from apps/site/src/_data. */
export function docContext() {
  if (!contextPromise) {
    contextPromise = (async () => {
      const load = async (name) => {
        const mod = await import(path.join(here, "../_data", name));
        const v = mod.default;
        return typeof v === "function" ? await v() : v;
      };
      const [responses, statistics, tools, site, build] = await Promise.all([
        load("responses.js"),
        load("statistics.js"),
        load("tools.js"),
        load("site.js"),
        load("build.js"),
      ]);
      return { responses, statistics, tools, site, build };
    })();
  }
  return contextPromise;
}

const env = new nunjucks.Environment(null, { autoescape: false });
env.addFilter("json", (v) => JSON.stringify(v, null, 2));
env.addFilter("number", (n) =>
  typeof n === "number" ? n.toLocaleString("en-US") : "—",
);

/** Markdown with its variables resolved. */
export function renderDoc(markdown, ctx) {
  return env.renderString(String(markdown ?? ""), ctx);
}
