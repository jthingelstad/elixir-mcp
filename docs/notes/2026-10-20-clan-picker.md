# 2026-10-20 — The Clan picker heads Clan's rail

Jamie, 2026-10-20: "While we are in here… this has been suboptimal since
Clan launched, but the "Clans" picker in the left rail should go away and
it should be a "Clan Picker" that is at the top of the rail similar to
what Console has for switching accounts and Ladder has for switching
players." Views only: MCP 11.13.1 and JSON API 3.2.0, unchanged. No
acceptance family runs at the deploy: the families exercise MCP tools
and the JSON API, and no tool, operation, route or answer changed; the
picker reads the `/api/clan/me` it already had.

- **One kit switcher.** `RailSwitcher` (`packages/ui/src/Rail.tsx`) is
  the head that opens to a list of links: a face, choices with real
  hrefs, the current one checked, a manage line at the end, Escape and a
  click outside to close (Escape returns focus to the head), a modified
  click left to the browser, and a single choice drawn as the face with
  nothing to open. The Console's `AccountSwitcher` is now built on it
  (same ids, classes and titles), and Clan's `ClanPicker`
  (`packages/clan-web/src/components/ClanPicker.jsx`) is the second
  user. `head` puts it in the rail's narrow row, beside the toggle, above
  the page (`.rail:has(> .rail__switch--head)`); it is never a drawer.
- **The face** is the selected clan: its name, its tag in mono, your role
  chip and, when `verified === false`, an "unverified" chip. **Open**,
  each of your clans is a link with its name, its tag, the player you are
  there and your role, ending with **All your clans…** (`/clan/clans`).
- **A pick lands where the 2026-10-20 ruling says,** without a redirect:
  a plain click selects the clan, as the chooser does, then pushes
  `landingPath` from the select's answer (Actions with Actions waiting
  for a leader, else the roster). The shell's `select` now holds
  `selecting` until that navigation resolves, so the gate never selects
  the clan in the old address back.
- **Gone:** the rail's Clans item, the roster head's chip switcher (the
  roster keeps its clan's name in a plain chip) and the rail's foot
  identity, `RailIdentity`, removed from the kit with its CSS since
  nothing else used it. Your players stay the rail's You ▸ Players
  (`/clan/you`).
- **The plain head stays** signed out, with no clan selected, and on the
  chooser itself (`/clan/clans`), which is the whole list. No new
  analytics event.
- **Ladder is unchanged.** Its player head has its own classes and
  narrow layout, and another session is working in Ladder; moving it
  onto `RailSwitcher` is a later, separate change.

Defaults taken [engineering]:

- No waiting count beside each clan in the list: `/api/clan/me` carries
  `open_actions` for the selected clan only, and adding per-clan counts
  would be an API change for a hint.
- The player you are in each clan is in the open list ("★ name"); with
  one clan the face does not show it, and You ▸ Players does.
- The roster's head keeps its clan's name as a plain chip.
- Picking the clan you are in goes to its landing too.

Also in this change, Codex's finding on #604: the route bridge
(`apps/web/src/analytics.js`) saw `pushState` and `popstate` but not
`replaceState`, so a leader reaching a clan's own address by navigation
was counted at the bare address and the redirect to Actions was never
counted. A view's beacon now waits until the view settles (the reader's
first pointer or key press, the next navigation, the page going away, or
three seconds); a replace while it is still open is a redirect and moves
its address, never a second count, and a replace after it settled, or
while no view stands (the page sign-in lands on), is a new view. A
document's own view is the embed's hit, so its redirect sends nothing;
a record page's landing beacon waits like any view, so an email's report
link counts once, at feedback. Counts stay per page, and Clan's pages
still report with the tag as `?clan=`. Two things found and left: a hard
load records the embed's raw address (the tag in the path) as before,
and `packages/clan-web/src/analytics.js` still carries an unused copy of
the bridge.
