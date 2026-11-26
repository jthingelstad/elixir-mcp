# 2026-11-26 — Dismiss the clanmate notice

Jamie, 2026-11-26: "The 'A clanmate who plays your cards' notice that goes
at the top of the timeline needs a way to 'Dismiss' / 'close' it."

## What changed

- `ClanDeckSpotlight` (`apps/web/src/home/People.jsx`) has a Dismiss
  control in its panel head: an `x` icon button named "Dismiss", a 44px
  target, as the bell's Close and the push prompt's Not now are.
- The best match moved to `spotlightMatch` (`apps/web/src/home/logic.js`),
  the same order as before. Dismissing remembers that clanmate's tag;
  the notice shows the best match only while it is not dismissed and never
  falls through to the next best, so it comes back only when a clanmate
  not dismissed becomes the best match. Find › Your clan is unchanged and
  lists every match.
- Persistence is this browser's `localStorage`, per account
  (`elixir.home.spotlight-dismissed:<keptFor(me)>`, the key the feed's Show
  and mode choices use), up to 50 tags, newest last. There is no
  per-account server store for dismissed notices: the profile list's
  `dismissed_at` (0274) and the starter set's Not now are columns of their
  own, and one notice does not warrant another. So a dismissal does not
  follow you to another device, and a blocked store forgets it after the
  visit.
- Docs: `player-page.md` (Connections through play).

No migration; JSON API `/api/v1` and MCP unchanged.
