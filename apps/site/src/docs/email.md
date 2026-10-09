---
slug: email
title: "Email"
description: "The seven emails Elixir sends: four weekly reports built from your record, a milestone note when you or an alt reach a big first, Elixir Clan's note when something new in your clan is yours to do, and the answer to feedback you filed. Every one is a switch on your account page; every issue carries a turn-off link; opens and clicks are counted per issue, never per reader."
section: friends
order: 3
navTitle: "Email"
icon: mail
lede: "Seven kinds, each a switch and a turn-off link: four weekly reports, milestones, clan actions waiting and answers to your feedback."
reviewed: "2026-10-08 for legendary badges as milestones, contract 11.5.2"
---

# Email

Elixir sends seven kinds of email. All seven start **on by default** for an active
person account, and all seven are **a switch on your account page**
([Account settings ▸ Emails from Elixir](/console/account/profile/email)), with a *turn off* link in every
issue and one-click unsubscribe in mail clients that support it. Sign-in codes and account notices are service mail and arrive
whatever you choose here.

Four of the seven are weekly **reports**, and the milestone note is
built the same way: structured, built from your record by the same
readers the tools answer with, no language model anywhere in them.
Every number is the number a tool would give you, and every one of
them carries the coverage note the tools carry, because a report that
hides a gap in the record is a report that lies. Clan actions waiting carries
Elixir Clan's own words about your clan.

## The week

The reports cover the **game week**: Monday 10:00 UTC to Monday 10:00
UTC, the day every clan's war, donation reset and season roll share.
Whichever day a report lands, it covers the week that closed on Monday,
so Tuesday's and Wednesday's mail agree with each other. The season label
belongs to that covered week, even after a new season starts. A clan report
with a closed race names that race's own season and river race week together;
a report without a closed race uses the season just before the covered week's
Monday boundary. Everything sends at 14:00 UTC. The rule is at most one email of a kind about one
subject a day: one clan report for each clan you track (two clans, two
reports on Monday), and one of every other kind per account. Milestone
notes are exempt: they come as the moments do.

