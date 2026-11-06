# Structure

*Ratified by Jamie, 2026-11-05: "Approved: all 55 Elixir detail design
questions as recommended; build steps 1-3 in elixir-mcp, then stop for my
review"; and 2026-11-06: "Approved: build Elixir redesign steps 4-8 in
elixir-mcp". All eight steps shipped by 2026-11-06.*

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

### Top bar and phone tabs [Jamie, 2026-11-05; step 3]

- **Top bar, signed in:** Logo, Home, Ladder, Clan, search, Help, Play Drop,
  avatar with the player's name.
- **Phone bottom tabs:** Home, Ladder, Clan, Search.
- **Top bar, signed out:** Logo, Home, Cards, Docs, Updates, Sign in, Create
  account.

### Home [Jamie, 2026-11-05; step 3]

`/home`, with tabs Today, Timeline and Friends.

### Ladder [Jamie, 2026-11-05; step 5]

A scope bar (player, season, mode chips, freshness chip) over the tabs Season,
Battles, Decks and Cards. Routes `/ladder`, `/ladder/battles`,
`/ladder/decks`, `/ladder/cards`. The battle page `/battle/<id>` keeps its
layout.

### Clan [Jamie, 2026-11-05; step 4]

The page head has the clan's name, and a picker when the person has two or
more clans. One clan at a time stays.

| Tab | What it holds | Who |
| --- | --- | --- |
| Today | Count badge; Waiting and Decided | Decided for co-leaders up |
| Members | Roster, Standing, Review, Map; Recruit, Scout; find a member | Review for co-leaders up; Scout for elders up; Recruit per A11 |
| Season | A period picker merging The week and Season | Every member |
| Awards | A season picker merging races and history | Every member |
| Run | A grouped side list | Co-leaders up |

Run's side list:

- **Policy:** About.
- **What counts:** Minimums, Clan Wars, Ranked, Donations, Trophy Road.
- **People:** Elder, Inactivity, Arrivals, Departures.
- **Telling the clan:** Announcements.
- **Elsewhere:** Awards setup, Discord, Model & voice, Clan settings.

Routes: `/clan/<TAG>/today`, `/members`, `/members/standing`,
`/members/review`, `/members/map`, `/members/recruit`, `/members/scout`,
`/members/away`, `/members/<player>`, `/season`, `/awards`, `/run/<section>`.
`/clan/<TAG>/actions/<n>` stays. The chooser for someone with no clan open is
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
`/usage/requests`, `/sign-ins`, `/feedback`, `/collectors`. Explore's pages stay
at their paths, reached from search. Admin is unchanged and staff only.

Where each real page that the first structure dropped goes:

| Works today | Home |
| --- | --- |
| Your usage, daily budget, live fetches, chart, busiest tools, limits | Settings, Usage and limits |
| Your MCP requests and call records, with "Report this call" | Usage and limits, Requests |
| Your feedback list and each item | Settings, Feedback; "Send feedback" also in Help and the footer |
| Sent emails and each email's record | Settings, Emails, Sent to you |
| A tracked player's page and its battle activity graph | Settings, Players and tracking, the player |
| Track a clan, what to record, slot counts | Players and tracking, Clans |
| Invite clanmates | Clan, Members (Spread the word), and folded on Ladder's Season (A30). Not on Home: its first steps end the moment a read names the clan, so an invite there would never be seen |
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

### One name, one door [Jamie, 2026-11-05; steps 3 to 6]

Your own player goes to Ladder. A clanmate goes to the Clan member page. Anyone
else goes to the record page in Explore.

### Mail links and footer [Jamie, 2026-11-05; step 8]

Own player to Ladder; clanmate to the Clan member page; friend or opponent to
the record page; a clan's name to Clan, Season; "Open the roster" to Members;
the button names the clan; a battle's link is unchanged; an action to Clan,
Today on that action; signed out, an explanation and a sign-in link, then back.

The footer: a why line; "Turn off this mail, Manage emails, Send feedback, Mail
`<short id>`" with the short id shown and the full id in the link; "Free and
sponsor-supported. Support Elixir"; the disclaimer, word for word.

## The twelve decisions

All answered yes. [Jamie, 2026-11-05]

