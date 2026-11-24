# 2026-11-23 — Run › Members and a member's history

Review folds into **Run › Members** (`apps/web/src/clan/views/RunMembers.jsx`),
and each member gets a leaders' page under it
(`views/RunMember.jsx`, `/clan/<TAG>/run/members/<player tag without #>`).
`/run/review` forwards to `/run/members`.

## What changed

- **One new read, leaders only:** `GET /api/clan/clans/<TAG>/members/<player>/history`
  (`packages/clan/src/handler.mjs`, `manage.memberHistory` in
  `src/manage/service.mjs`, built by `src/manage/member-history.mjs`).
  It requires a verified leader or co-leader (`requireLeader`), writes
  nothing, needs no policy, and reads `clans_participation` (a failure is
  502), `clans_roster` (optional), and the ledger's cards, holds, notes and
  grants. 404 `not_a_member` when nothing knows the tag. It is a pure view
  in the web API (`PURE_VIEWS`), refused to members and elders
  (`clan-record-access.test.mjs`). It never reaches MCP.
- **History sources, newest first:** joins, rejoins and leaves
  (participation stints and the roster's recent events, deduplicated
  within an hour); role changes (participation `role_changes`), merged
  with the Done promotion or demotion card within three days of them;
  every card for the member (raised, done, declined, reopened, withdrawn);
  current holds and their end date; race weeks (`war_decks` against
  `war_weeks`, decks asked = 4 x required, Colosseum 16); awards (grants);
  notes, both tiers. "Already a member when Elixir started following"
  closes the list when the first join predates the first roster read.
  Nothing is invented: an entry exists only where the ledger or the
  record has one.
- **Gaps the read names** (`gaps`): `ended_exceptions` (a cleared or
  expired hold is deleted, so it leaves no record), `war_window`
  (participation covers 8 weeks: race weeks and role changes older than
  that are not there, except role changes among the roster's newest
  events), `participation_unavailable`, `roster_unavailable`. A leave
  between two earlier stints is known only if it is among the roster's
  events.
- **Holds are read in one place** for the member page,
  `exceptionsFor(clanTag, playerTag)` in `service.mjs`, so the exceptions
  change can swap the source there. Hold kinds read as exception words
  (`leader` and `keep_in_clan` as Keep in clan, `keep_as_elder`,
  `not_for_elder`, `away`).
- **`manageView` sends more facts** per board entry (last battle time,
  join time, the minimums verdict, war decks played and asked, average
  donations) and more policy (`tenure_min_days`, `removal_day`,
  `minimums_window_weeks`), for the tiles and row chips.
- **Pages:** the list has tiles (Elder seats N of M, did their part, quiet
  4+ days), filter chips (Needs you, Getting close, Not enough info, Has an
  exception, Everyone) and kit rows linking to each member; Review's
  summary lines stay at its foot. The member page has a header, four tiles,
  the reasons, MemberSheet (unchanged) for notes and the hold, and the
  history with filters All, Role, Actions, War, Awards, Notes. Each panel
  reads and fails on its own. Phone first: tiles two by two at 600px and
  under (`.kit-stats--quad`).

## Choices made mid-build `[engineering]`

- "Did their part" is the policy's minimums verdict over its window, not
  this week alone.
- Joins and leaves sit under the Role filter; holds under Actions; a role
  change merged with its card shows under both.
- No new analytics events; the member page reports as `/clan/run/members/detail`.
- The history does not carry "verified in Elixir" yet.

## Left for later

- MemberSheet's hold date input has no label (axe). The exceptions change
  rebuilds that sheet; the e2e journey leaves that one input out of axe
  until it lands.
