# An item's owner joins the conversation others start on it

2026-11-22. A member reported that comments on their items never reached
them. The `{comment_delivery}` op (#1180, #1181) showed all four comments
passed every bell condition, and the member had opened the bell after
each. Their screenshot showed why they still missed them:

- Opening the bell marked every comment seen, whether or not its row was
  ever on screen.
- Earlier listed lines by kind (every cheer, then every follower, then
  comments), so a seen comment sat at the bottom of a long scrolling list.
- My conversations held only threads you joined by commenting, so a
  comment on your item never showed there.

Jamie, 2026-11-22: "Conversations should also pull in people commenting on
your timeline items."

What changed:

- 0312: the `join_comment_conversation` trigger (0303) also joins the
  comment's owner (`owner_account_id`: the verified-player owner of a game
  item, the author of a post) when the comment is someone else's, visible
  and `receipt_allowed`. The owner's read position sits one microsecond
  before the comment, so it is unread. `postChecked` gives that row the
  item's locator. A backfill joined the owners of existing comments,
  positioned before the earliest.
- The bell's `readComments` counts a comment new while it is unread in
  that conversation (after the read position, with no read receipt), as
  `readConversations` counts. Opening the bell reads nothing; opening the
  thread reads what it serves (`readConversationThrough`). `bellSeenAt`
  keeps comment rows new and the badge counts them. The thread read
  answers `yours: true`, and the app then reads the bell again so the dot
  clears. A game comment's row opens the item itself at that comment when
  the conversation has the item's locator, and otherwise the player's page.
- `bellGroups` sorts New and Earlier newest first across kinds. Follower
  rows carry no time (the bell shows none), so they keep their order after
  the timed rows.

Nobody is sent anything new: comments still reach only the owner's bell
and My conversations, never push or mail. Whether a comment should also
reach its owner by push is "who is sent what", so it is Jamie's call.
