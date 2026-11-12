---
slug: email
title: "Email"
description: "The seven emails Elixir sends: three weekly reports built from your record, your digest of the people you follow (weekly or daily), a milestone note when you or an alt reach a big first, Clan's note when something new in your clan is yours to do, and the answer to feedback you filed. Every one is a switch in Settings; every issue carries a turn-off link; opens and clicks are counted per issue, never per reader."
section: friends
order: 4
navTitle: "Email"
icon: mail
lede: "Seven kinds, each a switch and a turn-off link: three weekly reports, your digest, milestones, clan actions waiting and answers to your feedback."
reviewed: "2026-11-12 your digest, weekly or daily by your choice; 2026-10-12 the collector week is Saturday to Saturday, and one a day is for scheduled email only; 2026-10-12 no email is composed by a model; 2026-10-08 for legendary badges as milestones, contract 11.5.2"
---

# Email

Elixir sends seven kinds of email. All seven start **on by default** for an active
person account, and all seven are **a switch**
([Settings › Emails](/settings/emails)), with a *turn off* link in every
issue and one-click unsubscribe in mail clients that support it. Sign-in codes and account notices are service mail and arrive
whatever you choose here.

Three of the seven are weekly **reports**, and your digest and the
milestone note are built the same way: structured, built from your record by the same
readers the tools answer with, no language model anywhere in them.
Every number is the number a tool would give you, and every one of
them carries the coverage note the tools carry, because a report that
hides a gap in the record is a report that lies. Clan actions waiting carries
Clan's own words about your clan, the lines its Feed shows,
and an answer to your feedback is the maintainer's answer as it was
written. An answer email leads with the response, followed by what you
wrote for context; a question asks you to reply on the same item. Elixir
composes no email with a language model.

## The week

