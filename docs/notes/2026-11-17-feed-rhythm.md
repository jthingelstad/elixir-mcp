# 2026-11-17: The feed's rhythm

The owner said the app "leaves me wanting more". A week for an account
following about 55 people was about 160 items, most of them one-battle
sessions at about 260px each, so the big moments were buried, and a
moment was a grey icon box and a sentence. This pass changes how the
Timeline draws a day; what it reads and in what order is unchanged.

## What a day draws

`FeedRows` (`apps/web/src/home/FeedItem.jsx`) takes a day's rows and
`feedRows` (`apps/web/src/home/logic.js`) decides their shape:

- **A short session** (`shortSession`) is a `battle_session` of one or two
  battles, not a close friend's, with no comment, and with no mode chip
  past a Ranked session's plain league: a climb, a rating, a challenge
  run's wins, drafted decks or a followed player met keep the card. A
  lone one is a **line** (`SessionLine`): face, name, time, the headline
  with its signed trophies as the link to the session page, and its
  Cheers on the right; no deck art. The Comments mount stays on the line.
- **Two or more short sessions in a row**, whoever played them, are one
  **group** (`SessionGroup`): a 44px toggle with up to three faces, "N
  short sessions from A, B and 2 others" (or "Pip played 3 short
  sessions"), battles, won, lost, the time range, and how many cheers
  they hold between them. Open, each session is its own line. The row
  that carries the "New since your last visit" line ends its group, so a
  group never crosses the marker.
- Everything else keeps its card (`FeedItem`), in its place: newest first
  is untouched.

**Cheers on grouped items.** Cheers stay per item id. The group takes no
cheer and has no id of its own; opening it (no fetch, the items are in
hand) shows each session's own Cheers. Closed, it shows the sum of its
items' cheer counts, counts only. No data-model change.

**Close friends.** A starred friend's session never folds, and every item
about them shows a small star beside the name (`CloseMark`, title "Close
friend. Only you see this."). It reads the item's `groups`, which only
the owner's read carries. The order is never changed for them.

## Moments get their art

`MomentArt` and `momentHead` (FeedItem.jsx):

| Kind | Art | Head |
| --- | --- | --- |
| `card_unlocked` | the card's own art (`CardArt`, base) | "New card" |
| `card_form_unlocked` | the card's art in its form, the kit's ribbon | "New Evo" / "New Hero" |
| `badge_earned` / `legendary_badge_earned`, a Mastery badge | the card's art (`moment_card`) | "Card Mastery" |
| `arena_changed` (up) | kit mark, castle icon | "New Arena", headline |
| `ranked_promotion` | kit mark, crown icon | "New league in Ranked", headline |
| `best_trophies_band` | kit mark, award icon | "New best", headline |
| other moments | the medal as before (hidden on phones, as before) | none |
| clan items | the clan's Avatar on the band, replacing the shield icon | none |

Card art is drawn by the kit's `CardArt` with `showLevel={false}`: never
tinted, cropped, filtered or covered. Elixir has no Arena or league art,
so those get a kit mark and no invented art. An Arena move down is a
moment but not a headline (the syndication's rule). The headline wears a
violet edge, not gold: gold is the brand's and the clan's.

`moment_card` is new on Home's feed items (`services/web-api/src/feed.mjs`,
`annotateFeed`): for a Mastery badge, `{id, name}` from the badge's own
identifier (`masteryCard`) and the catalog, in one `card` read per page,
skipped when the page has none. Absent when the catalog has no such card.

## Clan's Feed draws with the same components

`apps/web/src/clan/views/Feed.jsx` now renders each day with `FeedRows`,
so the Timeline and Clan's Feed cannot drift. Its read
(`services/web-api/src/clan-feed.mjs`) sends each item as the Timeline
draws it, through the same `annotateFeed`, without Home's own fields
(`groups`, `offer_follow`, `section`; it never had cheers or comments).
This replaces the 2026-11-12 rule that the Feed sent "never its facts
whole": the reader is the same member the timeline's reader rule already
lets read the item, and Home's read of the same clan already sends its
facts whole to the same person, so nothing widens. Clan's Feed takes no
cheers and opens nothing in place, as before; its paging is unchanged.

## Measured

On the fixture week (61 items, `apps/web/e2e/feed-rhythm-fixture.ts`), the
Timeline's full page went from 17,412px to 9,157px at 390 wide and from
17,225px to 7,795px at 1280. `apps/web/e2e/feed-rhythm.spec.ts` pins
folding, cheering inside a group, the star, card art, the headline, 44px
targets at 320 on a touch device, no sideways scroll, axe, and Clan's
Feed.

## Also

- The session page's loading state is the kit's `Skeleton`.

## Left out

- Exact per-deck counts on a long session's page: the counts come from
  the timeline item's facts by label and fall back to the loaded page.
  Exact counts mean a session-wide count in the session evidence read
  (`packages/tools/src/activity/entries.mjs`, `sessionGameDetail`), shared
  with the evidence tools; it deserves its own change and test.
- The MCP descriptions that still say "sitting" are untouched: no
  contract bump in this change.

MCP 13.4.1 and JSON API 5.1.0 unchanged.
