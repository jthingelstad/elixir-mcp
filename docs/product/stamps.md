# Passports and Stamps

Design direction, 2026-11-14. **Launched 2026-11-14** (build f6e5cb51a): earning, the pages and Home's profile list are live, and the launch backfill ran on 2026-11-14 (47 accounts read, 30 granted).
The catalog, eligibility, storage and two signed-in passport reads exist
(`packages/stamps`, migrations 0269 and 0270). Real writes grant Stamps
through hooks, the owner's reconciliation repairs and grants the rest,
and a new Stamp is one line in the bell. History before launch is
"Earned before <launch day>" and never a bell line: migration 0272 stores
the launch instant, every grant path files what predates it as legacy,
an account made before launch gets one "Your passport is ready" line
(its ladder Stamps wait until the backfill has read its history, 0273),
and the operator's `{passport_backfill}` adds the history no live path
reads (docs/OPERATIONS.md, Passport launch backfill). The passport
pages show it, and Home shows the profile list
(`apps/web/src/home/ProfileList.jsx`, 0274 for its dismissal). The clickable sample is in
[the passport design](../design/passport/README.md); the build plan is
[the build handoff](../plans/stamps-build.md).

## What it is for

Small, dated marks in an Elixir passport recognize getting set up,
connecting with friends and taking part. The feed remains the reason to
return: friends' play, their words, their moments and cheers.

Jamie confirmed the direction in the design session:

- “Stamps should be visible on all accounts. It’s not a private aspect
  of the account. It should be on all accounts.”
- “The metaphor ... is like a stamp in a passport.”
- Verification and putting a place on the map are examples of milestones
  that should earn a Stamp.

These supersede the older domain plan's verification-only visibility,
optional public row, and exclusions of verification and location rewards.
The remaining catalog builds on that plan, with engineering defaults
identified below. The earlier domain plan is the Clash Royale guide checkout’s
plans/elixir-profile-stamps-timeline-2026-11-14.md. It is not vendored here.

## The words and the shape

- **Stamps:** Elixir's earned milestones.
- **Passport:** the account's collection of Stamps.
- **Badges:** Clash Royale's own badges, as recorded from the game.
- **Verification mark:** current ownership proof, the gold ring and check.

Stamps resemble passport ink impressions, with a named mark and earned
date. They are neither currency nor rarity medals. No points, account
levels, streaks or ranking by collection size. Tiered Stamps use I, II and
III, not bronze, silver and gold. Gold stays reserved for current
verification and the existing brand.

A dated Player verified Stamp is a historical milestone. It does not
replace the live verification mark or keep a player verified after their
proof is revoked. On the Map records setting a place, not where it is or
whether it is still shared.

## Who sees them

Every **person account** has a member-visible passport, including a new
account with no player and an account with an unverified player. There is
no hide switch or verification gate for the passport.

“Visible” follows Elixir's existing member boundary: signed-in members
can open any person's passport. This does not create a new anonymous
exception beside shared highlights and battles. Agent principals do not
become human passport owners.

An unverified claim is never used to attach an account's Stamps to the
canonical game player page as its owner. The account has its own passport
link. A verified player's page can link the verified owner's passport;
the same account-wide collection appears on its verified alts.

The public view contains earned Stamp IDs, highest levels and earned
dates, with an explanatory catalog. Exact progress counts are for the
owner. Email, Discord username, city, coordinates, nicknames, account
UUIDs, agent keys, limits and usage records never enter the public view.
This is a public achievement surface, not a public account-settings page.

## Initial catalog

The two newly explicit setup milestones bring the older nine-Stamp
proposal to eleven. Stable IDs and prototype metadata are in
[catalog.json](../design/passport/catalog.json). Names and the three
level ladders are engineering defaults that can be tuned before build.

| Stamp | Earned by | Levels |
| --- | --- | --- |
| Player verified | Successfully proving ownership of a player in Elixir, using the existing verification flow | Once |
| Looking Good | Choosing a profile picture | Once |
| On the Map | Successfully setting a place on the clan map | Once |
| Full Roster | Adding another of your own players | Once |
| Linked | Connecting Discord | Once |
| All Set | Completing the six profile steps below | Once |
| Inner Circle | Following five other players with a recorded battle in the last seven days | Once |
| Mutual | Someone you follow follows you back | Once |
| Played Together | Distinct days playing a friendly battle or 2v2 with someone followed | I / II / III: 1 / 5 / 20 |
| Cheerleader | Distinct days on which you cheer someone | I / II / III: 3 / 15 / 50 |
| Storyteller | Distinct battles highlighted with non-empty words of your own | I / II / III: 1 / 5 / 20 |

Wins, trophies, rank and win rate never decide a Stamp. Repeated cheering
in one day is one day. A missing week costs nothing. A highlight edited,
removed and reposted is still one distinct battle for Storyteller.
Earned Stamps and levels stay earned when a follow, picture, Discord
connection or place is later removed.

On the Map is optional. Setting a country, region or city earns it; opening the map,
granting browser location permission or choosing Not now does not.
The existing country/region/city picker and verified-clan-member map permissions remain. No extra precision is required.
The public Stamp never includes the city or its location data.

## One profile list

Home offers one compact next step, not six full tasks before the feed.
The full list can expand. Completed users get the feed immediately.

1. Add your player.
2. Verify your main player.
3. Pick your picture.
4. Follow one player who has played in the last seven days.
5. Choose the digest: weekly, daily or off.
6. Choose for the clan map: set a place or choose Not now.

