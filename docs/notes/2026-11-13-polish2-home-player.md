# 2026-11-13 — Polish round two: Home's chips, the player page, You

Round two of the polish pass on the signed-in app, from the design lead's
review of round one's captures. Layout, styling and label wording only:
the same reads and the same rules.

- **Home's chips on a phone.** The chips run 2px tighter a side. Where the
  row still scrolls, it ends at a hairline before New, so a cut chip
  (You, at 390px) reads as cut under the kit's fade, never as one chip
  painted under New.
- **People you know.** Show all and the foot keep their 44px taps, but
  the taps overlap the rows' own space, so the block keeps the rows'
  rhythm (no dead band between Show all and the foot line).
- **The player page's head** is two actions at most, in one row: where
  you stand (You, Following or Follow) first, Stats second. **Follow
  everyone** in the player's clan moved to the foot of the Follows tab,
  beside "Everyone in <clan>". The counts sit on the page's gutter on a
  phone, not indented to the name, and the head keeps the reading
  column's measure on a wide screen, so its actions sit over the
  timeline. The tabs' own margin is gone (the page's grid gap is their
  space), so the timeline starts about 20px higher.
- **Following offers Unfollow.** On a player you follow, **Following** is
  the Follow pill pressed; tapping it asks "Unfollow <name>?" with the
  sentence Settings' Players & following asks it with, and removes the
  follow on **Unfollow**, as Settings does (`POST /api/claims`,
  `action: "remove"`). The docs said Unfollow was on the player's page;
  now it is, and the docs say how. A watched player's page still offers
  Follow, so the docs send Stop watching to Settings.
- **Your own player's page** (your main or an alt, `/home/player/<tag>`)
  lights **You** in the bottom tabs (`barArea(path, me)`); another
  player's page keeps Find.

Captures: the e2e fixtures (invented players) at 390x844 and 1280x800.
