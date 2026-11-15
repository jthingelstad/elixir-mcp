# 2026-11-14 — Your place is set in setup, and lives on Profile

The owner opened Elixir and could not find where to set his place. The
profile list's map step (#1015) linked to a clan's map page, and the
place had no home of its own on the person's profile.

## What each case showed before

- **Map on, verified, in a clan:** "Set a place" left Home for
  `/clan/<tag>/members/map`; the picker sat under the page's lede. It
  worked, but setup happened on a clan page.
- **Map turned off by the clan's leaders:** the same link opened "This
  clan's leaders have turned the member map off." and no picker: a dead
  end, though the server would have saved the place.
- **No clan:** the link was `/clan`, which showed "No clan in your
  recorded profiles" and no picker: a dead end.
- **Not verified:** the map page answered "The clan map is available to
  verified current members." and no picker.
- **List complete or hidden** (the launch backfill's All Set account
  among them): no step at all. The place could be changed only on a clan
  map or in Settings › What members see › Location; the passport's On
  the Map action ("Open clan map") hit the same dead ends.

## What shows now

- **Home's map step** has **Set a place**, a button that opens the
  picker (the same `YourPlace`, lists lazy-loaded) under the step. Saving
  latches the step and earns On the Map through the existing save hook;
  Home reads the passport and the bell again. **Not now** stays. Cancel
  and Escape close it and focus returns to the button. No clan page.
- **Not verified:** the step says "First verify your player. A place
  belongs to a verified player." with **Verify**; Not now still counts.
- **Settings › Profile › You in Elixir › Your place:** the place or "Not
  set", with Set, Change and Remove, and who sees it. `#place` opens the
  picker at once. The account menu's Settings opens Profile, so it is
  one tap away.
- **What members see › Location** is a row showing the place (or "Not
  set") that opens Profile's Your place: one editor, not two.
- **The passport's On the Map** action is **Set your place**, to
  `/settings/profile#place`, for any account, list finished or not.

## The server rule

Unchanged. `PUT /api/clan/me/place` needs a verified player and nothing
else: a person with no clan, or whose clan has the map off, already
saved. It was never the clan-first design's accident, only the client's
routing. A test now pins the no-clan save and the unverified refusal
(`packages/clan/test/social.test.mjs`). The place still reaches only the
clan map of each clan a verified player is in, to its verified members,
while its leaders keep the map on. Passports and player pages never show
it.

The picker's one line on who sees it: "Who sees it: your clan’s verified
members, on the clan map, when its leaders have the map on."

Whether Home's map step offers the picker comes from the place route's
own answer (`GET /api/clan/me/place`, read only while the step waits),
not the verify step's latch: an account whose verified player is an alt
gets the picker, and one that lost verification after the latch gets
Verify instead (Codex on #1028). Profile's `#place` opens the picker on
every arrival, Back included, not only the first render.

MCP 13.1.1 and JSON API 5.1.0 unchanged. No migration.
