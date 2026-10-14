# 2026-10-13 — Finish the card-art mirror boundary

Verify’s target and latest-battle decks, the collector picker and new assignments,
and every collector read (public status, fleet ladder, Admin and the operator’s
own list) now derive base art from the catalog through contracts `cardArt`.
Historical gateway `card_icon` values are not rewritten: readers join the catalog
by card name and ignore the stored URL. Missing catalog art yields null and the
views keep the card name. The CSP no longer permits Supercell’s asset CDN.

This fixes #459 against Jamie’s October 8 card-art decision. Product questions:
where is art served, and may we alter it? The existing decision answers: Elixir’s
mirror, byte-identical originals, sized only by HTML/CSS. No new product call or
engineering default is needed. Console’s brief keeps verification and collector
operation in the account’s own surfaces; access and response shapes are unchanged.

MCP 11.13.0 and JSON API 3.2.0 remain unchanged: no MCP output or `/api/v1`
operation changes. Raw catalog `iconUrls` remain upstream provenance. Scratch
handler regressions cover Verify and historical collector URLs across all four
reads; the catalog guard covers missing/unknown art and tower troops; a CSP
regression forbids the CDN. Rendered Verify and collector journeys use fixture
APIs, so verification makes no live challenge, collector or game writes.
