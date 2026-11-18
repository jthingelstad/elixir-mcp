# 2026-11-18 — A Share icon on Timeline items

Jamie asked for a Lucide glyph in place of the repeated Share label. The shared item control already requested Lucide’s `share-2`, but the app’s icon registry had no entry for it and rendered only the word. Registering it once supplies the glyph for cards, compact rows, posts and the session and battle pages.

The idle button has a 44px minimum target, an accessible name and a hover title. After activation it still shows the progress or outcome in words. Native sharing, clipboard and manual-copy fallback use the same existing capability. No API, schema or audience change. MCP 13.13.0 and JSON API 5.1.0.
