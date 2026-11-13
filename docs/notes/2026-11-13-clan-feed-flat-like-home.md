# 2026-11-13 — Clan's Feed flat, like Home

The owner, 2026-11-13: the Clan page "lacks all of the styling that the
home tab has". Part 2 of 3 (part 1, #950, made it fast).

- **The clan's head** (`ClanHead`, every Clan page) loses its card: no
  gradient, no gold leading edge, no panel. The crest, the name in the
  display face and the line sit on the page as Home's title does; who you
  are in the clan is a dim label, not gold. Follow, the picker and the
  roster's freshness sit right, centred.
- **The Feed's timeline** draws each item as Home's card
  (`kit-feed__item`, its time, its sentence as `kit-feed__text`, a
  highlight's words on the gold rule, `kit-feed__words`), grouped under
  Home's day heads (`kit-day`), instead of rows inside one panel. Its
  "The clan, the last seven days" label is for screen readers only, as
  Home's feed has none.
- **The race bar** keeps the panel tone and drops its gold top edge.
- **The two columns** take Home's gaps (24px between, 16px down).

Nothing a member, Elder or leader sees or can do changed: the same
reads, the same words, the same buttons. Clan-only CSS left: `.clan-head*`
(the crest and chips have no kit equivalent with the follow and picker
beside them), `.clan-race*` (the race bar has no kit part) and
`.clan-today*` (Home's two columns order the side cards after the feed on
a phone; Clan puts them before the timeline).
