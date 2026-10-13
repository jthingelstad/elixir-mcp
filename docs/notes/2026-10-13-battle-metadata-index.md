# 2026-10-13 — Cover battle metadata reads

Native Lambda Web Functions release acceptance exposed historical timeline
reads above the existing 15-second catalogue ceiling and a month-presence
read at the 20-second client deadline (#576). Exact production plans for
`clanLearnedQuery`, `clanMemberBattlesQuery`, `clan.most` and `quiet_gaps`
repeatedly read the wide battle heap or fetched `created_at` per participant.
The table census estimated 101,426 live battle rows, a 144,990,208-byte heap,
and 100% all-visible pages. The month member query scanned about 102 MB
of heap pages. RDS CPU and connection readings did not show exhaustion.

0227 adds `battle_metadata_cover`, keyed on `battle_id` with `battle_time`,
`created_at`, `type` and `event_tag` included. This serves both the broad
joins and point lookups without changing SQL, bounds, late-capture accounting,
output, contracts, or acceptance budgets. No backfill is needed. The primary
key and existing indexes remain; this is additive under the running code.

The migration takes a SHARE lock (reads continue; writes wait), with a
5-second acquisition limit and a 10-second statement limit. A fresh scratch
ladder, populated with 110,000 synthetic wide battles and participants,
had a 180,224,000-byte battle heap. The build took 347 ms and the index was
14,540,800 bytes. Normal planner settings selected index-only scans with
zero heap fetches for both imported queries under observed and occurred
bounds, and for the created-at point lookup. Result hashes matched before
and after. Battle buffer visits fell from 8,760–22,000 to about 1,750 for
these broad queries. Local elapsed times were 21–202 ms after versus
26–213 ms before; one warm occurred query was slightly slower, so this is
buffer-traffic evidence, not a universal latency claim. Production profiling
and the unchanged full release acceptance suite are the final verification.

The migration checksum and schema fingerprint are pinned from a fresh scratch
database. No product decision or permission change is introduced.
