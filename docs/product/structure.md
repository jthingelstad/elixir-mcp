# Structure

*No longer the structure record, 2026-11-12: `VISION.md` steers Elixir's
structure and this page is the record of the 2026-11-05 redesign
(DECISIONS "`VISION.md` steers Elixir's structure; `docs/product/structure.md`
is the 2026-11-05 record"). No longer holds: A4's "they aren't told" (the
bell tells a player of a new follower); the Console and Explore as places
of their own ("Console folds into You, player pages and Settings"); D12
and A21, alts' firsts in Tuesday's mail ("The digest is the one scheduled
mail; leaders' Actions mail stays apart"); a member's page in Clan apart
from the player page ("Clan's Actions are notifications and timeline
items"); A11, Recruit for every member ("Members is one page; members
keep Standing, and Recruit and Scout are leaders' and elders' tools");
A30 and the Invite clanmates row, now under Find's Your clan ("Invite
clanmates is not on Home"); D9, D11, A19 and Q4's Explore, which went
with the clan report and the Console. The rows those touch say so in
place.*

*Ratified by Jamie, 2026-11-05: "Approved: all 55 Elixir detail design
questions as recommended; build steps 1-3 in elixir-mcp, then stop for my
review"; and 2026-11-06: "Approved: build Elixir redesign steps 4-8 in
elixir-mcp". All eight steps shipped by 2026-11-06.*

*Under [`VISION.md`](../../VISION.md) of 2026-11-11, Elixir is the missing
social layer of Clash Royale. Where this brief disagrees with the vision or
[DECISIONS](../DECISIONS.md), they win; the brief is rewritten after the
Design session (#752).*

This is the redesign's record: how Elixir is arranged, the twelve
decisions, and every answer from the detail design. The design boards were
drawn on a temporary canvas; this page is what survives them. A ruling here
says what the surface becomes at its step. Until that step ships, the
public docs describe what runs.

Each line carries its build step. Steps are below. "No build" means the
ruling keeps things as they are or drops something.

## Build order

Each step ships alone.

| Step | What it covers |
| --- | --- |
| 0 | Bugs: signed-in state on static pages, the clan map's error, the New agent landing page (shipped 2026-11-05) |
| 1 | Words and time: one time format, plain words, fame and points, week numbering, mail's agent voice, the three battle counts. No structure changes |
| 2 | Kit: one page head, freshness chip, tabs, table, panel and empty state |
| 3 | Shell and Home: top bar, phone tabs, Today, Timeline, Friends, redirects from every old path |
| 4 | Clan's five tabs |
| 5 | Ladder's scope bar |
| 6 | Settings and search |
| 7 | Docs and public site |
| 8 | Mail: links first, then the footer and reason lines, empty reports, alts' milestones |

## The arrangement

### Top bar and phone tabs [Jamie, 2026-11-05, 2026-11-12; step 3, slice 7]

Asked "Slice 7, Home: one feed with chips Everyone, Friends, Clan and You, session sparklines, a new top bar and phone tabs (Home, Find, Clan, You, bell) replacing Home's three tabs, and reactions. Which reactions?", Jamie answered "Yes, six cheers (Recommended)". It replaces
the signed-in top bar and phone tabs of 2026-11-05 (Home, Ladder, Clan; Search
as the fourth phone tab).

- **Top bar, signed in:** Logo, Home, Find, Clan, search, Help, the bell,
  avatar with the player's name. The avatar's menu is You on a wide screen.
  [engineering, 2026-11-12] Play Drop left the bar on 2026-11-12 for the menu
  and the footer (Jamie, 2026-11-12: "Approved: build the remaining canvas pieces (bell, cheers on battle and player pages, Home side panel, Find, You with Stats, Clan Members follow-all and map, signed-out shell, Settings slots)").
- **Phone bottom tabs:** Home, Find, Clan, You, the bell.
- **Ladder** leaves the tabs: it is reached from You and from each player's
  page. [engineering, 2026-11-12] Since 2026-11-12 it is **Stats**, You's
  last tab (below).
- **Top bar, signed out:** Logo, Docs, Sign in, Create account; the signed-out
  home is sign in or join; Cards and Updates are in the footer at the same
  public addresses. Until 2026-11-12: Logo, Home, Cards, Docs, Updates, Sign
  in, Create account. [Jamie, 2026-11-12, the go above; engineering: the
  signed-out home is the site's front page with the gate on top]

### Home [Jamie, 2026-11-05, 2026-11-12; step 3, slice 7]

`/home` is one feed with the chips Everyone, Friends, Clan and You (the same
ruling); its tabs Today, Timeline and Friends are gone, and their old addresses
redirect. Its items take the ruling's six cheers, under each item; the RSS
link to the same feed is in Settings › Connections & agents. [engineering,
2026-11-12] Find is `/home/find` and You is `/home/you`. The brief is
[Home](home.md).

### Stats, which was Ladder [Jamie, 2026-11-05; step 5; Jamie, 2026-11-12]

A scope bar (player, season, mode chips, freshness chip) over the tabs Season,
Battles, Decks and Cards. Since 2026-11-12 it is You's Stats tab (Jamie: "You
with Stats", in the go above): routes `/home/you/stats`,
`/home/you/stats/battles`, `/home/you/stats/decks`, `/home/you/stats/cards`,
each old `/ladder` address redirecting to the same page. [engineering,
2026-11-12] Stats also opens for the players you follow, from their player
page, and never for a watched player or a stranger (DECISIONS "Stats opens
for the players you follow"). [Jamie, 2026-11-12] The battle page `/battle/<id>` keeps its layout.

### Clan [Jamie, 2026-11-05; step 4; Jamie, 2026-11-12; slice 8]

The page head has the clan's name, and a picker when the person has two or
more clans. One clan at a time stays.

Asked "Slice 8, Clan: replace Clan's five tabs with the canvas tabs Feed,
Standings, War, Members, Policy and Run (leaders only)?", Jamie answered
"Yes, the canvas tabs (Recommended)" [Jamie, 2026-11-12]. They replace
Today, Members, Season, Awards and Run. What each holds and who sees it is
as built [engineering, 2026-11-12, #766]:

| Tab | What it holds | Who |
| --- | --- | --- |
| Feed | Count badge; what waits for you, then the clan's last seven days (its items, members' moments and highlights, newest first); You here and The week beside them | Every member; the timeline's own reader rules |
| Standings | Standing, then a season picker merging races and history (was Awards) | Every member |
| War | A period picker merging The week and Season (was Season) | Every member |
| Members | Roster, Map; Recruit and Scout at the foot; find a member; Follow per row (G6, 2026-11-12: Standing went to Standings, Review to Run) | Recruit and Scout for elders and up (Jamie, 2026-11-12, replacing A11); every member keeps the active policy's lines at the foot |
| Policy | The policy in every member's words, its weights, its version and who saved it | Every member (public per A2) |
| Run | A grouped side list | Leader and co-leaders, verified; refused on the server to everyone else |

Run's side list:

- **Actions:** Waiting, Decided, Review.
- **Policy:** About.
- **What counts:** Minimums, Clan Wars, Ranked, Donations, Trophy Road.
- **People:** Elder, Inactivity, Arrivals, Departures.
- **Telling the clan:** Announcements.
- **Elsewhere:** Awards setup, Discord, Model & voice, Clan settings.

Routes: `/clan/<TAG>/feed`, `/standings`, `/war`, `/members`
(`?show=recruit` and `?show=scout` open the foot), `/members/map`,
`/members/away`, `/members/<player>`, `/policy`, `/run/<section>`
(`/run/actions` is Waiting, `/run/decided` Decided, `/run/review` Review).
Since G6 (2026-11-12) `/members/standing` redirects to `/standings`,
`/members/review` to `/run/review`, and `/members/recruit` and
`/members/scout` to the roster's foot.
`/clan/<TAG>/actions/<n>` stays. The old `/today`, `/season` and `/awards`
addresses redirect to the Feed, War and Standings, and `/today/decided` to
`/run/decided`. The chooser for someone with no clan open is
`/clan`.

An action's page leads with its reason, then facts, then "What this comes
from" folded, then the draft folded with its voice select and a 200-character
counter, and a sticky decide bar.

### Settings [Jamie, 2026-11-05; step 6]

Reached from the avatar menu. The left rail stays here and only here.

Profile; Players and tracking; Emails (switches plus Sent to you); Connections
and agents (an agent has the tabs Overview, What it reads, Usage, Connections,
Settings, and New agent opens in place); Sign-ins and devices; Usage and
limits; Feedback; Collectors, only if you run one.

Routes under `/settings`: `/profile`, `/players`, `/players/<tag>`, `/emails`,
`/emails/sent`, `/emails/<id>`, `/connections`, `/agents/<id>/<tab>`, `/usage`,
`/usage/requests`, `/sign-ins`, `/feedback`, `/collectors`. Since the Console
folded (Jamie, 2026-11-12) Explore's pages are gone: a player's record is
the player page's Record tab, lookups are Find and search, a clan's record
is the clan directory, and every old address redirects. Admin is under
Settings at `/settings/admin/*`, staff only, with the service page, Fleet
and Efficiency in it; Requests and Beta pulse were removed (Jamie,
2026-11-12, "Approval-era and retired code goes").

Where each real page that the first structure dropped goes:

| Works today | Home |
| --- | --- |
| Your usage, daily budget, live fetches, chart, busiest tools, limits | Settings, Usage and limits |
| Your MCP requests and call records, with "Report this call" | Usage and limits, Requests |
| Your feedback list and each item | Settings, Feedback; "Send feedback" also in Help and the footer |
| Sent emails and each email's record | Settings, Emails, Sent to you |
| A tracked player's page and its battle activity graph | Settings, Players and tracking, the player |
| Track a clan, what to record, slot counts | Players and tracking, Clans |
| Invite clanmates | Find, Your clan, folded below the clan's members (Jamie, 2026-11-12: "Bring your clanmates moves to Find"); Clan's Members keeps its own Spread the word. Not on Home: its first steps end the moment a read names the clan, so an invite there would never be seen. Until 2026-11-12 folded on Stats' Season (A30) |
| Connect Discord, Timeline to Discord and its delivery log | Connections and agents, Discord; Timeline links there |
| Refusal notices and each connection's permissions | Connections and agents, the connection |
| Agent keys, suspend and restore, who it answers for, its logs | The agent's tabs; logs under Usage; Timeline and Feedback are links |
| Run a collector, its token, your card | Settings, Collectors, and `/data` for people who don't run one yet |
| Cards and Updates for someone signed in | The footer and search |
| Policy's Minimums | Run, What counts, first entry |
| Recording and visibility, the Member map switch | Run, Clan settings |
| A clan's past decisions | Clan, Today, Decided, co-leaders up |
| Holds and notes on a member | Clan, Members, Review, the person's sheet |

### Public site [Jamie, 2026-11-05; step 7]

Home ("Your Clash Royale, on the record."), Cards, Docs, Updates, Sign in,
Create account. `/data` is the one public status and data page, in the footer.
Footer: Cards, Docs, Updates, Status and data, Support Elixir, Privacy, Terms,
the disclaimer, "a POAP KINGS product". Docs have three groups: Use Elixir,
Connect an AI, Build and reference. A Help drawer replaces the docs strip.

### Every name opens the player page [Jamie, 2026-11-12; slice 6]

Asked "Slice 6, the player page: should every player name anywhere open one
player page (Timeline, Highlights, Moments, Follows, Follow me link), replacing
your 11-05 rules "One name, one door" and "Mail links follow the reader" (own
player to Ladder, clanmate to Clan, others to the record)?", Jamie answered
"Yes, one page (Recommended)": "Every name opens the player page; Ladder and
Clan stay reachable from it. Members see follows, followers and badges, as
DECISIONS already says." It replaces "One name, one door" [Jamie, 2026-11-05].

### Mail links and footer [Jamie, 2026-11-05; step 8]

A player's name to the player page, for every reader [Jamie, 2026-11-12]; a
clan's name to Clan, Season; "Open the roster" to Members;
the button names the clan; a battle's link is unchanged; an action to Clan,
Today on that action; signed out, an explanation and a sign-in link, then back.

The footer: a why line; "Turn off this mail, Manage emails, Send feedback, Mail
`<short id>`" with the short id shown and the full id in the link; the disclaimer, word for word.

## The twelve decisions

All answered yes. [Jamie, 2026-11-05]

| # | Decision | Step |
| --- | --- | --- |
| D1 | The word "Console" retires. Paths keep working through redirects | 3 |
| D2 | Clan has five tabs, with the picker in the page head | 4 |
| D3 | An agent is a page in Settings, not a console you switch into | 6 |
| D4 | Home gains a Friends tab, mirroring Wednesday's mail; replaced by Home's one feed [Jamie, 2026-11-12] | 3 |
| D5 | The player's name everywhere; the account's email only in Settings | 3 |
| D6 | Casual is a fifth Ladder mode. It needs a mode entry and a chip | 5 |
| D7 | Policy is a grouped side list, not top tabs. The sections stay separate | 4 |
| D8 | Examples move into Docs; Data and Support move into the footer | 7 |
| D9 | A clan report is skipped when nothing happened in that clan; the clan report folded into the digest on 2026-11-12, which gives a clan a part only when it has news | 8 |
| D10 | Actions waiting carries a reason line per action, for people who can already see the action; the subject leads with the action | 8 |
| D11 | The clan report has a "You" line, only if the reader used at least 1 deck; ended with the clan report on 2026-11-12 | 8 |
| D12 | Alts' milestones wait for Tuesday's mail; the main player's arrive as they happen | 8 |

## Rulings this reverses

Each has its line in `docs/DECISIONS.md`.

- "Application controls and data first — keep the product tabs and left rail…"
  (Jamie, 2026-10-13). The product tabs stay, as Home, Ladder and Clan. The left
  rail goes, except in Settings. Controls and data still come first on each
  page. Step 3 onward.
- "A Clan picker heads Clan's rail" (Jamie, 2026-10-20). The picker moves beside
  the clan's name and only appears with two or more clans. One clan at a time
  stays. Step 4.
- "The console switches into an agent" (Jamie, 2026-09-23). An agent is a page
  in Settings, Connections and agents, with five tabs. Step 6.

Also touched: the Console brief's purpose splits into Home for the day and
Settings for the account (rewritten at step 3). "In tabs along the top … one
long page was too much" (Jamie, 2026-09-25, on Policy) keeps its point about one
long page; only where the sections are listed changes (step 4).

## Rulings that stand

Facts only: no rating, no recommendations. Form is numbers only, with no verdict
word, arrow, colour, score or advice, and nothing under ten decided battles a
side. One mode at a time. Nobody below co-leader sees another member's removal
or clock (Q1). Standing is groups, never a score or rank. One clan at a time. Clan's
own pages stay behind sign-in; the clan directory is public (VISION, 2026-11-11). Timeline is
newest first and unfiltered at source. Mail collapses and the timeline does not.
The seen marker is independent of agents. An action is one decide, Done or
Decline. War is weekly on clan war surfaces, and Ladder treats a person's battles
individually. Clan chat is 200 characters. A kick is "was removed", never "left".
No model picker. One origin, paths and no subdomains. Native dialogs and details.
Paths keep working through redirects. The battle page's layout stays as it
is; Explore's pages ("kept and linked, not polished") folded with the Console
on 2026-11-12, and Admin moved under Settings. Card art is never
altered. The disclaimer is on every surface, word for word.

## Answers: gaps (Q1 to Q16)

All [Jamie, 2026-11-05].

| # | Ruling | Step |
| --- | --- | --- |
| Q1 | A member sees their own removal clock, and never another's | 1 (brief); no build |
| Q2 | Every member can see each other's last battle date, as a date. Never a day count or an at-risk mark below co-leader | 4 |
| Q3 | A member at a Run address goes to Standing's "How it works here" | 4 |
| Q4 | A clan link in mail is decided per reader: members go to Clan, Season; everyone else to the clan's page in Explore. Since 2026-11-12 members go to Clan's War and everyone else to the clan's address, which opens the clan directory | 8 |
| Q5 | War on Ladder lists each war battle like any other, with one line above: decks used and points this week. No "of N", and no tool change | 5 |
| Q6 | Casual everywhere, never Friendly. On the battle page only the word changes | 1 (word); 5 (chip) |
| Q7 | Challenge and Tournament battles get a sixth chip, "Other", shown only to a player who has such battles this season | 5 |
| Q8 | Timeline keeps today's Who and State filters, drawn as chips, starting on Everything. Nothing is dropped unless the person asks. Since 2026-11-12 the Who chips are Everyone, Friends, Clan and You [Jamie, 2026-11-12]; State stays | 3, slice 7 |
| Q9 | One timeline wording everywhere, improved at the source, with a contract note. "departed (was Member)" stays with no tenure, and "was removed" once a leader says so | 1 |
| Q10 | Follow on Friends means Friend, with one small API change. The tab shows both lists, like Wednesday's mail. With no player of your own, it asks for yours first. Since slice 7 the Follow form is on Find, and the lists are the digest's [engineering, 2026-11-12] | 3 |
| Q11 | Settings gains Usage and limits and Feedback. Clan Today gains Waiting and Decided for co-leaders up. Minimums goes first under What counts | 3, 4, 6 |
| Q12 | `/data` is the one public status page, and the signed-in detail links from it | 3, 7 |
| Q13 | Updates shows product news by default, with a "Show contract versions" switch for builders. Agents keep `elixir_changelog` | 7 |
| Q14 | Standing says what counts, not what to do: "Trophies count here." and "War decks count here: four a war day, up to the clan's finish." | 1 |
| Q15 | Plain links to Terms and Privacy under the sign-in form, with no claim of acceptance | 1 |
| Q16 | Dropped from launch: close account and change email (both stay "write to us"), a separate account name, sign-in history with devices, per-agent calls today, limits, key endings and "reads private data", find a clan by name, a sign-in code on walls, the roster impact sentence, the rivals table in Clan, a setting for the morning run | No build |

## Answers: detail design (A1 to A39)

All [Jamie, 2026-11-05].

### Promises, and what people are told

| # | Ruling | Step |
| --- | --- | --- |
| A1 | Product news has no switch in Emails. Buttondown sends it, and Elixir never reads an unsubscribe back. A line in Emails, outside the count, points to the unsubscribe link in every issue | 6 |
| A2 | Say the trim now: "History stays for at least a year after the last person stops tracking." | 1 |
| A3 | The privacy page's status line names "The status page", and its lines about changing a time zone and disconnecting Discord name the new place | 1 |
| A4 | Friends says "they aren't told"; Find says it since slice 7 | 3 |
| A5 | Support says "every daily reading", and the Standing doc is corrected | 1 |
| A6 | What running a collector earns: "raises your limits to Family, and nothing else" | 1 |
| A7 | A short support line in the footer, as long as the full promise stays on Support | 1, 8 |
| A8 | Example transcripts rename real friends before the docs move | 1 |

### Clan words and rules

| # | Ruling | Step |
| --- | --- | --- |
| A9 | The rank rule extends to leaders: "In line for promotion on 3 weekly reviews", "Another member takes the seat", "Elder order" | 1 |
| A10 | The Slipping and Rising chips stay, tied to the fact: Slipping shows "demotion building", as Standing defines it | 4 |
| A11 | Every member reads Recruit and sees the button, as today. Replaced 2026-11-12: Recruit and Scout are for elders and up (Jamie) | No build |
| A12 | Elders and members land on Today, and a leader or co-leader with nothing waiting does too | 1 (brief); 4 |
| A13 | Battle counts line up on Monday's reset and this clan only | 1 |
| A14 | Race results are kept for every week, not only the newest six | 4 |
| A15 | Run with no policy goes to Roster with the invite panel. Under ten members goes to the too-few notice | 4 |
| A16 | Saving an untouched first draft is allowed; it makes a policy with everything off | 4 |
| A17 | A section switched off shows just the switch and its one help line | 4 |
| A18 | "Turn social features off" is "Member map", and "Monthly model limit" is "Monthly cap" | 1 |

### Mail

| # | Ruling | Step |
| --- | --- | --- |
| A19 | "Gone quiet" in the clan report goes to verified members only (Jamie, 2026-11-06); the line comes out for everyone else. Ended with the clan report on 2026-11-12: the digest names no one quiet | 8 |
| A20 | A race counts as something happening: a racing clan with no joins or departures still mails, and a silent clan skips | 8 |
| A21 | Firsts on an alt when Arena week is off reach only the timeline | 8 |
| A22 | A friend who is also a clanmate links to Clan; replaced by "Every name opens the player page" [Jamie, 2026-11-12] | 8 |
| A23 | The action's number comes out of mail, and stays in Discord | 8 |

### Settings and service

| # | Ruling | Step |
| --- | --- | --- |
| A24 | Battle activity is one hue by battle count, hatching for unknown. Won and lost stay in the two-week list | 6 |
| A25 | Confirm dialogs for Disconnect app, Disconnect Discord, Sign out, Sign out everywhere else, Suspend, Issue a new key, Remove, Replace token, Correct tag and Stop tracking, and none where a switch undoes it | 6 |
| A26 | Signed-in service detail is `/data/service`, linked from Status and data. `/console/status` goes away | 3 |
| A27 | Scope and limit words: "The clan only", "The clan and every member", "Leader limits", "Member limits". API values stay | 1 |
| A28 | "Add as" on the add form: Friend, Watching or Also you, with the small API change Q10 implies | 3, 6 |

### Ladder, Home and shell

| # | Ruling | Step |
| --- | --- | --- |
| A29 | A league on Path of Legends stays out of Ladder | No build |
| A30 | Invite clanmates on Ladder is folded on Season. Moved 2026-11-12 to Find's Your clan (Jamie) | 5 |
| A31 | An opponent's tag on Cards shows only when two names clash | 5 |
| A32 | When the check on a just-added player fails: "Elixir could not check just now. It will try again." | 3 |
| A33 | The new-player line in Ladder: "Clan asks for it before you act as an Elder or above." | 1 |
| A34 | Home's week adds an Events chip when the week has Events battles, so the two count the same | 3 |
| A35 | Play Drop on a phone is in the avatar menu and footer | 3 |

### Public site

| # | Ruling | Step |
| --- | --- | --- |
| A36 | Updates shows the previous month too, until there are ten product entries | 7 |
| A37 | `/family` stays unlinked, and the one link to it is fixed | 7 |
| A38 | `/signin` is the sign-in path, with redirects | 3 |
| A39 | Old Updates entries that say Console stay as history | No build |

## Voice and time [Jamie, 2026-11-05; step 1]

- Plain words for the average player. Facts, no cheerleading, no advice.
- "Sat 8:42 pm" within a week, "Fri Oct 23, 5:07 pm" older, in the person's
  zone. Never a raw timestamp or "2026-10-23". "Each morning", with no clock
  time.
- "Season 137, week 4" everywhere, never "S137 W4" on a member page.
- A race's clan total is fame, and a member's share is points. Fame is never
  divided per member.
- War decks have no "of N" while a race is open. A gap is unknown, never a
  claim the player didn't play.
- Not on member pages: corpus, capture incomplete, recorded-quiet days,
  comprehensive, Evidence held, Judged, Mean level gap, 4-card cycle, observed,
  snapshot, poll, ledger, tier as jargon, and em dashes in sentences. "Console"
  retires with D1 at step 3.

Wording rule: use the real string when it is good; when it isn't, write the
plain replacement and keep the meaning. Never invent a capability.

## Words chosen in the detail design

Written for the boards while applying the rulings above; not separate questions
to Jamie. [engineering, 2026-11-05]

- Departures, one form: "departed (was Member)"; a kick: "was removed (was
  Member)", once a leader says so.
- Away and hold, one sentence: "Keeps you off the removal list while it's on. The
  days keep counting."
- Retention: "Elixir keeps every battle it records" for battles; Support: "Keeps
  what it records while someone tracks it, and for a year after."
- Path of Legends, never "Ranked", as a mode name. "Trophy Road", never "Ladder",
  as a mode. "Clan", never "Elixir Clan". "Central time" in lower case.
