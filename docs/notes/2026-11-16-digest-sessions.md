# 2026-11-16 — The digest tells sessions; every session opens its page

The web's session card (`docs/notes/2026-11-16-session-page.md`) told a
sitting from its facts. The digest still printed a person as "N sittings ·
N battles · W–L" and carried no sitting at all. Now both say a sitting the
same way, and every surface outside the feed that names a sitting opens
its session page.

## One derivation

`packages/ui/src/session-story.ts` (`@elixir-mcp/ui/session-story`) holds
what the card worked out in JSX: `sessionHeadline`, `wherePlayed`,
`modesSaid`, `modeWord`, `trophyNet`, `signedCount`, `compactSitting`,
`sessionChips`, `modeChips`, `deckCaption`, plus `sessionPath` and
`sessionPathOf` (the session page of an item, or null for any other kind
and for an old row missing its id, player, start or session evidence).
Plain text, no markup: React escapes it on the web, `esc` in mail.
`apps/web` `Session.jsx`, `ModeLine.jsx` and `home/logic.js` import from it
and re-export what other modules read, so the web's output is unchanged
(the web tests and e2e are the proof). `scoresOf` moved from the web-api's
`feed.mjs` to `packages/tools` `entries.mjs`, which both read.

## The digest

- `buildDigest` reads the sittings too (`DIGEST_KINDS`), with its own
  timeline cap, `DIGEST_TIMELINE_CAP` = 2000: MCP's 150 is sized to a tool
  result, and a week of sittings from everyone followed must not push a
  highlight out of the read.
- Each person gets `sittings` (`pickSittings`: their own by
  `facts.player_tag`, the three with the most battles, ties to the newest,
  told newest first) and `more_sittings`. Each is stored as
  `{kind, at, facts, scores, deck, path}` (`digestSitting`): the facts the
  words are made from, never the timeline's sentence or a nickname, so a
  stored issue renders the same later.
- The render (`digestSittings` in `packages/mail/src/render.mjs`): one or
  two battles is one line (the linked headline, trophies, mode chips, deck
  label, time); a bigger one is a block with the linked headline, the
  figures (record, trophies, time), the chips, the deck row and caption.
  The deck's eight cards are drawn once a person, on their biggest sitting
  with a deck, from the mirrored art (never altered), which keeps the
  fixture digest at 33 KB, far under Gmail's ~102 KB clip.
- `sittingUrl` accepts only `/home/player/<tag>/session/<id>` paths.
- You: the reader's own sittings are not retold; You keeps its count and
  record line.

## Close friends do not lead it

The ask was to consider leading with "Your circle this week". DECISIONS "A
close friend is a private mark" (Jamie, 2026-11-16) says no mail or digest
carries the mark, and the circle is the mark made visible, so the digest
does not use it. It is a product call for Jamie whether the owner's own
digest may.

## Session links

| Where | Before | Now |
| --- | --- | --- |
| The bell's cheer rows | the battle, or nothing | the session page, then the battle |
| Cheers on your play (`activity_today`) | the battle, the player, Home | the session page first |
| The timeline's Discord line (`lines.mjs`) | the player's page | `[session]` link after any battle link, then the player |
| Clan's Discord post (`story-link.mjs`) | a sitting's best-win battle | the session page when the post tells one sitting |
| RSS (`feed-link.mjs`) | the player's page | the session page, in the existing `<link>` |

`readReactions` and `readAwayActivity` add `session_path`, so the web
push drain can use it too; the drain is not changed here (a one-line
follow-up in `cheersNotice`). Discord names stay escaped by
`escapeDiscord`; RSS by `xmlText`; mail by `esc`.

MCP 13.4.0 and JSON API 5.1.0 unchanged: no MCP item, its `text` or its
schema changed, and RSS gained no element. No migration.
