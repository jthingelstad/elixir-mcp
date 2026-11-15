# 2026-11-14 — Passport close-out: the reconcile gate, bigger text, the matrix

Stamps launched today (build f6e5cb51a, #1015) and the launch backfill
ran on 2026-11-14: 47 accounts read, 30 granted. This is the tidy after
launch. MCP 13.2.1 (a docs pointer only, below). `/api/v1` 5.1.0
unchanged. No migration.

## The reconcile gate

`useReconcilePassport` asked the server to reconcile on every open of
your passport and every Home paint. The server bounds each call and
rate limits at 120 an hour, but a reader flicking between tabs spent
that budget on calls that found nothing new. Now the app gates it
(`reconcileOnOpen` in `apps/web/src/lib/passport.js`, the gate itself in
`apps/web/src/lib/reconcile-gate.js`, which imports nothing so the API
clients can read it without an import cycle):

- A finished reconcile (the last pass answered without `more`) is not
  asked again in that tab for a minute (`RECONCILE_GATE_MS`). The time
  lives in `sessionStorage`, with a memory fallback when storage is
  blocked.
- A run the server stopped with `more` is not finished, so the next open
  carries on. A failed or refused run settles nothing.
- A successful write that could earn (claims, verify, players,
  follow-all, avatar, email, cheers, highlights, the passport map step,
  Clan's place) lifts the gate, so the next open reconciles straight
  away. Both API clients (`api.js`, `clan/api.js`) report each write
  through `noteWrite`. A refused write, a read and a write that cannot
  earn leave the gate alone. A write that lands while a run is on its
  way keeps the gate open after it. Signing out lifts it.
- Two opens at once share one run.

Pinned by `apps/web/test/passport-gate.test.js` and the page test "a
finished reconciliation is not asked again on the next open, until a
write that could earn" (`apps/web/test/passport.test.jsx`). The
existing e2e "repeats while more" journeys still pass.

## Bigger text

The matrix's "200% text" came from the prototype, which was checked at
200% browser zoom, and the passport's e2e already pins that ("@narrow
200% zoom", "@narrow page zoom 200%"). Browser zoom was met. A larger
default font size in the browser was not: the kit's type tokens are px,
so a reader's font setting moved nothing.

A contained fix existed. Inside Home's profile list, the passport pages,
the detail sheet, the passport row and the Stamp marks, the type tokens
(`--t-h2`, `--t-body`, `--t-body-sm`, `--t-caption`, `--t-micro`) are
redefined in rem with the same values at a 16px root, and the Stamp
mark's width is in rem (`packages/design/src/components.css`). At the
default size nothing moves. At twice the default the words are twice as
large, the passport head's count wraps under the name rather than over
the gold mark, and long Stamp names hyphenate. Pinned by
`apps/web/e2e/passport-text-size.spec.ts`: the default px, then a 32px
root at 320px across the profile list, your passport, another member's
and the detail sheet, with no sideways scroll and nothing cut off.

Left out:

- **The Bell's Stamp lines.** The Bell was redesigned in its own session
  (#1009, landed while this one ran) and is left to a follow-up so the
  two do not cross; the same token block reaches it in one selector.
- **The rest of the app.** A kit-wide change is small in code and large
  in checking. `components.css` has no hard-coded font size (every one
  is a `--t-*` token), so the code is about nine token values in
  `packages/design/src/tokens.css` moved to rem, plus the px widths that
  should grow with text. The cost is walking every surface at a large
  font size and fixing what breaks: the top bar and bottom tabs, tables,
  card grids, Stats, Clan, Settings, Admin and the site. Estimate: one to
  two sessions, with an e2e like this one per surface. Not started.

## Acceptance matrix audit

`docs/plans/stamps-build.md`, "Acceptance", against `main` plus this
change. Test names are quoted; files are relative to the repo root.

| Row | Met | Evidence |
| --- | --- | --- |
| A new or unverified person has a passport another member can open; no toggle, verified-only gate or email-derived identity; anonymous and agent requests refused | Yes | `services/web-api/test/passport.test.mjs` "the passport reads refuse the signed out, agents and every agent console", "the public passport carries the whitelist alone, for each kind of account"; `packages/stamps/test/store.test.mjs` "a person gets one opaque passport id; an agent gets none"; `apps/web/e2e/passport.spec.ts` "an account with no player" |
| Player pages never acquire an arbitrary claimant's passport; verified primary and alts resolve the same one | Yes | `services/web-api/test/player-passport.test.mjs` "a verified alt opens the same passport as the main", "an unverified claim, a player nobody claimed and an owner with no passport show none, and nothing is written" |
| Every public response excludes the private fields | Yes | `passport.test.mjs` whitelist test; `packages/stamps/test/projection.test.mjs` "only whitelisted fields leave, whatever the input carries"; `player-passport.test.mjs` row fields test |
| A revoked proof removes the gold mark, the verification Stamp stays; art alone grants neither | Yes | `passport.spec.ts` "a lapsed proof"; `packages/stamps/test/eligibility.test.mjs` "Player verified: a current verified primary or alt, nothing else", "earned levels never go down" |
| Place earns only after success; Not now completes the step without On the Map; removal keeps the Stamp and exposes nothing | Yes (gap fixed) | `packages/stamps/test/earn.test.mjs` "setup: a saved place grants On the Map and its removal keeps it"; `services/web-api/test/passport-earning.test.mjs` "Not now completes the map step and never grants On the Map" and, new here, "a refused place save earns nothing and latches no map step" |
| Default weekly mail is not a choice, Off is; Stamps never enable mail; older finished onboarding can be dismissed | Yes | `passport-earning.test.mjs` "the digest step: the default weekly is no choice, an explicit Off is", "the profile list is dismissed only by an account that finished the older welcome" |
| Retry, concurrency and zone changes cannot duplicate facts or levels; a year-retention boundary and late records | Yes | `store.test.mjs` "concurrent grants insert each level once", "frozen across a zone change", "crosses the record's one-year retention"; `earn.test.mjs` "two tabs and a zone change", "a late record is read once" |
| More than one cheer a day and reposts cannot multiply progress; wins, trophies and ranks cannot grant | Yes | `earn.test.mjs` "Cheerleader: retries"; `store.test.mjs` "Storyteller: one battle once, however it is reposted"; `earn.test.mjs`, `eligibility.test.mjs` "wins, trophies and rank" |
| Public detail offers no private settings or map; exact unearned counts are owner-only | Yes | `apps/web/test/passport.test.jsx` and `passport.spec.ts` "dates and rules, no progress, no action, no map" |
| Loading, error and missing coverage are not zero progress or inactivity | Yes | `passport.test.jsx`, `passport.spec.ts` "loading is not an empty passport"; `eligibility.test.mjs` "unknown activity is unknown"; `apps/web/e2e/home-profile-list.spec.ts` "still catching up" |
| 320/390/1280px, 200% text, font and art failure, reduced motion, 44px targets, labels, Escape and focus return, reflow | Yes, but the Bell's Stamp lines at a larger font size | `passport.spec.ts` widths, "200% zoom", "page zoom 200%", "blocked fonts", "the owner's picture shows from its card art", "reduced motion", "Escape closes it", axe; `apps/web/e2e/touch-targets.spec.ts`; new `passport-text-size.spec.ts` |
| No Stamp items in the feed or digest; cheers stay anonymous aggregates; no leaderboard or score | Yes (gap fixed) | new `packages/stamps/test/boundary.test.mjs` (no Stamp reader in the feed, Home, timeline, mail, digest, syndication, MCP or jobs); `apps/web/test/bell.test.jsx` "Counts only"; a grant writes no account event (DECISIONS) |

Two gaps were small and are fixed here: nothing pinned that a refused
place save earns nothing, and nothing pinned the feed and digest staying
free of Stamps beyond reading the code. Open: the Bell's Stamp lines at
a larger font size (after the Bell redesign), and the app-wide text
size work above.

## `battles_opponents` docs

`battles_opponents` pointed at `battles#what-a-battle-record-holds`, the
section for battle rows, so PR #1021 listed its fields there for the
acceptance `#docs` check. It has its own section now,
`battles#opponents` (`apps/site/src/docs/battles.md`), and the tool
points at it (MCP 13.2.1). The check's rule is unchanged.

## Docs

`docs/product/stamps.md`, `docs/plans/stamps-build.md`, the handoff
prompt, the design preview's README and DECISIONS say Stamps launched,
with the backfill's aggregate counts. `docs/OPERATIONS.md` keeps the
backfill steps, marked as already run. The public `/docs/passport` page
already described the live behaviour.
