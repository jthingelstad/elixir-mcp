# 2026-11-18 - My conversations

Jamie approved a private place in Notifications to resume conversations a
member actually joined. Activity keeps its existing receipts and badge.
My conversations records participation only after an accepted comment or
answer, and keeps that place if the member deletes their contribution.
Posting, viewing and cheering alone do not join a conversation.

Migration 0303 adds `comment_conversation`, keyed by member and canonical
Timeline item ID. It stores a source locator and a read tuple, never reply
words or a participant list. The membership write is atomic with the
comment. A compatibility trigger covers comments posted by the previous
Lambda during cutover. Historical participation begins at the member's
latest own contribution and retains its subject for exact source recovery.
No source access can be inferred from membership or a locator.

The list re-resolves each item under its canonical current source audience.
Unread replies exclude the reader, hidden/removed/reported comments,
unapproved authors and blocks in either direction. Thread pages advance
the timestamp and comment ID cursor only through a contiguous read stretch.
Private `comment_conversation_read` receipts keep served replies read beyond
an earlier unread gap, so opening a latest page never clears unseen replies.
Only comments actually served are marked. PostgreSQL precision and the ID tie-breaker keep replies
at the same timestamp distinct. The exact member destination opens the
first unread reply and can read later replies with Show latest.

The list is available only to the person who owns it, never another
member, an agent, MCP, RSS or a public share. No new mail or push is sent.
No legal wording changes are included. Parent release coordination owns
deployment and production readback.

MCP 14.0.0 and JSON API 6.0.0 are unchanged by this member-only feature.
