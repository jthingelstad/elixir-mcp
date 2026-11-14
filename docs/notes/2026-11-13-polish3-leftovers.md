# 2026-11-13 — Polish round three: one error form and the leftovers

Round three of the polish pass. Layout, styling and label wording only:
the same reads, the same retries, the same rules about who sees what.

## One error form

Every read failure is the kit's `ErrorState`: the title names what could
not be read ("Your feed could not be read just now"), the body says what is
safe and ends "Try again in a moment.", and Try again refetches that same
read. When an error shows and what is retried are unchanged; a few states
that had no retry (People's battles and clan, the bell's clan actions, the
clan's settings panels) now offer one for the read they already make.

Converted: Home (Today, Your week, Your clans, Feed, Player, Player record,
You, Follow me, People's four), the bell (notifications, clan actions),
Search, the Unavailable page, the error boundary, Clan read status, First
answer, Settings (Emails, Usage, a call record), Stats (`ReadError`, every
caller), and Clan (Feed, Run, Manage, You here, Recruit, Waiting, Sharing,
Actions, Member activity, Your place, Model, Standing, Policy, Directory,
Season, Discord, Voice, Map, Social).

Left as they are: write and field errors, access refusals ("for the
leader"), warnings, the feed's partial-load notes, inline lines inside a
card, and Admin. First answer keeps Check again beside its message, so it
has no second Try again.

`ErrorState` takes `titleAs`; an empty or error title is Inter at the
panel head's size whatever its level, and only a whole page's (an h1) is
the page title. The h1 rule's display face no longer leaks into a 14px
title (Settings' "No agent here on your account" was a 14px display head).

## The rest

- **Signed-out phone bar:** Docs leaves the bar under 760px and is in the
  footer, so the bar is one row; it stays in the bar on a desktop.
- **Your own player page:** no "You" label; Your stats and Copy my Follow
  me link say it.
- **Your clan's gold edge** (Find › Your clan, the clan directory) is a
  3px band on the top edge only; the inset shadow had followed the rounded
  corners down the sides.
- **The bell's more line** is the quiet button ("See 3 more in Clan"),
  44px on a touch screen.
- **Settings › Emails:** the four heads are the panel head, one size and
  one gap; All sent sits on its head's line at the small size; the last
  row leaves no padding to widen the gap to the next head.
- **Settings › Usage:** Requests in the head is quiet, so Connect an AI is
  the page's one filled button when nothing has called yet.
- **An agent that is not yours:** the empty page has its head at the page
  title's size and one line saying where your agents are.
- **The front page on a phone:** Create an account and Sign in take the
  column's width, the lede's edges, not an inset of their own.
- **A battle's games** are the kit's tabs, not a third tab style.
- **Home's chips on a phone** scroll as one row, New after the Who chips,
  and fade at the edge with more behind it; the hairline before a pinned
  New is gone.

Looked at and left: the player page's head height on a phone (21) is now
one row shorter without "You"; the rest is the head's counts and Copy my
Follow me link, which the design keeps. The Emails page's cadence control
is a choice, not tabs, and keeps its segmented look.

Roster read's explanation (#988's fix, 4d23c37f) checked on a phone: the
pop stays inside the 16px gutter with Roster read forced to a row's start
(left 121, right 374 of 390); nothing clipped.
