# Posts in N new and the existing digest

Jamie approved both improvements on 2026-11-17. A new post should reach a
returning reader while their Timeline is open, and the existing digest
should carry the words people share in Elixir.

`packages/posts` is the canonical member reader. Web API reads delegate
to it; normalized decks/cards, current audience, two-way blocks and open
reports come from one source. No service imports another service. Plain
posts stay outside the game-record timeline and MCP.

The first-page watermark includes live posts. N new adds a bounded live
post count to the existing stored-week count, without building a game
record. A post counts by creation; editing does not create more news.
Account-only follows and own posts work even without a cached game week.
The count compares PostgreSQL timestamps at the same millisecond precision
as normalized JSON items, so sub-millisecond creation times do not repeat.

The digest explicitly reads visible-only plain posts in its creation
window, then applies its existing limits. Existing battle posts retain
their path. Account-only authors can stand without game activity, and a
post-only digest names posts rather than zero battles. Deck/card art is
unaltered. The destination is `/home/post/<id>` after sign-in, with a fresh
audience check, never a new public token.

No cadence, opt-out, ledger, empty-mail rule or subscription changes. No
actual sends were used for verification. As before, archived/outbox mail
is a snapshot that cannot retract after a post is moderated or deleted;
composition and destination reads check visibility at their own time.

Verification is recorded in the PR: failing baseline N-new/digest tests,
SQL-backed audience/moderation/cadence/ledger regressions, bounded mail
HTML, narrow images-blocked previews, Timeline keyboard and accessibility
checks, and full local gates. Production delivery remains to be observed
naturally after the coordinated deployment, without manufacturing mail.
