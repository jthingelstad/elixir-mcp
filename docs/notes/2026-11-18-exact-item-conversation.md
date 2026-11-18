# 2026-11-18 — Exact item conversations and dated digest updates

Jamie approved recommendation 1: shared Timeline items should lead back to
the exact signed-in item and thread, and digest items should show their date.

The member destination is `/home/item/<canonical-id>` with a bounded source
locator. The shared `@elixir-mcp/ui/item-link` helper keeps only source IDs,
the named subject, kind and anchor time. Submitted words, names and facts
never enter the URL or authorize a read. The web API reuses the canonical
member resolver and live cheer/comment decoration. A private Clan item's
current membership and role checks remain its authority. Blocks, post
moderation and post audiences are checked again.

Shared pages supply a member destination from the capability's retained
canonical source. Signing in preserves it; an unavailable member item shows
no content or thread. A shared raw battle opens its existing battle page.
The public copy remains free of comments and cheers. These URLs, locators
and reply IDs never enter analytics or raw-document analytics embeds.

The destination opens the existing thread and can focus the first unread
reply. The private conversation feature may provide exact timestamp/ID
cursors or canonical per-reply unread flags; those take precedence over
legacy time-only highlighting. Legacy comments retain their history:
current canonical posts resolve directly, and game/People items can recover
an exact-ID locator through their original named subject and a bounded
month around the comment. No match produces no misleading link.

Digest facts capture a member path beside each post and game update. The
renderer shows its original day and time through the shared account clock,
including non-post milestones and posts about older battles. Older stored
issues without a member path retain their existing post/battle links.

Engineering calls: use the existing source locator rather than issue another
capability; keep the unavailable state deliberately free of private details;
retain first-unread reply anchors across sign-in. No new notification,
recipient, game read, schema or standing capacity is introduced here.

MCP 14.0.0 and JSON API 6.0.0 are unchanged; this is an internal web and mail
change. Production verification is read-only; local source and browser
fixtures exercise the successful writes and denied audiences.
