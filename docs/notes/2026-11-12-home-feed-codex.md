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

## The database the numbers were read on

The instance is a db.t4g.micro in unlimited credit mode: since the 19:36Z
restart its CPUCreditBalance sits at 0 while CPUSurplusCreditBalance
accrues (1 to 4), which happens only in unlimited mode, so CPU was not held
to baseline. Its EBS byte balance (the instance's burst bandwidth to
storage) was at 0 from about 18:00Z to 19:30Z and back at 79 to 88 percent
from 20:00Z. The before numbers (Home's feed 15 s p95 over three days; the
owner's week 12.3 s at 21:07Z; `elixir_timeline#1` 8.7 s at 21:09Z) and the
after numbers were read with credits unthrottled and the EBS balance above
75 percent, except the 18.3 s cold read at 19:58Z, at the edge of the
drained window.

## One fact, one id (Codex on #824)

The live facts collapsed a fact written twice with a dedupe of their own,
which kept the first by instant. The builder keeps the first by instant
too, but names it by the lower ledger row's story (#111), so a backdated
second row gave Home an id the builder did not serve, and a cheer on it
failed the cheers route's check against the builder. Home's live facts now
collapse repeats with the builder's own function (`collapseRepeats`).
