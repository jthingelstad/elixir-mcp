# 2026-11-16 — Polish on the signed-in pages

Presentation and plainer copy only; no behaviour, contract, schema or
promise change. A pass over every signed-in page except the Home feed,
read as a new clanmate on a phone.

- **A page's shape while it loads.** The kit has `Skeleton`
  (`packages/ui/src/Skeleton.tsx`, `.kit-skel` in the design CSS): a
  `profile` shape (avatar, name lines, tabs, rows) and a `rows` shape,
  one "Loading" status for assistive tech, the pulse only when motion is
  welcome. The player page, an account page and You use the profile
  shape instead of one grey slab; Clan's Feed uses rows instead of a line
  of text.
- **Check for new battles** keeps to the reading column's measure, so on
  a wide screen it sits under Follow instead of at the window's far edge.
  It stays out of the head's actions, which hold two at most.
- **You with no player** leads with Add your player and says where the
  tag is in the game, instead of an empty page and a menu.
- **Account pages** (You, another member's): Players and Timeline are
  section headings, not day labels, and the players are a card list of
  full-width rows with no underline.
- **Find:** Show more lines up with the suggestion rows. Search's note
  and the Follow me link say the same things in plainer words.
- **Another member's passport:** Open their account sits under whose
  passport it is, not above the title's subject.
- **Sign out's note** is plainer.
