# Home's stored week: Codex's two findings on #818

2026-11-12, follow-up to [the stored week](2026-11-12-home-feed-stored.md)
(#649).

## Attested facts are read live (P1)

The stored week held the builder's attested facts as it found them. Who may
see a clan's fact or a leaders' fact is decided at the read (`factItems`:
an open membership of a verified claim, and a leader's rank for leaders'
facts). A reader who left the clan, or lost the role, kept seeing those
facts from the stored row for up to three hours.

The read now drops every stored `section: "attested"` item and reads the
week's facts live (`windowFacts`, one statement, the same visibility rule
and dedupe as the builder), as it already did highlights. Nothing about who
may see what changes: the rule is the builder's, applied at every read
again.

## More continues after the last item served (P2)

A page's cursor named an offset into the week. Live highlights and facts
can arrive or go between pages, which shifts offsets: an item repeated or
skipped. The cursor now also names the last item served (its shown instant
and id), and the next page starts after it in one total order (`feedOrder`:
newest first, then id). An older cursor with no item still reads by offset.
The cursor stays opaque, and the response shape is unchanged.
