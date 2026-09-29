/**
 * The family's top bar - wordmark, tabs, product buttons - as the kit's
 * product manifest (packages/ui/src/family.json) states it.
 *
 * The SAME file packages/ui/src/family.ts reads for the React Chrome, so
 * the console, the verticals and this build draw one list. base.njk
 * loops over it rather than keeping a copy: Nunjucks cannot import the
 * TypeScript, but it can read the JSON underneath it. Handed over as it
 * is, not reshaped: a product on the family origin is a `path`, which is
 * what this site links (it IS that origin); one elsewhere is an `href`.
 * A tab's `key` is the `navActive` a page names to light it.
 */
import manifest from "@elixir-mcp/ui/family.json" with { type: "json" };

export default manifest;
