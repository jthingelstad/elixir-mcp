# 2026-10-20 — A leader with Actions waiting lands on Actions

Jamie, 2026-10-20, asked "Clan (optional): should leaders land on
Actions instead of Roster?", answered: "If there are actions to take,
yes. Otherwise no." A leader or co-leader (the roles `drafts.mjs` treats
as leaders) whose `/api/clan/me` reports `open_actions` lands on
Actions; everyone else lands on the roster as before. Views only: MCP
11.13.1 and JSON API 3.2.0, unchanged, and the deploy runs no
acceptance family.

- **The choice** is `packages/clan-web/src/lib/landing.js`:
  `landsOnActions(me)` (leads the selected clan, verified, and the
  rail's Actions count, `waitingFor(me)`, is above zero),
  `landingPath(me, tag)` for redirects, and `useLanding` for the clan's
  own address.
- **Every landing goes through it.** `/clan/<TAG>` with no section
  (typed, a bookmark, the roster switcher, the Console's return after
  sign-in) redirects to `/actions` with replace; `/clan` with a
  selected clan, the gate's redirect from Verify and Refused, and their
  acknowledge and recheck buttons, go to `landingPath` with replace;
  picking a clan under **Clans** pushes `landingPath` from the select
  answer, so Back is the chooser.
- **Addresses that name a section open it.** The roster gets its own,
  `/clan/<TAG>/roster` (`parseClanPath`, `railKey`). The rail's Roster,
  the breadcrumb's clan name and a member page's Back now use it, so a
  leader with Actions waiting can still reach the roster in one step.
- **No roster before Actions.** A leader arriving at one of their clans
  that is not yet selected sees nothing until the select answers (the
  `wait` state), so the roster never draws first. Anyone who does not
  lead that clan reads the roster at once, as before, so first paint is
  not delayed for them.
- **Decided once per arrival.** A later re-read of the session (a
  refresh, a decision elsewhere) never moves a person off the roster
  they are reading.

Defaults taken [engineering]:

- Elders and members are unchanged: they land on the roster even with
  Actions of their own waiting (an away question).
- An unverified leader reads as a member and lands on the roster.
- A clan with no active policy shows no Actions in the rail, so its
  leaders land on the roster.
- `open_actions` is the selected clan's, so the choice for another of
  the person's clans waits for its select.
- A bare clan address with a roster search (`?find=`) is the roster,
  and clearing the search stays there; the search keeps the address it
  was typed on.
- The redirects replace; picking a clan in the chooser pushes, as it
  did.
- In-app links to the roster name `/roster`; the switcher's links to
  another clan stay bare, since they are landings.
- Analytics unchanged: `/clan/<TAG>/roster` reports as `/clan/roster`.
- Left as it was: a failed select (not a 401) retries, during which a
  leader in the `wait` state sees an empty page.
