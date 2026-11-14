# 2026-11-14 — The front end's names lose Console, family and tracking

The last tidy before the visual redesign: the names in `apps/web`,
`apps/site`, `packages/ui` and `packages/design` now say what the product
says. Nothing a person sees changes, except two labels (below).

- **Family is the shell.** `packages/ui/src/family.{json,ts}` are
  `shell.{json,ts}` (`@elixir-mcp/ui/shell.json`), the `FAMILY_*` constants
  are `SHELL_*`, `FamilyProduct`/`FamilyTab` are `ShellProduct`/`ShellTab`,
  the site's `familyBar` global is `shell`, and the disclaimer's maker line
  is `.disclaimer__maker` (`site.maker`). Mail's `FAMILY_ORIGINS` keeps its
  name: those are the POAP KINGS family's origins, Drop included.
- **Tracking is following.** The read-recovery test and spec are
  `following-read-recovery.*`; the help drawer's doc keys are `players`,
  `players:record` and `agent:following`; the Players page's event groups
  key under `players`.
- **The Console is the app.** `ConsoleShell` is `PageShell`,
  `e2e/console.spec.ts` is `e2e/app.spec.ts`, the e2e fixture
  `consoleSignedIn` is `accountSignedIn`, and comments and test titles that
  meant the app say so. Dated history keeps its words.
- `apps/web/test/retired-names.test.js` keeps the three words out of names
  and lists what keeps them: the browser console, stored and wire values,
  and the meanings that are still true (the family role and OAuth client,
  tool and card families).

Two labels change. The Roles page's first quota row reads "Player slots
(a free follow uses none)": the limit behind the number the app shows as
Player slots used, which counts slots spent and leaves out free follows. The feedback area `ladder` is labelled "Stats" in Admin and in the
answer mail; the stored value stays `ladder`.

Left for a later, deliberate change, because they are stored or on the
wire: the feedback area values `console` and `ladder`, the analytics event
`console.invite_copied`, `account.console_timeline_seen_at`, the mail kind
`tracking_report`, and the response fields that say tracked.

No contract, API or migration change.
