# 2026-11-18 - Your games together

Jamie approved showing actual games with a followed friend. Together is
an optional tab on that friend's player page. Timeline stays the default,
so the shared record does not push their posts down the page.

Every read requires the person, a current visible friend follow and a
currently verified own primary or alt. The caller chooses one owned
player, never an arbitrary tag or an aggregate of their own players.
The player's private `you.pair` permission uses the same visible-friend
predicate as discovery, so a retained recording across a block does not
advertise a social association. No nickname or other opponent's identity
enters the pair response.

The record package reads a named pair from `battle_participant`: one
player's time-cover range, then a keyed probe of that battle for the
other tag. Same side means Teamed up; opposite side means Played against.
The two sections use separate pages, and filter mode and side before the
cap. Mode counts cover the whole 30-day window before presentation limits.
Battle links use the canonical shared helper. A duplicate observation
never becomes a second battle. Static boat defenses and self-pairs do not
represent games between two actual players and are excluded.

The interface contains facts and links, with no pooled rates, player
ratings or recommendation. Empty says there is no shared battle on
record; it never concludes the players did not meet. Existing blocks and
current verification are rechecked for every page. No collector work,
notification, mail, push, external delivery or new schema is added.

The mode-group/window/tab choices are engineering defaults Jamie may
change. This adds only member-web routes and data; MCP 14.1.0 and JSON API
6.0.0 remain unchanged. No legal wording is edited.

The regression starts with the missing pair route returning 404. Real
database cases cover both block directions, changed verification, separate
owned players and modes, static boats, unrelated games and tied-time paging.
A plan fixture with 10,000 unrelated battles checks the three pair/link
queries: the largest uses 202 shared buffers, with no full battle or
participant scan. These are local query measurements, not production
latency. Pagination accepts only its canonical six-digit UTC timestamp.

Fixture browsers check 320, 390 and 1280 pixels, keyboard navigation,
accessible names, 44px controls, reduced motion, no page overflow and
failure/empty/verification states. The visual iteration moved Together
immediately after Timeline so its selected label fits on a phone, and
made each section's count explicitly say battles.

Automated review caught verification loss during paging: a battle-page
request must refuse with `verification_required`, not return the summary's
verification state as a successful page. The real-database regression
fails on the former HTTP 200; a browser case keeps the page usable through
the refusal and recovers older battles after verification is restored.
That retry state sits beside the paging control, after the rows already
read, so a refusal is visible where the member requested the older page.

Both account and player read completions invalidate the shared Together
query prefix, including its summary and paged rows. The player landing
keys are defined once and included in the account keys. A rendered-query
regression fails on stale counts and rows for queued and already-fresh
completion in both lanes, while unrelated cache entries stay fresh.
