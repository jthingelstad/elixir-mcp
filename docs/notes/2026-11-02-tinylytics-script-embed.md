# 2026-11-02 — Tinylytics moves to the one script.js embed

Tinylytics now has one embed for every site:
`<script defer src="https://tinylytics.app/js/script.js" data-site="…">`,
with no URL parameters. What the old URLs asked for (`?hits&countries&events`
on the static site, `&beacon` in the app) is now each site's own setting in
Tinylytics, already set to match.

- **Static site** (`apps/site` `base.njk`): the new tag. The site tests pin
  it on every built page and fail if the old `/embed/` URL comes back.
- **App** (`apps/web/src/analytics.js`, and the unused loader in
  `packages/clan-web`): the loader sets `defer`, the new `src` and
  `data-site`. The new script counts `pushState`, `replaceState` and
  `popstate` by itself, at the raw address. The route bridge already counts
  each view once, normalized: a record as its kind, an Explore id as `?id=`,
  a roster search without its free text. So the loader sets a `window.Turbo`
  mark first, which makes the script leave History navigation to a
  `turbo:load` this app never fires. The script still counts the document
  load, listens for `data-tinylytics-event` clicks and draws widgets.

No contract, API or migration change.
