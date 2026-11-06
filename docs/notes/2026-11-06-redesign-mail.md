# 2026-11-06 — Redesign step 8: mail

What Jamie ruled on 2026-11-05 (`docs/product/structure.md`, "Mail links and
footer", D9 to D12), as built.

- **Links.** The render chooses one door per name for the reader: their own
  player to Ladder, a clanmate to the Clan member page, anyone else to the
  record; a clan they are in to Clan, Season, with the roster link to Members
  and a button that names the clan. Who the reader is comes from
  `services/jobs/src/email/reader.mjs`, read at send and never stored, so one
  clan's issue stays one set of facts. A render with no reader (a preview, an
  old send) falls back to the record pages, which open for anyone signed in.
  A signed-in person outside a clan lands on that clan's record; signed out,
  Clan explains and brings them back.
- **Paths.** `packages/mail/src/paths.mjs` holds the addresses that belong to
  Settings, in one place. Its routes landed first, so mail links them directly.
- **Footer.** One line, the short id shown and the whole id in its link. The
  disclaimer is unchanged. The word Console is gone from mail: `render.mjs`,
  `shell.mjs` (now "Admin") and the welcome.
- **Empty reports (D9, A20).** `nothingHappened` in `build-clan.mjs`. A race
  with fame counts. A read that failed still sends with its gap noted.
- **Reason lines (D10, A23).** `actionReason` in `clan-engine`. `lines` may now
  be `{title, reason, number, new}`; the row links by number and never says it,
  and Discord keeps `actionLine` unchanged. JSON API 3.4.0: the `ClanMail`
  line gains that shape, plain strings still accepted. `{{when:<instant>}}` in
  a reason names the time in the reader's zone.
- **You line (D11), Gone quiet (A19, Q2).** Per reader, at render. A quiet
  entry composed before this has no date and draws nothing.
- **Alts' firsts (D12, A21).** `heldAltFirsts` reads the same moments and the
  same journal. Tuesday's mail writes the journal when it sends, so a first is
  told once. With Arena off the journal stays unwritten and the timeline has it.
- **Clan's own words.** `cardRationale` reads as the board does for new cards;
  stored cards keep the words they were written with.

No migration. MCP unchanged. JSON API 3.3.0 to 3.4.0. Facts stored in old issues
still render; the mail archive and send ids are untouched; SES tracking stays
off, and the pixel stays per mail.

Engineering defaults, tagged in DECISIONS: an opponent who is a clanmate opens
in Clan; "was removed" is said only to the clan's own readers, because the fact
is clan-visible; decks draw from five battles; a rationale says "This clan"
because it carries no clan name.
