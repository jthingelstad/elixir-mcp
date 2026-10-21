# 2026-10-21 — The site publishes only what changed

Plan §5 of the 2026-10-21 platform review, its second half (the first:
`2026-10-21-deploy-tooling.md`), approved by Jamie: "Approved to move
forward with the entire plan."

The first timed deploy (PR #637, 2026-10-21 02:44 CDT, site lane) spent
20.3 s in the assets phase and 21.4 s in the site phase, of 57 s before
the acceptance suite; nearly all of it was repeated work:

- **One build.** `build-site.mjs` ran `npm run build` and the app's Vite
  build again, moments after the deploy's build phase had run both. The
  deploy now passes `--prebuilt`, and only the static site (Eleventy)
  builds in the site phase. CI and local runs without the flag are
  unchanged. The site now carries the same docs corpus as the Lambdas
  (built with `SOURCE_DATE_EPOCH`), not a second one stamped with the
  clock.
- **Only what changed is uploaded.** `aws s3 sync` compares size and
  mtime, and the build writes every file fresh, so every deploy
  re-uploaded all ~1,360 files through four CLI processes and then
  rewrote the .txt surfaces' headers with a copy. One planner
  (`lib/site-publish.mjs`) now compares each file's MD5 with the object's
  ETag (SSE-S3, nothing multipart, so the ETag is the MD5) and its
  Content-Type and Cache-Control with what the last publish recorded in
  `deploys/site-published.json` (code bucket); a file the record does not
  vouch for is checked with HEAD. Only a difference is uploaded, 16 at a
  time, with both headers set on the PUT. The order is unchanged: hashed
  assets, other assets, documents, then the documents the build no
  longer has are deleted; nothing under `assets/` is deleted here.
- **The app's assets once.** The assets phase (before the switch) PUT
  every Vite file, one at a time, all immutable and typed by a
  four-entry table (fonts as `application/octet-stream`), and the site
  phase uploaded them again with the right headers. It now publishes
  them through the same planner with the same headers, so the site
  phase finds them published.
- **Content types are a table.** `CONTENT_TYPES` gives each kind of file
  the type `aws s3 sync` gave it (read from the bucket), and every .txt
  `text/plain; charset=utf-8` (the font licence under `assets/` gains the
  charset). A file of any other kind fails the site build
  (`verifySite`) rather than reach the bucket untyped.
- **The prune reads manifests.** The old rule pruned an asset not in this
  build and not uploaded for 14 days, which meant "not shipped for 14
  days" only while every deploy re-uploaded every file. Each deploy now
  writes the `assets/` keys it ships to
  `deploys/site-assets/<start>-<sha>.json` (the Vite assets before the
  switch, the whole set after the site publish; a failed write stops the
  deploy). An asset is pruned only when this build does not ship it, no
  manifest in the last 14 days names it, and it was not uploaded in that
  window either; a manifest that cannot be read, or this deploy's own
  missing from the listing, prunes nothing that deploy. The tests pin
  each case (`services/mcp/test/site-publish.test.mjs`).
- **Tests.** `build-site.mjs` exports `mergeSite` and `verifySite`
  (`services/mcp/test/build-site.test.mjs`: the merge, its collision and
  shell refusals, and each broken tree it names).

The deploy no longer calls the AWS CLI. No MCP, JSON API or schema
change.
