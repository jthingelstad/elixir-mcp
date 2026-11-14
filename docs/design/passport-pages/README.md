# Passport pages (#1015)

Playwright captures of the built app, answered by the journeys' invented
fixtures (`apps/web/e2e/passport-fixture.ts`). Viewport widths are
Playwright's, so 320 and 390 are true phone widths. Before is the tree at
68331b225; the passport pages did not exist there. Card art is the test
pixel, and Ada's art is made to fail on purpose.

| Scene | Before | After |
| --- | --- | --- |
| Profile, phone | [before](before/profile-390.png) | [after](after/profile-390.png) |
| Profile, desktop | | [after](after/profile-1280.png) |
| You, phone | [before](before/you-390.png) | [after](after/you-390.png) |
| Account menu, phone | [before](before/account-menu-390.png) | [after](after/account-menu-390.png) |
| A player's page, phone | [before](before/player-page-390.png) | [after](after/player-page-390.png) |
| Your passport, 320 / 390 / 1280 | | [320](after/passport-owner-320.png) / [390](after/passport-owner-390.png) / [1280](after/passport-owner-1280.png) |
| Your Stamp, a ladder | | [after](after/sheet-owner-cheerleader-390.png) |
| Your Stamp, a legacy grant | | [after](after/sheet-owner-legacy-390.png) |
| A member's passport | | [after](after/passport-public-1280.png) |
| A member's On the Map | | [after](after/sheet-public-on-the-map-390.png) |
| Player not verified | | [after](after/passport-unverified-390.png) |
| No player | | [after](after/passport-no-player-390.png) |
| A failed read | | [after](after/passport-failed-read-390.png) |

Full-page captures show the bottom bar where it sat when the page was
captured.
