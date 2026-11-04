# 2026-11-04 — Elixir turns Tinylytics History counting off with data-spa

The 2026-11-02 move to `script.js` stopped the embed counting History
navigation with a `window.Turbo` mark, because the script had no setting for
it then. It has one now: `data-spa="false"` on the tag.

- **App** (`apps/web/src/analytics.js`, and the unused loader in
  `packages/clan-web`): the loader sets `data-spa="false"` and no longer sets
  `window.Turbo`. The route bridge still counts every view after the document,
  normalized, and the embed still counts the document load, listens for
  `data-tinylytics-event` clicks and draws widgets. Counts do not change.
- **Corrected from the 2026-11-02 note:** the script now counts `pushState` and
  back/forward, not `replaceState`.

No contract, API or migration change.