The reports cover the **game week**: Monday 10:00 UTC to Monday 10:00
UTC, the day every clan's war, donation reset and season roll share.
Whichever day a report lands, it covers the week that closed on Monday,
so Tuesday's and Wednesday's mail agree with each other. The season label
belongs to that covered week, even after a new season starts. A clan report
with a closed race names that race's own season and river race week together;
a report without a closed race uses the season just before the covered week's
Monday boundary. A subject names that week the same way: "Your Clan,
Season 137, week 4: 2nd in war, 1 departed, 2 joined". Every weekly report sends at 14:00 UTC.
Your digest is not a game week: it covers the week (or the day) before
it comes, [below](#your-digest).

Battles in the clan report count what was
played in the game week by `battle_time`, each battle once, boat defenses
out: the same number as [a week in Season](/docs/clan-week). Times in mail
are written like the rest of Elixir ("Sat 8:42 pm", "Fri Oct 23, 5:07 pm")
in your own time zone, with "UTC" beside them when no zone is set.

The collector report is the one exception. It still comes on Sunday, and
it covers **Saturday 00:00 UTC to the next Saturday 00:00 UTC** (Friday
evening in US time zones), so Sunday's email is the week that closed the
night before, and its dates name the days it holds, Saturday to Friday.

Scheduled email comes at most once a day for each kind and subject: one
clan report for each clan you track where something happened that week (two
clans, two reports on Monday; a clan with nothing to tell sends none, and a
report with a gap in its reading still comes, saying so),
one Clan actions waiting a day for each clan, one digest a day at most,
and one of every other weekly kind per account. Email about something that happened is not
scheduled, and comes when it happens: milestones as the moments do, and
each answer to your feedback on its own.

| Day | Kind | What it is |
|---|---|---|
| Monday | **Clan report** | Your clan's week: the war result if a war week closed (the clan's place, fame and war trophies, the race as it finished, the top five who raced and your own players, and the clan's war decks used out of those possible beside the races before), who joined and departed and when, who has gone quiet (verified members of the clan only, with the date of their last battle), and the week in battles, promotions, new bests and donations, with the battles and members who battled set against the weeks before, with a link to the roster and one to the race's own week in Explore, by its Season and Week. One report per clan you track, the same one to every member who tracks it, with its days named in your own timezone and your own players marked *you*. Elixir tracks your primary player's clan for you as soon as it sees it, when you have a clan slot free ([Your player's clan](/docs/recording#your-players-clan)). |
| Tuesday | **Your week in the Arena** | Your own battles, primary and alts: the headline record split by mode group (a pooled win rate across modes would mix different games), the most-used deck in your busiest non-war mode drawn card by card, with its record and level gap from that mode alone (with fewer than five battles in the week, a link to your decks instead), one line setting that mode's win rate this week beside the four game weeks before it, each with its battle count (left out when either side has fewer than 10 decided battles; the same numbers as Stats' [This week vs your last 4](/docs/ladder#this-week-vs-your-last-4)), who you faced and who came round more than once, and a line for each alt. It links the week's season on [Stats](/docs/ladder), and every deck of it on Stats' Decks. **Cards and badges** counts, for each of your players, the week's cards unlocked and badge levels, which no longer come as milestone emails, with a link to your [timeline](/docs/timeline) where each one is listed. A day later than the clan report so late battle-log reads have landed. Skipped when none of your tags battled. |
| Wednesday, or daily | **Your digest** | What the people you follow played and posted, and your own stretch: [below](#your-digest). Weekly on Wednesdays at 14:30 UTC by default; daily at 14:30 UTC, or off, by your choice. Skipped when nothing happened. |
| Sunday | **Collector activity** | Only if you run an [Elixir Collector](/docs/operators): each collector by its card, its full reported version and the collector page's security status (signed, dev build, unverified or mismatch), whether it is checking in, silent or stopped, its fetches this week and how many of them added new facts to the record; how much was blocked as already recorded, and your limits: an active collector raises them to [Family](/docs/roles#upgrades). One mail per account, every collector you run pooled. Covers Saturday 00:00 UTC to the next Saturday 00:00 UTC, the week that closed the night before ([above](#the-week)). |
| Mornings | **Clan actions waiting** | From [Clan](/clan), each morning, when something new in your clan is yours to do (promote, welcome, answer a departure, say whether you are away), with everything waiting for you and a link to act. Only if you can act on it, only to the account that verified the player, and at most one a day per clan. Clan writes the words and Elixir sends them, so the app needs no address to mail you. |
| When answered | **Answers to your feedback** | When Elixir's maintainer answers [feedback](/docs/your-account#feedback) you filed, from anywhere in Elixir (Settings, Stats, Clan, an email's footer, the docs), and you have not read the answer yet: what you wrote, the answer, its status and the version it shipped in, with a link to the item. It is written from the answer's item on your [timeline](/docs/timeline) (`account_feedback_responded`), so the email and the timeline say the same thing. One mail per answer, however many come in a day; an answer is mailed after ten quiet minutes, so a correction made straight away is one mail. Getting the email does not count as reading the answer: opening the item does. An agent's feedback is answered to the agent, never mailed. |
| As it happens | **Milestones** | Congratulations when your main player reaches a big first (another of your players' firsts wait for Tuesday's mail): a new arena, a new league in Path of Legends, a new personal-best trophy band, an Evolution or Hero form unlocked, a legendary badge, or a career milestone (every 1,000 career wins, and each Collection Level step). A new arena or league comes with the battle that did it and a link to [that battle's page](/docs/battles#a-battles-page); a form comes as its art. Its button opens Stats on the season the moment happened in. Cards unlocked and badge levels never send one on their own: Tuesday's Arena email counts them. Checked hourly; everything new since the last note rides together. |

For Arena's featured deck, equal mode counts use alphabetical mode-group
order, and equal deck counts use the recorded deck hash order. If the selected
mode or the deck's card art cannot be established, that card is omitted. Both
the headline and the featured deck cover the same completed game week.

### Collector upgrade notices

The collector email switch also controls upgrade notices: one email for each
collector whose installed version Elixir sees change to a higher released
version. Five upgraded collectors produce five separate emails, normally within
a few minutes of their check-ins. Naming an available release sends nothing.
Each notice names the old and new versions, the reading time and security
status. First check-ins, unknown/dev versions, downgrades and same-version
restarts produce no upgrade notice. A later upgrade following a rollback is a
new recorded transition.

When available, the notice includes the target release’s published notes and a
maintainer-supplied reason for naming it. These explain the release’s purpose;
they do not prove whether a particular machine updated automatically or was
changed by its operator. Missing reasons and notes are stated explicitly.
Security status uses the same self-reported version/hash comparison as the
dashboard, and is not remote attestation. A signed collector can still be behind
the current release.

## Milestones are firsts

A milestone mails once, ever, per account and subject, keyed by the
moment's own identity: the arena, the league, the band, the career step,
the card's form, the legendary badge. Only the big firsts mail (2026-10-08): a card unlocked
or a badge level is a count in Tuesday's Arena email and an item on your
[timeline](/docs/timeline), never an email of its own. A season's re-climb of an arena you have already been
congratulated for is silent; a higher one is news. A move down never mails. Friends' and
watchers' moments belong to your digest, not here. If a check is
missed (an outage, a failed send), the next one reads back to the last
check that went through, up to a week, so a first is late rather than lost.

## Your digest

Your digest is the [timeline](/docs/timeline) of the people you follow,
rendered for your inbox: the email chooses what to say, and the timeline
keeps everything.

- **When:** weekly, on Wednesdays at 14:30 UTC, by default. In
  [Settings › Emails](/settings/emails) you can make it daily (every day
  at 14:30 UTC) or turn it off. The choice shows while it is on.
- **What it covers:** the week (or the day) before it comes, starting no
  earlier than your last digest, so nothing is told twice. It tells what
  the record learned in that time, so a battle recorded late still
  arrives, once.
- **From people you follow:** each friend and watched player who played
  or posted, friends first, up to twelve with the rest counted. Each has
  their battles and record, their trophies, and up to three things:
  their [highlights](/docs/timeline#highlights) first, with their own words, then
  the big firsts (a new arena, league, best band, form, legendary badge
  or career step), a move between clans or a return, each with a link to
  the battle that did it when the record knows it. Cards unlocked and
  badge levels are a count.
- **Around you:** each clan you track that had battles, members joining
  or leaving, or a finished race, as a headline and at most three facts
  with the rest counted; then you, and any alt that played.
- **Never an empty week:** when no one you follow played or posted, and
  neither did you, no digest comes. A clan's week alone does not send one.

What an app attests (Clan's departures, roles, awards and messages,
Drop's personal records) stays out of the digest; the timeline still
carries them to their readers. Anything a person typed, a name, a
nickname or a highlight's words, is shown as text.

## What every email looks like

Every email Elixir sends wears the same frame, so a sign-in code and a
clan report are plainly from the same sender: Elixir's logo and name at
the top with a plain label naming the part of Elixir it comes from,
the mail itself, and a footer that
says why you got it and when the next scheduled one comes, in your own timezone.
The report leads with its figures and uses readable headings and rows;
its coverage note remains visible below the main link. An activity-scope
clan report records rosters and wars and leaves battle activity unknown.
A weekly email's footer then has one line, **Turn off this mail · Manage
emails · Send feedback · Mail** and the first six characters of its id, then the
disclaimer; a sign-in code or a welcome has no such line, because you asked
for it. The logo and card art are PNGs served from
elixir.poapkings.com, never Supercell's servers, and each card says its name
to a mail client that does not show images. The one other image is the open
pixel ([below](#what-the-mail-counts)). A deck is drawn the way the
game draws it, eight cards in a row, with the tower troop named under
it. A clan report stays small enough that Gmail never cuts it short,
even for a full clan: it links the roster rather than printing it.

## Turning one off

Each kind has its own switch on [Emails](/settings/emails)
(Settings › Emails). Each scheduled kind shows its local
day and time beside its switch. Event-driven kinds follow below, then the
latest sent records. **Every email** turns them all off, or all back on. Every issue's
footer has a
*turn off* link for that kind, which opens a page with one button to
confirm; mail clients that support one-click unsubscribe show their own
button, which needs no confirming. Turning a kind off is immediate and
yours to reverse.

## Every email, on the record

Every email Elixir sends you has its own id, shortened in its footer
("Mail a1b2c3") with the whole id in the link; the link opens that email's
record in your account, and **Send feedback** in the same footer
opens the feedback form with that email attached, one click from your
inbox. Back leaves that automatically opened form; Forward returns with the
email attached. Closing the form sends nothing.
**All sent** on Emails
([/settings/emails/sent](/settings/emails/sent)) lists
every product email sent to your account, newest first; open one to see the
mail as it went out. A report
about an email carries the mail itself, so nobody has to describe it,
and the maintainer reads the same body you were sent. Quote the id and
we can find the one send you mean in our logs. Reading your own record
is never counted as an open (the open pixel is stripped before it is
shown). Sign-in codes are not listed.

Every product email is kept as it was sent, so what we send can be
audited without waiting for anyone to report it.

## What the mail counts

Mail is counted by issue, never by reader, through
[Tinylytics](https://tinylytics.app), the same cookie-free analytics the
site uses. A 1×1 GIF from Tinylytics in each mail counts an **open** at a
path that names the mail, not the reader (`/mail/clan_report/2026-W37`); it is an
estimate, and a low one, since image blocking and caching both cut
against it. The other images, the logo and card art, are plain files
and count nothing. Links into the site carry a **campaign tag** (the mail's
kind and issue), so the site's own counts can say which mail brought
people to which page. There is no redirector: a link goes where it
says, and the *turn off* link carries no tag. The footer's links to the
email's own record and to feedback about it carry the email's id,
because they open one of your own records; the website counts those
pages as "an email record", never which one. [Privacy](/docs/privacy)
covers the rest.

A player's name opens their [player page](/docs/player-page), for every
reader. A clan you are in opens at Clan, War, and its roster link at
Members; another clan opens its record. A battle opens its own page, and
an action opens in Clan. Signed out, a page says why it needs you to sign in,
and signing in brings you back to it. Tags appear only where a name alone could
be ambiguous. A link to a season or a race names it:
Stats links carry the season the mail describes (`/home/you/stats?season=136`),
and the clan report's race link its Season and Week, so a mail opened
after the next roll still opens what it described. Nothing in a report is
advice.

---

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
