# 2026-11-13 — Clan's sub-pages flat, like Home

Part 3 of 3 after #950 (speed) and #955 (the Feed and the clan's head).
The clan's head, flat since #955, is every Clan page's top; this pass
takes what was left of Clan's own look on the pages under it.

- **Standings:** a group's panel head loses its 3px coloured bar (the
  canvas's group edge, written as Tailwind arbitrary shadows in
  `Standing.jsx`). The group's chip keeps its tone, so the group still
  reads by colour and by name.
- **Panel titles:** thirteen hand-sized headings
  (`m-0 text-[14px] font-semibold`) in Standing, War (Season), Run,
  Manage, You here, a member's activity, Members' comings and goings and
  Actions use the kit's `kit-panel__title`, as Home's panels do.
- **`.clan-foot`** (Members' Spread the word and Scout, and the quiet
  Send feedback under every Clan page) keeps its space and drops its top
  rule.

Nothing a member, Elder or leader sees or can do changed. Also renumbers
#955's What's new fragment from 227 to 228: three sessions took 227 the
same afternoon.

Clan-only CSS that stays, and why:
- `.clan-head*`, `.clan-race*`, `.clan-today*`: see
  `2026-11-13-clan-feed-flat-like-home.md`.
- `.clan-rows`, `.clan-row*`, `.clan-subnav*`, `.clan-members-*`,
  `.clan-dir*`, `.st-*` (Run's rail and forms), the policy editor and
  awards: page parts the kit has no equivalent for; they already use the
  kit's tokens, panels and tables.