One active friend is enough; a parent need not follow strangers.
Email off counts. Not now on the map counts toward All Set, but does not
earn On the Map. Alts and Discord are offered, never prerequisites.
Steps latch while the list is open; completion is stored once and does
not return when circumstances change. An already-finished older welcome
list receives only the remaining steps and can be dismissed.

The list must distinguish “recording is catching up” from “your friend
didn't play.” Unknown activity is not evidence of inactivity.

## Where it fits

- **Account menu and You:** a passport link for every account, including
  the unverified state. No sixth bottom-navigation tab.
- **Settings > Profile:** identity, a compact passport preview and Your
  place before private account machinery; the same public passport opens
  from it.
- **Verified player page:** a compact row with up to two marks, a count
  and Open passport. It must not push the friend's play out of view.
- **Passport:** the collection, earned and unearned states, dates and
  a detail sheet with the rule, levels and the appropriate next action.
- **Bell:** a newly earned Stamp links to its detail. No reward popup
  interrupts a battle, a highlight or reading the feed.
- **Feed and digest:** no new Stamp items or Stamp email. The digest
  stays about friends' play and clan news.

Public viewers get explanations and earned dates, not the owner's
private progress or settings actions. Opening an On the Map Stamp grants
no access to the owner's clan map.

## Failure and accessibility

Loading is not an empty passport. A failed read keeps its retry state,
never zero earned Stamps. Saving a place or picture can earn only after
the real write succeeds. Failed writes preserve the user's choice and
show the ordinary retry path.

Marks use text, icons and earned labels as well as color. Names have
accessible labels; full rules and dates are available in the detail.
Use a two-column collection on the smallest phones and three columns
when marks remain legible. Targets are at least 44px. A sheet supports
Escape, a focus trap and return to its triggering mark. Reduced motion
removes any stamp-in animation. No bitmap text or modified game art.

## Implementation boundary

The design session provided the specification, catalog, prototype and
experience review. The prototype's sample state is not an earning
engine, privacy boundary or API implementation.

Built in the first slice (#1015):

- The catalog as code, `@elixir-mcp/stamps/catalog`, pure data the web
  app can import, checked against the design's `catalog.json`.
- Pure eligibility: a snapshot and an explicit time in, earned levels,
  exact progress and the six profile steps out.
- Storage (0269): the passport, earned Stamps, capped ladder facts and
  the profile list's latches, removed with the account.
- `GET /api/me/passport` (the owner's passport, steps and progress) and
  `GET /api/passports/<id>` (the public projection only), for signed-in
  people.

Built in the earning slice (#1015,
[note](../notes/2026-11-14-passport-stamps-earning.md)):

- Hooks after each successful write (verification, a picture, a place,
  an added or followed player, Discord, a digest choice, a cheer on
  someone else's item, a highlight with words). A hook never fails the
  write it follows.
- `POST /api/me/passport/reconcile`, the owner's bounded, idempotent
  pass (Played Together, Inner Circle, Mutual, All Set, Storyteller and
  any setup Stamp a hook missed), and `POST /api/me/passport/map` for
  the map step's "Not now".
- One bell line per new Stamp, at the highest level a pass granted,
  opening `/home/passport?stamp=<id>`. No popup, feed item, digest row
  or email.

Built in the pages slice (#1015,
[note](../notes/2026-11-14-passport-pages.md)):

- The Stamp mark in the kit (`packages/ui` `Stamp.tsx`, styles in
  `packages/design`): earned is a tilted, inked mark with its name and
  day; unearned is a plain outline with a word under it. One ink for
  every level; no metal colours.
- The pages: `/home/passport` (yours, with progress and where to earn
  each Stamp) and `/home/passport/<id>` (any signed-in member's, the
  public projection only), a detail sheet per Stamp, and
  `?stamp=<stamp_id>` to open one. Opening your own passport runs the
  reconciliation in the background and reads it again once a pass
  answers.
- Entry points: Passport in the account menu, a row on You, and
  identity with a passport preview at the top of Settings > Profile.
- `GET /api/player` adds a compact summary (`{id, count, marks}`) only
  when the player's canonical verified owner has a passport; a player
  page shows it as a row with **Open passport**.

Built in the profile list slice (#1015,
[note](../notes/2026-11-14-passport-profile-list.md)):

- Home's profile list: the six steps of `owner.profile`, each naming its
  Stamp and linking to where it is done, with a link to your passport.
  Opening Home runs the same reconciliation as the passport page, after
  first paint; `POST /api/me/passport/dismiss` puts the list away for an account that
  finished the older welcome.

Built in the place slice (2026-11-14,
[note](../notes/2026-11-14-place-in-setup.md)):

- The map step sets the place on Home: **Set a place** opens the picker
  under the step, a save latches the step and earns On the Map through
  the existing hook, and Not now stays. No clan page is needed: the
  place is the person's, so no clan or a map turned off is fine. Before
  a verified player, the step says to verify first.
- Your place has a permanent home in Settings > Profile (You in Elixir):
  the place or Not set, with Set, Change and Remove. On the Map's detail
  action (**Set your place**) and What members see's Location open it.
- Since 2026-11-15 a place has no visibility choice: the picker and Your
  place say who sees it (clan map, player map, Near you), and removing
  it is the way off ([note](../notes/2026-11-15-place-is-a-place.md)).
