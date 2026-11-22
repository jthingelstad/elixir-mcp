# A restored comment joins its conversation

2026-11-22, follow-up to `2026-11-22-owner-joins-conversation.md` (Codex,
on #1183). The conversation trigger fired on insert only, so a comment
hidden by reports and later restored joined nobody. Its owner then had no
conversation, and the bell, which counts such a comment as unread, would
show it new for good. 0313 runs the same join when a comment's status
becomes visible: the author at their comment, the owner just before it.
