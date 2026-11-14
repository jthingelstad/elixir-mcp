# Phone experience review, 2026-11-14

**Recommendations for discussion.** The product code is unchanged by this
review. Follow-up discussion is tracked in [#1016](https://github.com/jthingelstad/elixir-mcp/issues/1016).
The comparison baseline is main `6eb3994a5`: phone redesign,
verification state, email styling and Clash/Rubik typography are merged,
but deployment remains on hold. Captures use invented local fixtures,
not production accounts or a claim of research on real phones.

The direction is a substantial improvement: clearer identity, readable
type, touch-sized actions and a consistent app/mail visual language. The
remaining opportunity is helping a player get to friends' activity quickly.

| Priority | Observed friction | Recommended next change |
| --- | --- | --- |
| P1 | Bell is a full-height drawer. Opening marks events seen, while outstanding actions and new events share attention. Escape loses focus to BODY in the inspected fixture. | Finish the deliberate phone inbox already tracked in [#1009](https://github.com/jthingelstad/elixir-mcp/issues/1009): separate New from Needs you, preserve outstanding work, clear destinations, focus return. Settle read/seen semantics before implementation. |
| P1 | Empty Home says “notify switch” and sends players to Settings > players. That makes a quiet week feel like account maintenance. | Use friendly, coverage-aware copy and a Find your people action. Offer active friend suggestions where evidence exists; unknown recording coverage must not mean the friend did not play. |
| P1 | Setup and finding active friends remain separate journeys. The current welcome does not lead picture or map choice. | Build the proposed compact six-step profile, showing one useful next action before the feed. One active friend suffices; email Off and map Not now finish those choices. Completed setup gets out of the way. |
| P1 | Profile’s Main player fact uses a plain name even when the fixture exposes verified ownership. | Use shared PlayerName/Avatar for this identity in the Profile build; audit every remaining plain-name identity row against explicit verification metadata. |
| P2 | Profile starts with email, sign-in, timezone and account facts; choosing the player's picture is farther down. | Put player identity and compact Passport before private account machinery. Preserve full account controls below. |
| P2 | Clan's six main tabs wrap on a narrow phone. In the small-roster fixture, status and setup warnings further delay member activity. | Test a clearer member path to Feed, Members and War, with secondary/leader destinations grouped without changing permissions. Do not infer every clan has the fixture's warnings. |
| P2 | Player tabs already wrap on phones, with own-player Stats and eligible Clan adding more. | Add Passport as a compact two-mark/count link, not another large grid above play or a new bottom tab. Revisit tab hierarchy separately if task testing still shows friction. |

## Evidence and limits

The existing `design-direction.spec.ts` captured 17 surfaces at 390 and
1280px and passed both browser cases, including no horizontal overflow
and no page errors. Representative current screens are alongside this
file: [Home](screens/home-390.png), [player](screens/player-390.png),
[Find](screens/find-390.png), [Clan](screens/clan-390.png),
[quiet feed](screens/quiet-feed-390.png), [Bell](screens/bell-390.png),
[Profile](screens/profile-390.png), [welcome](screens/welcome-390.png).
Extra interaction evidence is in `screens/audit-interactions.json`.

Source seams: `apps/web/src/shell/Bell.jsx` and `bell-logic.js`;
`apps/web/src/home/Feed.jsx`; `NewAccount.jsx` and `People.jsx`;
`apps/web/src/views/account/Profile.jsx`; `apps/web/src/home/Player.jsx`;
Clan's shared tabs. These observations are source/fixture based, not live
latency measurements or an end-user usability study.

## Mail and Stamps

The earlier email redesign remains the baseline. The Stamp build keeps
mail focused on friends and clan news: no new achievement digest rows,
Stamp email or mail opt-in reward. If future experience work changes shared
labels, typography, identity or calls to action, inspect `docs/EMAIL.md`
and the affected templates in the same change. Verification art remains
current-state proof in both app and mail.

The [passport prototype](../passport/README.md) demonstrates a possible Bell
Stamp destination; it does not repair the real Bell or decide its seen semantics.
