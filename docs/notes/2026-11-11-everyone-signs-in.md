# 2026-11-11 — Everyone signs in; shared posts stay public

Jamie reversed the open record on 2026-11-11, reviewing the social-layer
design: "we need everyone to sign in… it is going to be a mistake to allow
anonymous read -- and I think it could prove VERY expensive… flip to all
usage is via an account." Shared content stays open: "making link previews
and shared content public and not require sign-in." RSS needs "some magic
token". Approved the same day: "replace 'The record is open' in
elixir-mcp DECISIONS with sign-in for all, shared posts and link previews
public, RSS by private link".

In DECISIONS:

- **Replaced:** "The record is open; signing in is for writing" becomes
  "Everyone signs in; shared posts stay public".
- **Reworded:** "Every player is an RSS feed" reads through a private token
  link; "A battle has a public page" becomes "A battle has its own page",
  for members.
- **Open:** whether a battle link someone sends counts as shared content
  and opens signed out (#755).

`VISION.md` "Open by default" becomes "Everyone signs in", so the root
and DECISIONS agree.

Docs only: nothing in the service changes here. The public routes,
`public-boundary.test.mjs` and the public docs change with the build (#752).
