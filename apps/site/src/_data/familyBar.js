/**
 * The family's top bar - logo and wordmark, the places, Docs, the game,
 * the sign-in slot - as the kit's product manifest
 * (packages/ui/src/family.json) states it.
 *
 * The SAME file packages/ui/src/family.ts reads for the React Chrome, so
 * the web app, the verticals and this build draw one bar. base.njk
 * loops over it rather than keeping a copy: Nunjucks cannot import the
 * TypeScript, but it can read the JSON underneath it. Handed over as it
 * is, not reshaped: a product on the family origin is a `path`, which is
 * what this site links (it IS that origin); one elsewhere is an `href`.
 * The signed-out places, the footer and the bar's search and help are in it too.
 */
import manifest from "@elixir-mcp/ui/family.json" with { type: "json" };

export default manifest;
