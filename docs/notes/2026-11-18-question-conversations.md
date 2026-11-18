# Questions and reply conversations

Jamie approved the conversation follow-ups on 2026-11-17. Existing comment
notifications were already present, but each reply was a row and its link
opened a player page. Questions had no persistent answered state and hid
their count when all replies fit in the two-comment preview.

The existing bell now groups post replies per post before the 20-row cap,
with the latest reply, total replies in its seven-day window, unread count
and a stable post key. It retains the New and Earlier sections and the
existing seen marker. A question says answered your question. The link is
the signed-in /home/post/<id> destination. Ordinary game-item comments keep
their existing player-page behavior. Hidden posts and blocked authors leave
this read immediately. Comment text never enters an external delivery lane.

Questions is a source filter in Timeline and Clan. Clan also has Unanswered,
filtered before the cap, with full permitted counts for both chips. A
question remains unanswered until its author marks it Answered. The shared posts reader
filters SQL before its caps, after the same audience, moderation and block
checks. Questions cursors and query keys are distinct. Clan skips game
synthesis for Questions; membership and all private Clan permissions stay
at the existing boundary. All activity remains the default.

The author may mark a visible question Answered or unanswered with the
existing authenticated post update route. This updates only answered_at,
never created_at, updated_at or revision. Answers remain open and neither
answers nor marking a question count as new posts. This field is normalized
as post.answered, false on ordinary posts. Public shared projection omits it
and answer counts. The normal Timeline Questions chip omits a count because
the mixed feed's cap cannot count older questions honestly; the selected
Questions view has its own source count. Audience counts stay hidden while
Questions is selected because those chips return to the mixed feed.

A post's answers belong to its author even if their player claim changes.
All three ownership lookups (card summary, thread and write) read the
canonical post author; game items keep the current verified player owner.
The same migration repairs only historical owner stamps proven wrong by
joining the canonical post. A before-insert/item-or-owner-update trigger
normalizes old writers during cutover too. It preserves comment IDs, words,
dates, statuses and settings, and creates no activity or deliveries. The
read-only estimate was four timeline_comment rows, 8 KiB heap; vacuum after
that table is declared.

The nullable answered column is metadata only, no rewrite or backfill. Production
read-only preflight reported account_post at one page, approximately eight
live rows and 8 KiB heap. Migration has a five-second local lock timeout,
sha256 pin and fresh scratch-schema fingerprint. Migration 0297 follows the follow-event clock preparation 0296 and legacy-table cleanup 0295.

Coverage pins source filtering before caps; paging and cursor mismatch;
owner-only, idempotent mark/unmark with unchanged chronology and new counts;
coalesced unread notices, moderation and blocks; direct links; answer counts
at zero; feature switches; keyboard operation and responsive layouts.
