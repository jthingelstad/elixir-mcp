/**
 * The top bar - logo and wordmark, the places, Docs, the game,
 * the sign-in slot - as the kit's shell manifest
 * (packages/ui/src/shell.json) states it.
 *
 * The SAME file packages/ui/src/shell.ts reads for the React shell, so
 * the web app and this build draw one bar. base.njk
 * loops over it rather than keeping a copy: Nunjucks cannot import the
 * TypeScript, but it can read the JSON underneath it. Handed over as it
 * is, not reshaped: a product on Elixir's origin is a `path`, which is
 * what this site links (it IS that origin); one elsewhere is an `href`.
 * The signed-out places, the footer and the bar's search and help are in it too.
 */
import manifest from "@elixir-mcp/ui/shell.json" with { type: "json" };

export default manifest;
