# A member's away is the clan's

2026-11-24. Jamie, asked whether the `member_away` fact should match the
Away exception (always one the whole clan sees): "Match".

- `member_away`'s visibility is `clan` (`packages/contracts/src/facts.ts`).
  Visibility is the type's rule at read time, so every stored away now
  reads as the clan's, with no migration: the Timeline, Home, the RSS
  feed and agents reading as a clan member all carry it, as they do a
  departure's kind.
- It stays in Elixir. `isPublishable` leaves it out
  (`packages/tools/src/activity/entries.mjs`), so a person's Timeline
  cross-post never carries it, and Clan's Discord activity already left
  it out (`activityShareable`). Public share links carry no Clan fact.
  [engineering]
- No fact type is leaders-only now. The `leaders` visibility class and
  its read path stay for a later type. `timeline-social-items.test.mjs`
  lends `member_away` the leaders' rule for its own run, so a private
  Clan thread's recheck of the reader's current role stays pinned;
  `feed-week.test.mjs` now pins the feed's narrowing by the people line
  and the live fact read.
- Run › Discord's sharing list says an away goes to everyone verified in
  the clan.

Docs: `clan-settings.md`, `roles.md`, `timeline.md`, `timeline-tool.md`,
`your-account.md`; DECISIONS "Attested facts".
