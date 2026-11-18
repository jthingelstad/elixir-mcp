# Watching retires into friend follows

Jamie approved retiring Watching and MCP 14 on 2026-11-17 (US Central).
Primary and alt remain the players a person plays as. Every other player
follow is a friend, including an agent's follows. An agent still has no
player of its own and cannot claim a primary or alt.

The migration changes watched relationships in place. It preserves claim
creation dates, status, notify choices, private nicknames, close-friend
marks, recording reasons and pooled slot use. It creates no account links,
extra player follows or account events. Ordinary future person follows
keep verified-account linking. A person's friend follows have the same Timeline filter,
Stats eligibility and current follower-list visibility. An agent's follows
remain on that agent and create no social writes. Shared social reads
keep two-way blocks in force, including watched recordings a block had left
intact; the conversion never revives a blocked social association.
The writer checks a block against the actual resulting relationship,
including unnamed later additions and explicit relationship changes.
Idempotent additions return the stored relationship and notification choice
from the canonical writer, so MCP never reports a muted primary or alt as
an unmuted friend.

Follower notices previously read claim creation dates. Simply changing the
relationship would have manufactured notifications for recently watched
players. `claim.followed_at` is now the canonical follow-event time: prior
friends keep their original date, migrated follows have no event date,
and future friend inserts or transitions get their real date. The shared
bell/away-activity reader and both jobs candidate selectors use it, covering
push and activity mail without recipient marker resets or channel exceptions. Editing a migrated
follow's notify setting never creates a follow event.

The timestamp column, trigger and notification readers go live in a
preparatory release while Watching is still valid. Only then does this
release convert the claims. That order prevents old jobs code from
interpreting a converted relationship as new activity between migration
and the Lambda flip. The conversion temporarily disables the stamping
trigger under its exclusive table lock and restores it before commit.

The schema change is a bounded conversion and NOT VALID relationship
check, followed by validation in the next migration. Production metadata
read by the primary agent showed 122 estimated live claim rows, two heap
pages and 16 KiB of heap. Both files bound lock waits to five seconds and
statements to twenty; the conversion declares its post-migration vacuum.
No production data write was used for verification.

MCP 14 removes the watching argument and identity group. Explicit old
watching calls are refused; unnamed later additions become friends. The
person's first unnamed player still becomes primary. JSON API 6.0.0 removes watching from the documented `/api/v1/me`
relationship enum; that path and all other fields stay unchanged. Settings has Friend and Also you choices, one Friends list, and
Unfollow. The existing follow-any-player documentation address stays valid.
Legal copy and the Elixir mark are unchanged.

Regression coverage starts with three tests that fail on the old behavior:
the default non-primary relationship, agent friend follows, and retired
source writes. Migration coverage compares the original claim rows and
dates, checks private names and explicit notify choices, preserves real
follower activity, excludes converted follows from away activity, and
asserts no synthetic account link or event. Changed caller tests cover
Stats, identity, slot pricing, linked follows and close-friend boundaries.

The repository shipping, tool-change, migration and consistency skills
guide this change. Browser plugin is unavailable; visual checks use the
repository's Playwright fixture harness bound to loopback port 4392.

The final consistency trace found another derived reader: Stamps counted
raw friend claims, assuming a block had removed each one. Old watched
recordings could survive a block and become friend claims during conversion.
A single visible-friend predicate now serves public follows and Stamps'
current and launch snapshots and new Played Together facts. Two-way blocks
exclude those retained associations; ordinary unblocked follows join the
usual eligibility on reconciliation. Earned Stamps remain append-only and
are not revoked. Mixed historical watched/friend fixtures cover both block
directions, ordinary mutual eligibility, recorded play and earned-row
preservation. No new Stamp kind, event, mail or push was introduced.
