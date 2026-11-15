# Build handoff: Elixir passports and Stamps

Status: slice 1 (catalog, eligibility, storage, the two reads) built 2026-11-14 (#1015); earning (slice 3's hooks, slice 4, and slice 5's bell notices) built 2026-11-14 (#1015, [note](../notes/2026-11-14-passport-stamps-earning.md)); Home's profile list built 2026-11-14 (#1015, [note](../notes/2026-11-14-passport-profile-list.md)); the backfill is built (below); the pages are built. **Launched 2026-11-14** (build f6e5cb51a); the launch backfill ran on 2026-11-14 (47 accounts read, 30 granted). Close-out: [note](../notes/2026-11-14-passport-close-out.md), which audits the acceptance matrix below.
Implementation is tracked in [#1015](https://github.com/jthingelstad/elixir-mcp/issues/1015).
Start from [product direction](../product/stamps.md) and the
[interactive design](../design/passport/README.md).

## Accepted direction and proposal

**Jamie:** passport ink metaphor; Stamps visible on every person account;
no privacy toggle; player verification and setting a place each earn a
Stamp. Verification gold remains current proof, distinct from the dated
passport mark. The initial account-verification milestone is interpreted
as the existing proof-of-player-ownership flow, not another sign-in code.

**Engineering proposal:** eleven definitions, three level ladders,
member-authenticated passport URLs, owner-only exact progress, one
compact profile list, and the storage/read shape below. The older domain
plan's other setup/social principles carry forward. No additional product
approval is being invented by the prototype.

## Current seams to use

| Concern | Current source to inspect |
| --- | --- |
| Live proof and optional avatar art | packages/auth/src/player-identities.mjs; packages/ui/src/Avatar.tsx and PlayerName.tsx |
| Gold glyph | packages/ui/src/verification-mark.json |
| Person's primary/alt claims and verification | packages/claims/src; services/web-api/src/routes/claims.mjs |
| Welcome state and its completed flag | services/web-api/src/first-answer.mjs |
| Home's existing setup UI | apps/web/src/home/NewAccount.jsx; apps/web/src/pages/HomePage.jsx |
| Active follows and suggestions | services/web-api/src/people.mjs; apps/web/src/home/People.jsx |
| Picture write and picker | services/web-api/src/avatars.mjs; apps/web/src/views/account/AvatarPicker.jsx |
| Place save, removal and access | packages/clan/src/manage/social.mjs and the existing clan map views |
| Digest choice, including off | services/web-api/src/routes/email.mjs; account_email_pref |
| Discord link | packages/auth/src/discord.mjs |
| Reciprocal ownership/relationship rules | packages/tools/src/social.mjs |
| Highlights, cheers and accepted action events | services/web-api/src/cheers.mjs and highlight.mjs; their existing record/package handlers |
| Bell reads and presentation | services/web-api/src/bell.mjs; apps/web/src/shell/Bell.jsx and bell-logic.js |
| Player page, You and account menu | apps/web/src/home/Player.jsx; apps/web/src/shell/Shell.jsx |

Use the canonical game reference in the sibling cr-agent-api-docs
checkout if a battle-type meaning is uncertain. Do not copy it into this
repository or invent a friendly/2v2 classification.

## Public identity and routes

An account needs an opaque, stable **passport ID** independent of its
claimed game tag. Do not put internal account UUIDs or email in URLs.
Account.public_id currently identifies agent resources and is null for
persons (migration 0053); do not repurpose it or change MCP identities.

Proposed website paths:

    /home/passport
    /home/passport/<passport-id>
    GET /api/me/passport
    GET /api/passports/<passport-id>
    POST /api/me/passport/reconcile

The paths already sit under the native /home application behavior.
Use the existing signed-in member gate. The owner path resolves their
own public passport; another member reads the same public collection.
Anonymous access is not added. Agent credentials do not authenticate the
website or create a human passport.

Public read projection:

    passport:
      id: opaque product identifier
      display_name: public game name, or New player
      player: optional { tag, name, verified, avatar_card_id }
      earned: [{ stamp_id, level, earned_on }]
    catalog_version: 1

Never substitute private nicknames. An unverified primary claim may be
shown as a claim with “Player not verified”; it never gets the gold ring.
No player gives the generic account icon and New player, not an
email-derived initial or name.

The owner read adds profile-step state and exact progress. The public
read must never include email, Discord handle, city, coordinates, exact
unearned counts, timezone, account UUID, token or account machinery.
The earned date is a day, not a public exact activity timestamp.

GET /api/player may add a compact passport summary only for the canonical
verified owner. Unverified claims can be ambiguous, so never pick an
arbitrary claimant for the canonical player's passport. All accounts
still have their direct passport route and the account-menu/You link.
Known account actors can link a passport; keep anonymous follower
aggregates anonymous until their separate identity work is built.

No first-build MCP or /api/v1 Stamp fields or tools. Do not reuse a
verification “badges” property for Stamps.

## Storage and bounded lifetime progress

Use additive migrations, with the next migration numbers chosen at build.
The following is a shape, not executable migration SQL:

| Record | Key and purpose |
| --- | --- |
| account_passport | account_id primary key; unique random passport_id; created_at; person accounts only |
| account_stamp_earned | unique (account_id, stamp_id, level); earned_at UTC; frozen earned_on local date; definition version |
| account_stamp_fact | unique accepted source/event and qualifying day or battle identity; product facts needed for lifetime progress |
| Profile state | versioned step latches/completed marker; explicit map choice including not_now |

Cascade on account deletion. No public-row preference column is needed.
Preserve existing completed-welcome semantics; use a versioned marker for
the new six-step list rather than clearing the old one.

**Do not derive lifetime progress only from a rolling year of history.**
Earned levels alone are insufficient: three cheer days this year and
twelve next year still need to count toward level II.

Persist distinct qualifying facts up to each definition's maximum:
20 Played Together days, 50 Cheerleader days and 20 distinct highlighted
battles. After the maximum level, stop accumulating facts for that Stamp.
This bounds the ordinary progress evidence to 90 facts per person, plus
the earned levels. Serialize the account's Stamp update so concurrent
events cannot repeatedly insert past the cap.

A source event is accepted only once. Days use the account's timezone at
first acceptance, storing that local date with the UTC event; changing
timezone must never replay the same source event into another day.
Do not trust a browser-supplied date. Once recorded, day facts and earned
dates do not move when the display timezone changes.

Source evidence contains no city, coordinates, Discord username,
highlight words or other person's private account data. A map award needs
the fact of a successful place save, not a copy of the location.

## Definition details

| Definition | Deduplication and edge cases |
| --- | --- |
| player_verified | First successful current verified primary/alt ownership, person account only. An unverified/friend claim, art or role cannot grant it. A later revocation removes the live gold mark, not the dated Stamp. |
| looking_good | Successful explicit non-null picture choice. A favorite-card default or initials are not a choice. Removal does not revoke the Stamp. |
| on_the_map | Successful accepted place save under the existing clan gate. No grant on opening, permission prompts, failed save, Not now or a cleared place. Later removal leaves the dated Stamp; public data never contains location. |
| full_roster | Another own-player alt claim, not a friend/watch or the primary itself. The Stamp is not evidence that this alt is verified. |
| linked | Successful Discord connection. No public username, and the dated Stamp is not a claim that the connection remains active forever. |
| all_set | Six v2 steps complete, including verified ownership of the primary player; digest off and map not_now are valid choices. Alts and Discord are not required. Completion stays finished. |
| inner_circle | Five distinct other followed player tags with a recorded battle in the trailing seven days; exclude own primary/alts. Copy says players, not five distinct human identities that the record cannot prove. Missing coverage is unknown. |
| mutual | Reuse existing reciprocal-follow attribution and verified account ownership rules. No self/alt mutual and no inference from sharing a clan. Never prompt the user to ask for a follow back. |
| played_together | Reuse canonical friendly classification and participant evidence; for 2v2 the followed player must be a teammate. A random opponent is not evidence of queuing together. Include owned verified player tags; exclude the account's own alts as “friends.” One qualifying local day, irrespective of wins or number of games. |
| cheerleader | Accepted cheers on other people's items; one local day. Retries, changing emoji and repeat taps on that day do not multiply credit. Undo does not revoke an already-earned milestone. |
| storyteller | Accepted highlight with non-whitespace words, distinct canonical battle. Editing/reposting/alternate share URLs do not make another battle. Removing words later does not revoke an earned milestone. |

The friendly/teammate rule is the conservative engineering interpretation
of Played Together. If the canonical record cannot prove the relationship
or mode, leave progress pending instead of guessing.

## Earning and reads

Keep the catalog and eligibility calculation deterministic and independent
of UI, transport and wall-clock reads. Pass the snapshot and now explicitly.
Grant with unique keys and return only newly inserted levels. Reads of
someone else's passport never award or alter anything.

1. Check immediate facts after their successful existing mutation:
   verification, picture, place, own alt, Discord, follow and profile choice.
2. Record accepted cheer/highlight facts with their successful actions.
3. Reconcile game-derived or missed facts for the signed-in owner after
   Home or their passport loads, as one bounded, idempotent POST. Do not
   block the feed or write on a public passport GET.
4. Use recorded/observed ingestion checkpoints, not battle_time alone,
   so late-arriving battles are included once.
5. Deduplicate grants, day facts and notifications across retries,
   concurrent Home tabs and a hook racing reconciliation.

This makes the older plan's “check on Home” explicit rather than hiding
new public rewards in a GET. No scheduled job, per-view score, new CR API
call, SQS transport or analytics event is needed.

Use the existing account-event/bell mechanism for new awards. Three level
grants in one reconciliation should produce one highest-level notice for
that Stamp, not three popups. A foreground toast is optional and brief;
do not interrupt a sheet, verification flow or highlight composition.
No follower identity is exposed through cheers.

## Backfill

Provide an operator dry run with aggregate counts before granting anything.
Use only the source history Elixir still holds and current accepted setup
facts. Historical removed cheers, removed place choices and expired records
may be unknowable. Report a lower bound; never invent an earned date or
reconstruct erased location from logs/analytics.

For a legacy grant without a trustworthy completion instant, record
granted_at and the source window, and show “Earned before <launch day>”
instead of pretending launch day was when the person did it.

Backfill cannot revoke. It must be restartable and bounded per account.
Do not generate a bell flood for historic grants: one “Your passport is
ready” summary is enough. Do not run a live backfill in this design session.

Built 2026-11-14: migration 0272's launch line, `packages/stamps`
`legacy.mjs` and `backfill.mjs`, the `{passport_backfill}` op and the
bell's "Your passport is ready" line
(`docs/notes/2026-11-14-passport-backfill.md`). Run against
production on 2026-11-14: 47 accounts read, 30 granted.

## Build slices

1. Catalog, pure eligibility tests, additive storage and independent
   public identity, with the public-read privacy boundary.
2. Owner/public passport and detail sheet; wire the existing Avatar,
   PlayerName, Icon, PageHead, Dialog/focus and clock parts.
3. The six-step Home list, compact Profile/You/account-menu entry points,
   and existing mutation hooks. All Set must work with email off and
   Not now on the map before shipping.
4. Friendly-play, day and distinct-highlight facts; bounded reconciliation.
5. Compact verified-player passport summary and bell notices.
6. Dry-run backfill, review and the normal full verification gate.

Do not expose a production preview route, demo controls, artificial
verification button or sample earned states. Port the prototype's native
SVG/CSS treatment into the shared kit; use the existing Lucide package,
not copied icon paths. Adding its Swords key to the wrapper is sufficient
if that glyph is retained.

## Acceptance

- A new/unverified person has a passport that another member can open.
  There is no public/private toggle, verified-only gate or email-derived
  identity. Anonymous/agent website requests use the existing refusal.
- Canonical game-player pages never acquire an arbitrary claimant's
  passport; verified primary and alts resolve the same collection.
- Every public response excludes all private fields listed above.
- A revoked proof removes the gold mark while the dated verification
  Stamp remains. Art alone grants neither proof nor a verification Stamp.
- Place save earns only after success. Not now completes the profile
  step without On the Map. Removing a place does not erase its Stamp or
  expose the former location.
- Default weekly email is not an explicit choice; an accepted off choice
  is. Stamps never enable mail. Older finished onboarding can be dismissed.
- Retry/concurrency/timezone changes cannot duplicate facts or levels.
  Tests cross a year-retention boundary and include late game records.
- More than one cheer/day and reposting the same battle cannot multiply
  progress. Five wins, trophies and ranks cannot grant a Stamp.
- Public detail offers no private settings or map access. Exact unearned
  counts are owner-only.
- Loading/error/missing coverage are not zero progress or inactivity.
- 320/390/1280px, 200% text, font/art failure, reduced motion, 44px targets,
  screen-reader labels, Escape/focus return and touch reflow pass.
- The feed and digest contain no new Stamp items. Current cheers remain
  anonymous aggregates. No achievement leaderboard or engagement score.

Use the repository's current verify/e2e gates and read automated PR review.
