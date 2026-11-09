# 2026-11-09 — The funnel keeps a return made through OAuth consent

Codex on #727: consent by code at the OAuth door signs a person in by
minting a session, with no `signed_in` event, and the session cleanup
deletes sessions 30 days after they expire. `{funnel}` read such a
return only from the session, so `came_back_7d` and `came_back_30d`
could fall for an older cohort just because cleanup ran. The OAuth
family that consent opens is kept, so its creation now counts as a
sign-in for both `signed_in` and the came-back windows. No product
change: no new event is written.
