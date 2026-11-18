# Time of a player follow

A player can be on an account for some time before the person chooses to follow them as a friend. Notifications used the date the player was first added, so a genuine new follow on an old claim could be missed. Looking only at the age of the claim would also make a recently added player appear to have followed someone during the upcoming Watching conversion.

Migration 0296 gives each follow an event time in `claim.followed_at`. Existing friends retain their previous notification dates. A new friend follow records its time, changing an unrelated setting keeps it, and leaving the friendship clears it. The Notifications read and the mail and push candidate queries all use that time. Existing preferences, delivery limits and claim creation dates continue to apply.

This release goes to production while both relationship types still exist. The Watching conversion can then preserve claims with no follow event across a rolling Lambda deployment. An earlier Lambda invocation can finish with either version during this release because every existing relationship still has its original meaning.

Production table statistics estimated 122 claims on two heap pages. The migration bounds lock acquisition at five seconds and the statement at twenty. The migration runner vacuums the table after commit. The scratch regression checks the original claim data and all original friend dates on 122 fixtures. Another regression exercises an old claim, a new follow, and the three alert readers. Production verification uses deployment receipts and read-only diagnostics.

MCP 13.12.0 and JSON API 5.1.0.

During the release check the member-post keyboard journey opened the picker again when it meant to remove a cheer. Closing the picker scheduled focus on the next animation frame. An intervening focus change could therefore send Enter to the picker toggle. Both return controls stay mounted, so the picker now restores focus immediately. The focused keyboard test reproduced the bug on the prior code. The browser journey uses Shift+Tab from the returned focus and still verifies the second write and its visible count.
