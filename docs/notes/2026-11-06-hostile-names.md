# 2026-11-06 — Hostile names

Jamie: "we need to make them EXCEEDINGLY html safe." A Clash Royale name is free
text, and some hold `<`, quotes and worse. The rule: a name is stored as the game
sent it, apart from colour markup, and escaped by each output for its context.
Never store an HTML-escaped name.

**What was checked.** The web app renders names as React text. Its one raw sink is
`packages/ui/src/Markdown.tsx`, which shows feedback and notes, not names. Every
mail in the preview gallery was rendered with markup in each name field
(`packages/mail/test/hostile-names.test.mjs`). Battle pages, share images and the
OAuth pages escape, and have tests. The app's bootstrap JSON escapes `<`.

**What changed.** A `"` in a Markdown link could close the `href` and add an
attribute. The site's script policy stops inline handlers, so nothing could run,
but the attribute was real. `escapeDiscord` now escapes `:` too, so a name holding
a link or an emoji code stays text, and the clan hello line uses that one function.

**The edge.** The shared web ACL blocks script-like text in the first 16 KB of a
request body. Collector submissions are gzip+base64, so a name cannot stop a
submission. A search or feedback holding such text gets a 403 from the edge
before Elixir sees it.

**Two rulings after the audit.** `<c/>` is colour markup too, stripped at ingest and
from stored names (0235). Control characters and text-direction overrides are
stripped at ingest only, so a stored name loses them when it is next recorded.
Direction marks, joiners and variation selectors stay.
