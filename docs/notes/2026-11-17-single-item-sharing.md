# 2026-11-17 — Share one Timeline item

Jamie approved any member sharing a public-safe item they can see, including
someone else's post, and retiring previous public links. Issue #1130 holds
the exact Privacy wording and his approval; it is applied without other
legal changes. The mark and icon are untouched.

Share is one action, without creating a post. It opens native Share or copies
the server URL. Cancellation or clipboard failure leaves a selectable link.
The picture and Copy for a post remain available after the link is ready;
optional typed battle context remains a private outbound message draft for
the participating account. Shared pages show one card or battle and a way
into Elixir. Member post destinations serve existing digest links privately.

Migration 0294 creates an empty timeline_share capability table with 120-bit
random keys, unique canonical item IDs, source checks, foreign-key cascades
and indexes. No record or post is copied or deleted. Onboarding's 293 index
lands first. Sha256 pins and a fresh scratch schema fingerprint accompany
both. Metadata expires after a year; sharing again renews an expired grant with a new random key without reviving its old URL. Canonical source retention and the
session reader's 30-day window can end a link earlier.

Creation authenticates a person, bounds issuance to 120/hour, re-resolves the
source and checks the canonical post audience, reports, blocks, publication
and author status. Public reads require the opaque capability and re-read
its source. Every post uses the canonical post reader; the game selector
rejects legacy battle_highlight items so it cannot bypass post visibility.
An allowlisted projection excludes social controls/counts, account notices,
all attested Clan state, location/progress and private nicknames. Unknown
kinds fail closed. JSON, HTML and PNG say no-store/noindex/nofollow; edge
behaviours have zero minimum TTL and carry no cookies. Measurement omits
capability tokens, including direct loads and referrers.

Bare battle pages and pictures are now authenticated, as their member data
route is. Former anonymous battle/session/post data routes and old /h and
/session pages 404. The old public readers and UI routes are removed. Every
active post-link producer, including the existing author-only Clan Discord
lane and MCP owner share_url, reads the new capability. No new mail,
Discord, RSS, push or MCP publishing lane is added. MCP 13.12.0 describes the
changed link access; JSON API 5.1.0 and item schemas are unchanged.

Engineering calls: one stable active link per item regardless of who shares it;
no sharer, opener or referral identity; no anonymous history or pagination;
no automatic publication on an MCP read; all attested Clan facts withheld,
even where a leader can see them. Noindex asks cooperating crawlers to stay
out; the opaque token and closed source routes enforce the access boundary.
Anyone holding a link can pass it on.

Left outside this change: frozen battle_highlight storage/triggers (#1119)
and retired account_post.share_id/shared_at columns retain existing data
but have no active sharing readers or writers. Their removal is a separate
schema contraction. Plain posts' RSS/push/Discord/MCP reach is not added;
the existing digest is handled by the companion posts PR. No production
post, follow, cheer, comment, email or collector read is manufactured for
verification.
