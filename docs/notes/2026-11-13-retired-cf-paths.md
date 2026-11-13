# 2026-11-13 — The folded addresses leave the distribution

The Console folded on 2026-11-12 and its old addresses stopped forwarding
on 2026-11-13, but CloudFront still sent `/console`, `/console/*`,
`/ladder`, `/ladder/*` and `/data/service` to the web API, which rendered
the app only to draw its missing page.

- **CloudFront:** the five cache behaviours are removed from the
  distribution in `infra/template.yaml`. Those addresses now take the
  default behaviour: the static router resolves each to a document the site
  does not build, the bucket misses, the `site-or-miss` group fails over to
  the web API, and it answers the site's `404.html` with a true 404. The
  distribution is modified in place, not replaced.
- **The app:** `APP_PATHS` in `apps/web/src/App.jsx`, `APP_PATH` in
  `services/web-api/src/app-pages.mjs` and the e2e server
  (`infra/scripts/serve-site.mjs`) drop the three. The web API's matcher
  had to go too: a failed-over `/console/index.html` would otherwise have
  rendered the app instead of reaching the site's 404.
- **IAM:** the migrate role loses `s3:GetObject` on `clan-migration/v1/*`
  and `s3:GetObject`/`s3:PutObject` on `right-sizing/v1/*` in the archive
  bucket. The code that used them went in 9eace1aa and 9ec16b97; no op
  reads or writes either prefix. It keeps `payloads/*`, `calls/*` and the
  bucket list. A narrowing, shipped by the deploy.
- **Guards:** the site and infra tests pin that no behaviour takes the
  retired paths and that the migrate role writes nothing to S3; a web API
  test pins that the retired paths are never rendered.

No contract version moves.
