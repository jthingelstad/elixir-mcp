---
slug: email
title: "Email"
description: "The seven emails Elixir sends: five weekly reports built from your record with no model in the loop, two written weekly pieces, and a milestone note when something you did is a first. Every one is a switch on your account page; every issue carries a one-click off; opens and clicks are counted per issue, never per reader."
section: using
order: 17
navTitle: "Email"
icon: mail
lede: "Seven kinds, each a switch, each one click from off. Six are weekly; one arrives when something you did is a first."
---

# Email

Elixir sends seven kinds of email. All seven are **on by default** for
every approved account, because taking part in the beta includes the
product's mail, and all seven are **a switch on your account page**
([Profile → Email](/account/profile/email)) with a one-click *turn off* link in every
issue. Sign-in codes and account notices are service mail and arrive
whatever you choose here.

Five of the seven are **reports**: structured, built from your record
by the same readers the tools answer with, no language model anywhere
in them. Every number is the number a tool would give you, and every
one of them carries the coverage note the tools carry, because a report
that hides a gap in the record is a report that lies. The other two,
the Top 100 and Card of the Week, are **written** pieces, and the one
place a model writes for Elixir; how they are kept honest is below.

## The week

The reports cover the **game week**: Monday 10:00 UTC to Monday 10:00
UTC, the day every clan's war, donation reset and season roll share.
Whichever day a report lands, it covers the week that closed on Monday,
so Tuesday's and Wednesday's mail agree with each other. Everything
sends at 14:00 UTC. At most one Elixir email a day, the milestone note
excepted.

| Day | Kind | What it is |
|---|---|---|
| Monday | **Clan report** | Your clan's week: battles and sessions, the war result if a war week closed, who joined and left, role changes, standouts, and the roster with each member's trophies and the week's change. One report per clan you track, the same one to every member who tracks it. |
| Tuesday | **Your week in the Arena** | Your own battles, primary and alts: the record by mode, the decks you played, who you faced. A day later than the clan report so late battle-log reads have landed. Skipped when none of your tags battled. |
| Wednesday | **Tracking report** | Everyone you track, ordered by who they are to you: you in full, your alts shorter, friends a paragraph, watchers a line, your clans a line. It is the [timeline](/docs/timeline) for the week, rendered. |
| Thursday | **Top 100** | One issue for everyone: a read of the global Path of Legends top 100 over the week that ended at that morning's board. Forward it to anyone who would enjoy it. |
| Friday | **Card of the Week** | One card the record has something to say about, read in full: how much it is played and how often it wins, where it gets played, who plays it best, what it travels with, and the decks carrying it. One issue for everyone. Forward it to someone who runs that card. |
| Sunday | **Collector activity** | Only if you run an [Elixir Collector](/docs/operators): what your collectors fetched, how much the edge filter saved, quiet stretches, and what you earned. One mail per account, every collector you run pooled. Covers Sunday 14:00 UTC to Sunday 14:00 UTC, the operator's week. |
| As it happens | **Milestones** | Congratulations when something you or an alt did is a first: a new arena, a promotion in ranked, a personal-best band, a career-wins or collection step, a badge, a card unlocked. Checked hourly; everything new since the last note rides together. |

## Milestones are firsts

A milestone mails once, ever, per account and subject, keyed by the
moment's own identity: the arena, the league, the band, the badge. A
season's re-climb of an arena you have already been congratulated for
is silent; a higher one is news. A move down never mails. Friends' and
watchers' moments belong to the Tracking report, not here.

## Card of the Week, and how it stays honest

Friday's issue is about one card, and the card is **chosen by a
program, not by us**: the ten most-played cards of the season that have
not been written up in the last year, with one drawn from those ten.
The draw is fixed for a given week, so the same week always chooses the
same card, and the ten it chose from are kept with the issue. A card is
used up by an issue that actually **sends** — an issue that fails its
checks leaves that card where it was, still due its turn.

