/** An address the site does not build (2026-10-08). The edge asks the
 *  site bucket first; when the bucket misses (403: the distribution may
 *  not list it, so a missing key reads as AccessDenied) CloudFront fails
 *  over to this API with the same path (infra/template.yaml, the
 *  site-or-miss origin group), and this answers the site's own 404.html
 *  with a true 404. Before it, a mistyped link showed raw S3 XML.
 *
 *  Only the site's default behaviour fails over here. The API, MCP and
 *  OAuth behaviours keep their own refusals: the handler never sends a
 *  path under /api/ to this. */

const DISCLAIMER =
  "This material is unofficial and is not endorsed by Supercell. For more information see Supercell’s Fan Content Policy: www.supercell.com/fan-content-policy.";

/** What a miss reads as when the built page cannot be read (the bucket
 *  is mid-publish, or S3 did not answer): plain, but still a page, with
 *  the way home and the disclaimer. */
export const FALLBACK_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" /><title>Page not found - Elixir</title></head>
<body>
<h1>Nothing at this address</h1>
<p>Elixir has no page here. <a href="/">Elixir home</a> · <a href="/docs">Docs</a> · <a href="/console">Console</a></p>
<p><small>${DISCLAIMER}</small></p>
</body>
</html>
`;

/** @param {(() => Promise<string>) | null} readPage the built 404.html */
export function makeSiteMiss(readPage) {
  return async (method) => {
    let html = null;
    try {
      html = readPage ? await readPage() : null;
    } catch {
      html = null;
    }
    return {
      statusCode: 404,
      headers: {
        "content-type": "text/html; charset=utf-8",
        // The edge keeps a miss briefly; a deploy's invalidation clears
        // it when a page appears at the address.
        "cache-control": "public, max-age=300",
      },
      body: method === "HEAD" ? "" : (html ?? FALLBACK_PAGE),
    };
  };
}
