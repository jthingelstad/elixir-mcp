# The comment-delivery op

2026-11-22. A member said comments on their items never reached them. The
bell is the one place a comment reaches the person it is about
(DECISIONS "Comments, checked before they post"), and it applies nine
conditions (`bell.mjs` `readComments`). No op could say which of them a
given comment failed: `{tag_footprint}` counts rows only.

`{comment_delivery}` is a read that, for one player tag, lists each
comment of the last 30 days on its items and posts with each condition
as a boolean, the tag's claims and the owners' bell seen marks. Accounts
appear by an eight-character id prefix, and no body, name or address is
returned. It changes nothing in what anyone is sent.