| # | Decision | Step |
| --- | --- | --- |
| D1 | The word "Console" retires. Paths keep working through redirects | 3 |
| D2 | Clan has five tabs, with the picker in the page head | 4 |
| D3 | An agent is a page in Settings, not a console you switch into | 6 |
| D4 | Home gains a Friends tab, mirroring Wednesday's mail | 3 |
| D5 | The player's name everywhere; the account's email only in Settings | 3 |
| D6 | Casual is a fifth Ladder mode. It needs a mode entry and a chip | 5 |
| D7 | Policy is a grouped side list, not top tabs. The sections stay separate | 4 |
| D8 | Examples move into Docs; Data and Support move into the footer | 7 |
| D9 | A clan report is skipped when nothing happened in that clan | 8 |
| D10 | Actions waiting carries a reason line per action, for people who can already see the action; the subject leads with the action | 8 |
| D11 | The clan report has a "You" line, only if the reader used at least 1 deck | 8 |
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
or clock (Q1). Standing is groups, never a score or rank. One clan at a time. No
public Clan pages. A leader with Actions waiting lands on them. Timeline is
newest first and unfiltered at source. Mail collapses and the timeline does not.
The seen marker is independent of agents. An action is one decide, Done or
Decline. War is weekly on clan war surfaces, and Ladder treats a person's battles
individually. Clan chat is 200 characters. A kick is "was removed", never "left".
No model picker. One origin, paths and no subdomains. Native dialogs and details.
Paths keep working through redirects. The battle page's layout, Explore's pages
("kept and linked, not polished") and Admin stay as they are. Card art is never
altered. The disclaimer is on every surface, word for word.

## Answers: gaps (Q1 to Q16)

All [Jamie, 2026-11-05].

| # | Ruling | Step |
| --- | --- | --- |
| Q1 | A member sees their own removal clock, and never another's | 1 (brief); no build |
| Q2 | Every member can see each other's last battle date, as a date. Never a day count or an at-risk mark below co-leader | 4 |
| Q3 | A member at a Run address goes to Standing's "How it works here" | 4 |
| Q4 | A clan link in mail is decided per reader: members go to Clan, Season; everyone else to the clan's page in Explore | 8 |
| Q5 | War on Ladder lists each war battle like any other, with one line above: decks used and points this week. No "of N", and no tool change | 5 |
| Q6 | Casual everywhere, never Friendly. On the battle page only the word changes | 1 (word); 5 (chip) |
| Q7 | Challenge and Tournament battles get a sixth chip, "Other", shown only to a player who has such battles this season | 5 |
| Q8 | Timeline keeps today's Who and State filters, drawn as chips, starting on Everything. Nothing is dropped unless the person asks | 3 |
| Q9 | One timeline wording everywhere, improved at the source, with a contract note. "departed (was Member)" stays with no tenure, and "was removed" once a leader says so | 1 |
| Q10 | Follow on Friends means Friend, with one small API change. The tab shows both lists, like Wednesday's mail. With no player of your own, it asks for yours first | 3 |
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
| A4 | Friends says "they aren't told" | 3 |
| A5 | Support says "every daily reading", and the Standing doc is corrected | 1 |
| A6 | What running a collector earns: "raises your limits to Family, and nothing else" | 1 |
| A7 | A short support line in the footer, as long as the full promise stays on Support | 1, 8 |
| A8 | Example transcripts rename real friends before the docs move | 1 |

### Clan words and rules

| # | Ruling | Step |
| --- | --- | --- |
| A9 | The rank rule extends to leaders: "In line for promotion on 3 weekly reviews", "Another member takes the seat", "Elder order" | 1 |
| A10 | The Slipping and Rising chips stay, tied to the fact: Slipping shows "demotion building", as Standing defines it | 4 |
| A11 | Every member reads Recruit and sees the button, as today | No build |
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
| A19 | "Gone quiet" in the clan report goes to members only; the line comes out for non-members | 8 |
| A20 | A race counts as something happening: a racing clan with no joins or departures still mails, and a silent clan skips | 8 |
| A21 | Firsts on an alt when Arena week is off reach only the timeline | 8 |
| A22 | A friend who is also a clanmate links to Clan | 8 |
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
| A30 | Invite clanmates on Ladder is folded on Season | 5 |
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