It is written the same way the Top 100 is. A program builds the
**brief**: the closed game week's usage, win rate and players; where the
card stands among all cards this season and the cards either side of it;
every recorded season as a series; the split by mode and by trophy band;
what the global Path of Legends top 100 do with it; the cards it travels
with; and the most-played decks carrying it. The writer may print a
number only after reading it from the brief through a tool, an editor
pass corrects the draft, and before the issue sends a program checks
every number in it against the brief, refuses bare tags and exclamation
marks, and holds the length. An issue that fails does not send.

Three things about that issue are worth knowing. **The headline covers
the game week that closed on Monday; the modes, bands, partners and
decks cover the season so far** — the record can only answer those over
a whole season — and the footer of every issue says which is which. And
the **decks are printed by the mail, not written by the model**: it says
which deck, and the cards come from the record. Two different decks can
share one archetype name, so a deck list typed from a label would be the
wrong deck. And **there is no season-by-season trend**, on purpose:
Elixir has been recording for months rather than years, and the amount
it records grew by two orders of magnitude over that time, so a card's
share "rising" across those months would mostly be a picture of our own
coverage. The issue will carry a trend once enough seasons are large
enough to compare with each other, and not before.

Every issue links to that card's page, at `/cards/<id>`, which needs no
sign-in and carries the same numbers, refreshed nightly.

## The Top 100, and how it stays honest

The Top 100 is written by a model, and the rule is that the model never
computes. A program builds a **brief** from the recorded boards: the top
100 now and a week ago, who climbed and fell and by how much (rank and
rating together, always), who entered and left, which clans have several
players up there, the podium's week, and a *deep cut* chosen by the
program for being the week's most counterintuitive fact. Every delta is
in the brief. The writer may print a number only after reading it from
the brief through a tool, so the record of what it read is the audit; an
editor pass then corrects the draft against the program's findings.
Before an issue sends, the program checks every number in it against
the brief, refuses bare tags and exclamation marks, and holds the length.
An issue that fails does not send that week. Named players are public
leaderboard entries, written about neutrally, and linked to their record.

## Turning one off

Each kind has its own switch on [Profile → Email](/account/profile/email),
beside the list of what was sent to you. Every issue's footer has a
one-click link for that kind; mail clients that support one-click
unsubscribe show it as their own button. Turning a kind off is
immediate and yours to reverse.

## Every email, on the record

Every email Elixir sends you has its own id, printed in its footer
("This email is …"); the id opens that email's record in your account,
and **Something not right? Send feedback about this email** beside it
opens the feedback form with that email attached, one click from your
inbox. [Activity → Emails](/account/activity/emails) lists every
product email sent to your account, newest first, the way MCP requests
lists every call; open one to see the mail as it went out. A report
about an email carries the mail itself, so nobody has to describe it,
and the maintainer reads the same body you were sent. Quote the id and
we can find the one send you mean in our logs. Reading your own record
is never counted as an open (the image below is stripped before it is
shown). Sign-in codes are not listed.

Every product email is kept as it was sent, so what we send can be
audited without waiting for anyone to report it.

## What the mail counts

Two things, both through [Tinylytics](https://tinylytics.app), the same
cookieless analytics the site runs, hosted in Europe, keeping nothing
about a person. A 1×1 image in each mail records an **open** as a page
hit at a path that names the mail, never the reader (`/mail/clan_report/2026-W37`,
`/mail/login`) — an undercount, since image blocking and caching both cut
against it, and Tinylytics says so itself. Links into the site carry a
**campaign tag** (`utm_source=email`, the kind, the issue), so the site's
own numbers can say which mail brought people to which page. There is no
redirector: a link goes where it says. The one-click *turn off* link
carries no tag. Nothing counted is tied to you: the count is per issue
and per campaign, never per reader, and no open or click is attributed
to a recipient. The footer's links to this email's own record and to
feedback about it carry the email's id, because they open one of your
own records (see [Privacy](/docs/privacy), bucket two); the console
reports those pages to analytics as "an email record", never which one.

Every product email's footer also carries the same line for everyone:
Elixir is free and sponsor-supported, with a link to
[Support](/support). Sponsorship changes nothing about the mail you get.

Names are links into Browse, where the record is; tags appear only where
a name alone could be ambiguous. Nothing in a report is advice.

---

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
