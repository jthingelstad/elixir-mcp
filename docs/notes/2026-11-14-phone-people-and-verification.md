# Phone people and verified identity

Approved follow-on to #1010. Jamie approved the direction, the remaining
surfaces, and an explicit exception to the visual-only brief: verification
metadata on existing website responses. No deployment.

## Design

Find exposes all six choices at 390px, without a clipped tab strip. Its
people lists align to the page gutter, using quiet separators rather than
another panel layer. Shared phone tabs have 44px targets and smaller type;
Home’s phone feed has less vertical padding. The cheer picker gets a short
160ms reveal, disabled for reduced motion. No animation dependency.

Verified/unverified is a core Avatar state. A two-pixel gold ring with a
two-pixel ground keyline surrounds both card art and initials. A small gold
check marks structured player names. Clan avatars do not inherit player
proof. Art failure keeps proof; art presence cannot grant it. Crops and
card-art bytes are unchanged.

## Metadata

Successful website identity responses add `player_verifications`, a tag to
boolean map. Existing tool bridge responses carry it inside their website
body. One batch reads the canonical person-account verified primary/alt
claim rule, including accounts without art. No additional browser request,
no account identifiers, email or Discord identity, and no route or
authorization changes. MCP and /api/v1 outputs remain unchanged.

The website query cache supplies the shared kit’s identity context. It is
per-app/per-SSR-request, takes newer responses over older ones and clears
with its cache. Search projections and multi-page season sweeps retain the
metadata. Named components opt in explicitly; narrative strings are not
rewritten by guessing names.

The new feature costs at most one additional batched SQL statement per
successful identity response. Budget tests explicitly allow that one
statement when the response contains metadata; all prior game-record
statement, range-scan and buffer ceilings remain. No per-row proof calls.

## Verification and evidence

The repository gate passed on Node 24 across all 30 test units, static
checks and Lambda builds. The browser suite found a low-contrast interval
in the picker’s opacity fade; the fade was removed so text stays readable
throughout its 160ms translation. Both cheer widths and the failed-art
identity journey passed after the fix. The complete browser suite then passed all 509 journeys, without retries.

Native in-app browser review separately checked 390px Find tab selection,
explicit verified/unverified names, the six 44px cheer targets, and Clan’s
verified name and roster state, Stats → Cards navigation and Settings
Usage. No reviewed page overflowed; the app console had no errors. The new name marks are accessible images;
existing heading tests now include that accessible state. Native player
selects use a check rather than trying to put SVG inside an option.

The sitemap test adds the verification guide; the old guide and app copy
are unchanged. All 30 captured body-text comparisons match except Docs at
desktop width, whose navigation gains the new guide. All 186 built card
art files match the main checkout by SHA-256; avatar-crops.ts has no diff.

[Before/after gallery](../design/phone-people/README.md) includes 120 PNGs.
Root/type/radius tokens stay 167/11/4; selectors 1769 → 1782, component CSS
230031 → 231205 bytes. The extra styles implement the new identity state
and Find presentation. Inline-style counts stay 195 in the app and 8 in
the kit.

The fixture gallery records Find’s
six states, Home/cheers, player, Stats, Clan, Settings, the site, docs and
battle at 390 and 1280 pixels. Existing source copy is retained. The new
verification guide and update fragment document the approved new state.

Bell interaction work remains #1009: scan hierarchy, returning focus and
mobile disclosure behavior need a dedicated interaction change.
