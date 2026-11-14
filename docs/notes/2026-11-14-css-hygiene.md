# 2026-11-14 — CSS hygiene: components.css speaks in tokens

Groundwork for a redesign that changes tokens rather than rules. Nothing
looks different: 360 screenshots (every app and site page the capture
harness reaches, phone and desktop, first screen and full page) are
pixel-identical before and after, and every utility class swapped in
compiles to the same declarations as the one it replaced.

- **Tokens.** Every colour, radius and font size in
  `packages/design/src/components.css` is a `var(--…)` from
  `tokens.css`. Where an existing token held the identical value it is
  used; otherwise a new token holds the exact value, named for its use:
  component paints (`--map-pin*`, `--scrim*`, `--chart-bar*`, `--art-*`,
  `--form-*`, `--mode-*`, `--heat-*`, `--tower*`, `--elixir-drop*` and
  others), two shadows (`--shadow-tip`, `--shadow-lift`), sizes
  (`--t-micro` through `--t-score`, plus `--t-hero` and
  `--t-home-title`, the two clamps) and radii (`--r-card`, `--r-tile`,
  `--r-feature`, `--r-select`, `--r-round`, `--r-bubble` and others). No
  value was rounded; no existing token was renamed or changed.
  Left as literals: the two `#000` mask stops in `.kit-facts`, `0` and
  `inherit` radii, and the two card-label sizes computed from the
  element's own `--card-w`.
- **References that never resolved.** `var(--r-s)` (never defined, so
  the radius was already 0) is now `0`; `var(--radius-control, 8px)`
  and `var(--r-card, 10px)` (the first never defined, the second only
  now) are now `var(--r-chip)` and `var(--r-card)`, the values the
  fallbacks drew. `ClanMap.jsx` read `--color-map-*` names that the
  stylesheet never emits, so its pins always drew their hex fallbacks;
  it now reads the `--map-pin*` tokens, same colours.
- **Arbitrary Tailwind sizes** in `apps/web`, `packages/ui` and the two
  card templates became named utilities (`text-[13px]` is
  `text-small`, `rounded-[9px]` is `rounded-select`, and so on). A size
  whose name is also a colour token is spelled by type:
  `text-(length:--t-body)` and `text-(length:--t-panel-head)`, because
  `text-panel-head` is the panel-head colour.
- **Duplicates.** Nineteen selectors declared twice now have one block,
  each merged only where no rule in between could change the result.
  Left: `.btn--sm` and `.kit-top__search`, whose later blocks must stay
  after rules in between, and the group-then-specialise pairs. The six
  `!important` declarations are the `[hidden]` and session-face guards
  and the reduced-motion switch; they stay.
- **`.mono-tag` and `.mono-num`** carry `.mono`'s exact styling in
  every rule `.mono` is in. Tags and tag inputs use `.mono-tag`;
  scores, hitpoints, levels and counts use `.mono-num`; `.mono` stays
  for ids, paths and code-like names.
- **Dead rules.** `.freshness--derived`, `.freshness--fresh::before`,
  `.kit-tl` with its three phone rules, and `.clan-fold > summary`.
- **Inline styles.** 23 static `marginLeft: "auto"`, `fontWeight: 400`
  and `color: var(--ink-faint)` styles became `ml-auto`, `font-normal`
  and `text-ink-faint`; the ceiling in `apps/web/test/inline-styles.test.js`
  falls from 227 to 195.

No version changes: no MCP, JSON API or migration change.
