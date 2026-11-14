# 2026-11-13 — Polish: the player page, Settings and the sheets

Part 2 of the polish pass on the signed-in app. Layout, styling and label
wording only: the same reads, the same rules, nothing anyone can see or do
changed.

- **The bar's place.** Another player's page (`/home/player/<tag>`) and a
  Follow me link (`/home/follow/<tags>`) light **Find** in the bottom tabs,
  not Home (`barArea` in `App.jsx`): Find is where you look for people.
- **An unrecorded player** reads as a player: the title is "Player" with
  the tag beside it in the smaller mono tag style (`.kit-head__tag`), not
  a bare mono tag. Its Follow stays the next step.
- **The player head's actions.** "Following" (or "You") is plain words
  first in the row, not a pill that looked like a third kind of button
  beside Their stats and Follow everyone.
- **Settings on a phone.** The section picker is one plain line on the
  page's own ground (the section, then the chevron, a hairline under it),
  not a violet slab on the chrome above every Settings page. The same
  `.rail__toggle` serves Admin.
- **The sheets close one way.** Search's Close is the X the bell and help
  use, which leaves the field its width: the placeholder reads "Players,
  clans, cards, help" in full on a phone (its label is still "Search
  players, clans, cards, help").
- **The bell** names cheers as cheers: "Cheers on your items" (it said
  "Reactions to your items").