| Day | Kind | What it is |
|---|---|---|
| Monday | **Clan report** | Your clan's week: the war result if a war week closed (the clan's place, fame and war trophies, the race as it finished, the top five who raced and your own players, and the clan's war decks used out of those possible beside the races before), who joined and left and when, who has gone quiet, and the week in battles, promotions, new bests and donations, with the battles and members who battled set against the weeks before, with a link to the roster and one to the race's own week in Explore, by its Season and Week. One report per clan you track, the same one to every member who tracks it, with its days named in your own timezone and your own players marked *you*. Elixir tracks your primary player's clan for you as soon as it sees it, when you have a clan slot free ([Your player's clan](/docs/recording#your-players-clan)). |
| Tuesday | **Your week in the Arena** | Your own battles, primary and alts: the headline record split by mode group (a pooled win rate across modes would mix different games), the most-used deck in your busiest non-war mode drawn card by card, with its record and level gap from that mode alone, one line setting that mode's win rate this week beside the four game weeks before it, each with its battle count (left out when either side has fewer than 10 decided battles; the same numbers as Ladder's [This week vs your last 4](/docs/ladder#this-week-vs-your-last-4)), who you faced and who came round more than once, and a line for each alt. It links the week's season on [Ladder](/docs/ladder), and every deck of it on Ladder's Decks. **Cards and badges** counts, for each of your players, the week's cards unlocked and badge levels, which no longer come as milestone emails, with a link to your [timeline](/docs/timeline) where each one is listed. A day later than the clan report so late battle-log reads have landed. Skipped when none of your tags battled. |
| Wednesday | **Your friends this week** | How everyone you follow played: a card each for your friends and the busiest players you watch (their battles in each mode, a moment or two, then their cards unlocked and badge levels as a count, the deck they played most), with you in a line and each of your clans as a headline and at most three of the week's facts, the rest counted with a link to the clan. Anyone quiet for 30 days or more is named once, in one line. It is the [timeline](/docs/timeline) for the week, rendered: the email chooses what to say, and the timeline keeps everything. |
| Sunday | **Collector activity** | Only if you run an [Elixir Collector](/docs/operators): each collector by its card, its full reported version and the dashboard’s security status (signed, dev build, unverified or mismatch), whether it is checking in, silent or stopped, its fetches this week and points to date; how much the edge filter saved, and what you earned: points (fetches that added to the record) and the credits they convert to, one per ten points. One mail per account, every collector you run pooled. Covers Sunday 14:00 UTC to Sunday 14:00 UTC, the operator's week. |
| Mornings | **Clan actions waiting** | From [Elixir Clan](/clan), after its morning run, when something new in your clan is yours to do (promote, welcome, answer a departure, say whether you are away), with everything waiting for you and a link to act. Only if you can act on it, only to the account that verified the player, and at most one a day per clan. Elixir Clan writes the words and Elixir sends them, so the app needs no address to mail you. |
| When answered | **Answers to your feedback** | When Elixir's maintainer answers [feedback](/docs/your-account#feedback) you filed, from anywhere in Elixir (the Console, Ladder, Elixir Clan, an email's footer, the docs), and you have not read the answer yet: what you wrote, the answer, its status and the version it shipped in, with a link to the item. One mail per answer; an answer is mailed after ten quiet minutes, so a correction made straight away is one mail. An agent's feedback is answered to the agent, never mailed. |
| As it happens | **Milestones** | Congratulations when you or an alt reach a big first: a new arena, a new league in Path of Legends, a new personal-best trophy band, an Evolution or Hero form unlocked, a legendary badge, or a career milestone (every 1,000 career wins, and each Collection Level step). A new arena or league comes with the battle that did it and a link to [that battle's page](/docs/battles#a-battles-page); a form comes as its art. Its button opens Ladder on the season the moment happened in. Cards unlocked and badge levels never send one on their own: Tuesday's Arena email counts them. Checked hourly; everything new since the last note rides together. |

For Arena's featured deck, equal mode counts use alphabetical mode-group
order, and equal deck counts use the recorded deck hash order. If the selected
mode or the deck's card art cannot be established, that card is omitted. Both
the headline and the featured deck cover the same completed game week.

### Collector upgrade notices

The collector email switch also controls upgrade notices: one email for each
collector whose installed version Elixir observes change to a higher released
version. Five upgraded collectors produce five separate emails, normally within
a few minutes of their check-ins. Naming an available release sends nothing.
Each notice names the old and new versions, the observation time and security
status. First check-ins, unknown/dev versions, downgrades and same-version
restarts produce no upgrade notice. A later upgrade following a rollback is a
new observed transition.

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
watchers' moments belong to Your friends this week, not here. If a check is
missed (an outage, a failed send), the next one reads back to the last
check that went through, up to a week, so a first is late rather than lost.

## What every email looks like

Every email Elixir sends wears the same frame, so a sign-in code and a
clan report are plainly from the same sender: Elixir's logo and name at
the top with a label saying which part of Elixir it comes from and when
(Clan · Monday, Account · Sign in), the mail itself, and a footer that
says why you got it and when the next one comes, in your own timezone.
A weekly email's footer also carries the turn-off link, its id, and the
sponsor line; a sign-in code or a welcome has no turn-off, because you
asked for it. The logo and card art are PNGs served from
elixir.poapkings.com, never Supercell's servers, and each card says its name
to a mail client that does not show images. The one other image is the open
pixel ([below](#what-the-mail-counts)). A deck is drawn the way the
game draws it, eight cards in a row, with the tower troop named under
it. A clan report stays small enough that Gmail never cuts it short,
even for a full clan: it links the roster rather than printing it.

## Turning one off

Each kind has its own switch on [Emails from Elixir](/console/account/profile/email)
(Account settings ▸ Emails from Elixir), which lays the weekly kinds out on
your week by the day each arrives, in your time zone, with the two that come
when something happens below it and the last few sent beside them. **Every
email** at the top turns them all off, or all back on. Every issue's
footer has a
*turn off* link for that kind, which opens a page with one button to
confirm; mail clients that support one-click unsubscribe show their own
button, which needs no confirming. Turning a kind off is immediate and
yours to reverse.

## Every email, on the record

Every email Elixir sends you has its own id, printed in its footer
("This email is …"); the id opens that email's record in your account,
and **Something not right? Send feedback about this email** beside it
opens the feedback form with that email attached, one click from your
inbox. Back leaves that automatically opened form; Forward returns with the
email attached. Closing the form sends nothing.
**All sent** on Emails from Elixir
([/console/account/activity/emails](/console/account/activity/emails)) lists
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
because they open one of your own records; the console counts those
pages as "an email record", never which one. [Privacy](/docs/privacy)
covers the rest.

Every product email's footer also carries the same line for everyone:
Elixir is free and sponsor-supported, with a link to
[Support](/support). Sponsorship changes nothing about the mail you get.

Names are links into Explore, where the record is; tags appear only where
a name alone could be ambiguous. A link to a season or a race names it:
Ladder links carry the season the mail describes (`/ladder?season=136`),
and the clan report's race link its Season and Week, so a mail opened
after the next roll still opens what it described. Nothing in a report is
advice.

---

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
