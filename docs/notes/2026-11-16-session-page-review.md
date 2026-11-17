# 2026-11-16 — Session page: read again for real, and one count per deck

Two fixes from the review of the session page (#1070).

- **Read them again** now marks every page of the session stale before it
  goes back to the first, so it reads the games afresh. Before, it could
  serve the cached first page with the version the server had just
  refused, and Older battles would refuse again.
- **The decks** section counts by deck. The update counts battles by
  archetype, so two different decks under one label each showed the
  label's total. When a label covers more than one deck, each now says its
  own count from the games on the page.

MCP 13.3.0 and JSON API 5.1.0, unchanged.
