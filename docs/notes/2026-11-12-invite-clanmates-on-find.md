# 2026-11-12 — Bring your clanmates moves to Find

Jamie, 2026-11-12: "Bring your clanmates moves to Find", not Home.

`BringClanmates` (the folded **Invite clanmates**: a clan chat line, a
longer message, the share sheet) is no longer drawn below Stats' Season
(`src/ladder/Season.jsx`). Find's **Your clan** section draws it below the
clan's members (`src/home/Find.jsx`). The component, its words
(`src/lib/invite.js`) and its one aggregate copy event are unchanged; it
still draws nothing until the account's primary player has a recorded
clan. Clan's own Spread the word is untouched. Not on Home.

Docs: `bring-your-clan.md` (where it is), `ladder-season.md` (pointer),
`follow-a-friend.md` (Find's Your clan row). Test:
`apps/web/test/find-bring-clanmates.test.jsx`.

DECISIONS still says otherwise and is not edited here: the line "Invite
clanmates is not on Home — it is on Clan's Members and folded on Stats'
Season" should name Find; `docs/product/structure.md` row "Invite
clanmates" and A30 likewise.
