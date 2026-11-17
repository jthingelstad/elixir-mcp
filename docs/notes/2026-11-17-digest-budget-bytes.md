# 2026-11-17 — The digest's budget counts bytes, and items give way last

Codex on #1085:

- The budget counted string length (UTF-16 code units), not the UTF-8
  bytes Gmail clips at: twelve people with three 500-character CJK
  highlights each passed the clip. `digestPeople` now counts
  `Buffer.byteLength`.
- Highlights alone could pass the clip with no sittings at all (105 KB in
  that case, a gap older than the sittings). Past `ITEMS_BYTES` (75 KB),
  a person's items are counted ("N more on your timeline"), as the mail
  already counts what it leaves out; their name and record stay. That case
  is now 91.5 KB with the footer and its turn-off link inside; a normal
  week renders unchanged.
- The shortening is player-visible, so it has its What's new entry
  (`2026-11-17-05-digest-never-cut-off`), which #1085 lacked.

Render only. MCP 13.4.0 and JSON API 5.1.0 unchanged. No migration.
