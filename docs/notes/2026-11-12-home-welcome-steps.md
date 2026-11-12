# 2026-11-12 — Home's welcome steps and Your week's cheers (G4)

G4 of the side-by-side walk: Home had no welcome checklist, so nothing
told a new account what was left, and Your week did not count reactions.
Jamie approved the fix: "Welcome to Elixir, N of 4 done" (add your player,
verify it, follow a few people, choose your digest) until every step is
done, then gone, replacing the folded Setup details; and cheers received
this week in Your week.

## What each step reads

All four come from state the account already keeps, in the first answer
(`services/web-api/src/first-answer.mjs`), never a record of onboarding:

| Step | Done when | Source |
| --- | --- | --- |
| Add your player | the account has a primary player | `claim` (`is_primary`) |
| Verify it | that claim is verified | `claim.status` |
| Follow a few people | the account follows one player or more | `claim` rows with `relationship = 'friend'`, as `welcome.following` |
| Choose your digest | the person has their own `tracking_report` setting (switch or cadence) | `account_email_pref`, not `via = 'ops'`, as `welcome.digest` |

`apps/web/src/home/logic.js` (`welcomeSteps`) turns them into the steps;
an answer without `welcome` draws none rather than guess.

[engineering] defaults, each a product question for Jamie:

- **"A few" is one.** Following one player marks the step done. Asking for
  three could keep the steps up for someone with one friend who plays.
- **"Hide for good" is derived, not stored.** Once all four are done the
  steps are not drawn. Three of the four never undo (a primary player, its
  verification, a digest setting row), but unfollowing everyone would bring
  the steps back with 3 of 4 done. Keeping them hidden through that needs a
  stored mark (a column on `account`), which nothing has today.
- **The digest step counts any setting of the person's own**, including a
  switch they turned off before the friends mail became the digest.

The steps sit above the feed (Home opens with them, and a phone reads them
first), as one panel with flat rows. Setup details' other rows went with it:
the freshness of the battle log is the head's chip, the clan is its own
panel, and connections are in Settings.

## Cheers received

`GET /api/me/home/week` (the opening read, without `mode`) adds `cheers`:
other people's cheers on the items about the primary player since Monday's
reset, counted the bell's way (the player's own items rebuilt, the
account's own lines left out, the person's own cheers never counted). A
chip's read leaves it out; a failed count is `null` (logged as
`home_week_cheers_failed`) and never fails the week. Your week shows it as
a stat beside the record, or a line in a quiet week, only when it is known.
