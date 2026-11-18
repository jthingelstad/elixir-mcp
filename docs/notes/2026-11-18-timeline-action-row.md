# 2026-11-18 — One Timeline action row

Compact sessions and moments placed their cheers beside the text, comments
below, and Share on another line. Full cards also separated commenting
from their reaction and share controls. All FeedItem variants now use
ItemActions: the existing compact cheer control and picker, a speech-bubble
comment or answer count, and Share at the end. Latest comments and the open
thread sit below that row. Additional share tools appear below it after a
link is ready. Every primary control retains a 44px target.

[engineering] Use the existing compact cheer count on full cards too: the
main kind's count and +N other cheers. The full breakdown remains in the
accessible description. The speech bubble uses the existing message-circle
glyph; a zero-answer question still says zero to assistive technology.
The entry focuses its composer when replies are open; a closed conversation
opens for reading. Exact notified entries retain their reply focus. Evidence
and account links remain separate navigation.

Comments keeps its standalone renderer and owns its state; renderActions
only places its entry beside the other controls. commentEntry is forwarded
through full cards, compact rows and folded groups, with itemId selecting
one conversation in a group. Comments-off, null eligibility, private-share
and public-view rules are unchanged. No API, schema or delivery change.

Regression fixtures cover full/compact sessions, compact/notable moments,
clan results, question posts, entry forwarding and private/public boundaries.
Before/after browser captures at 320, 390 and 1280 were inspected, including
keyboard picker/close, composer focus, count targets and Share feedback.

MCP 13.14.0 and JSON API 5.1.0 unchanged.
