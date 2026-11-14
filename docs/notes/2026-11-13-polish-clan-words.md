# 2026-11-13 — Polish: Clan's head and one vocabulary

Part 3 of the polish pass on the signed-in app. Layout, styling and label
wording only: the same reads, the same rules, nothing anyone can see or do
changed.

- **Clan's head.** The clan picker's "Clan" label is for screen readers
  only (it floated above the select beside Follow; the select's text names
  the clan). "Roster read …" is quiet text, as Home's freshness is, not a
  pill on its own row. On a phone the six tabs share the row's slack, so
  no two labels sit closer than the rest (Members ran into Policy).
- **Stats, not Ladder.** A former member's note says their record stays
  in Stats (`MemberActivity.jsx`), as every other page names it.
- **Unfollow.** The button that ends a follow is **Unfollow** everywhere
  (Settings' follow slots and a mistaken tag's fix, their dialogs, the new
  account's clan offer), and the sentences that point at it say Unfollow.
  Ending a watch stays **Stop watching**. Docs and tests follow.
