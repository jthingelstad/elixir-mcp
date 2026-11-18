# Deck slot display order

Jamie reported that Evolutions and Heroes appeared at inconsistent positions. Deck identity readers sort by card ID/form; played arrays retain API order. Neither is a universal presentation layout.

The shared pure `@elixir-mcp/ui/deck-display` helper produces a new eight-card array: active Evo, active Hero or Champion, remaining eligible card, then ordinary cards. Ordinary cards fill unused positions. Relative order within roles is stable. Catalog rarity identifies Champions without changing their played form. Available forms, art and ownership bits never activate a form. More than three special cards, more than two of either eligible role, and non-eight-card arrays retain source order. No locks or historical unlocks are guessed.

The app's catalog provider supplies rarity for existing snapshots. Server deck projections supply catalog rarity at their shared source and the digest preserves it. Card keys retain their source index, preserving keyboard focus when late catalog rarity moves a Champion. Mail and PNG use the same helper; loose card attachments opt out. Verification positions, raw played arrays and parallel levels, canonical deck identity/hash, MCP output, pasted links and Copy deck order stay intact. No migration, extra game API call, subscription, legal text or new image processing is introduced.

Canonical game meaning is recorded in the sibling cr-agent-api-docs reference with the dated Supercell source. Current Trophy Road special slots unlock by Arena, not a newly inferred player-level rule.

Validation includes red-before kit regressions, pure role/immutability/exception cases, catalog lookup, rendered mail and PNG ordering, real source projections, and fixture browser journeys at 320/390/1280. Browser plugin not available; repository Playwright is used.

MCP 13.12.0 and JSON API 5.1.0 unchanged: this corrects visual ordering and adds catalog metadata only to web/mail projections. No tool-served fields or ordering change. Production verification uses reads; no share, post, cheer, follow or mail is manufactured.

The full gate exposed two intermittent test defects, repaired in this PR. The refresh fixture now waits for each client socket's public end event after pool shutdown before dropping its database. The Stats benchmark uses two explicit, seed-anchored fortnights (68 battles, 50 PvP in the recent window), so its data volume cannot grow with the calendar month. Authentication stays on the real clock; all original buffer ceilings, scan and index guards remain. A controlled diagnostic reproduced 1,002 buffers against 1,000 with fully visible maps and zero index-only heap fetches, ruling out vacuum setup as the cause. Failures now include per-statement plan and heap-fetch evidence. No production query was changed for either fixture repair.
