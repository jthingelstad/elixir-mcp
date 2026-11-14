# Remaining phone surfaces and shared controls

Continues Jamie’s approved visual direction after #1010 and #1011. No
deployment; no route, navigation, existing API call or existing app copy
changes. The new update fragment records the visual change.

## What changes

The public front door uses a smaller existing bottle image and a left
reading column, with the same promise, actions and legal notice. The logo’s
old glow/ring rules and their four unused art tokens are removed. The status
chip still hugs its words. All source images remain unchanged.

Docs uses flat task groups with violet icons, links with 44px targets and a
44px search field. Search has a visible focus outline around the whole
field. The phone’s fields and selects use the existing 16px body role.

Stats shares one vertical-stack rhythm and avoids a second margin after
its tabs. Clan’s member search fills the phone gutter. Settings’ insets and
paragraph spacing use the four-point tokens, as do the shared phone panels.
The duplicate touch target token becomes the existing 44px `--hit` token.
Shared motion durations are 120/180/320ms, with the existing reduced-motion
rule retained. No animation library or runtime dependency is needed.

## Signed-in static header

Native browser review caught the static site’s older cached-name avatar path.
It now uses the same ring and name check as React. The glyph is shared in
one kit JSON asset, consumed by React and Eleventy; there are not two drawings.

The app’s existing session read leaves explicit proof in its local header
hint. Identity proof lasts five minutes; old/legacy hints render the generic
account icon instead of presenting an unknown player as unverified. The
thirty-day navigation hint remains, and no browser request is added. This
is visual identity only, never authorization. No email is stored.

The generic account icon remains in the shell manifest. The browser-test
change guard adds the account guide now opened by the stale-hint journey.

New session-hint and browser tests cover fresh true/false state, legacy and
expired identity hints, no role/art inference, and no additional /api/me read.
Signed-in site and Docs captures extend the fixture evidence. The new
no-extra-request assertion tears down Home before starting its count, so a
late Home observer refresh cannot be mistaken for a static-page request.

## Evidence and validation

Node 24 `npm run verify` passed all 30 test units, static checks and Lambda
builds. Full `npm run e2e` passed all 510 journeys without retries. Native
in-app browser review verified the static gold ring/name check, 16px/44px
Docs search and focus outline, the 358px clan search field, Stats controls,
Settings, and the public front door at phone and desktop widths. No reviewed
page overflowed, and the app console had no errors.

[Before/after gallery](../design/phone-surfaces/README.md) contains 136 PNGs.
All 34 captured body-text comparisons are identical after whitespace and
CSS-casing normalization, with the same capture origin. The new guide
paragraph explains the generic-account fallback; app copy is unchanged.

Before is #1011’s
merged source, with the same invented-player fixtures and fixed clock.
All 17 scenes are captured at 390 × 844 and 1280 × 844, first screen and
full page. No live player captures are published. All 186 built card-art files match
the main checkout by SHA-256; the crop table has no diff.

The source census falls from 167 to 162 root tokens and 1782 to 1769
selector rules. Type/radius roles stay 11/4; component CSS falls from
231205 to 230540 bytes, literal spacing pixels from 605 to 588 and
gradients from 6 to 5. Inline styles stay 195 app / 8 kit. Compared with
the original direction baseline, root tokens are 203 → 162, type roles
32 → 11, radii 19 → 4, selectors 1774 → 1769 and component CSS
233158 → 230540 bytes.

The desktop scope-height assertion changes from 36px to the shared 44px
target. Its center alignment check remains. Existing reflow,
accessibility, roster density, font-failure and interaction journeys remain
the acceptance checks. The new identity/art-failure journey remains intact.

Bell interaction design remains the separate proposal in #1009.
