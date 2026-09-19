---
slug: email
title: "Email"
description: "The six emails Elixir sends: five weekly reports built from your record with no model in the loop, and a milestone note when something you did is a first. Every one is a switch on your account page; every issue carries a one-click off; opens and clicks are counted per mail, never per reader."
section: using
order: 17
navTitle: "Email"
icon: mail
lede: "Six kinds, each a switch, each one click from off. Five are weekly; one arrives when something you did is a first."
---

# Email

Elixir sends six kinds of email. All six are **on by default** for
every approved account, because taking part in the beta includes the
product's mail, and all six are **a switch on your account page**
([Profile](/account/profile)) with a one-click *turn off* link in every
issue. Sign-in codes and account notices are service mail and arrive
whatever you choose here.

Five of the six are **reports**: structured, built from your record by
the same readers the tools answer with, no language model anywhere in
them. Every number is the number a tool would give you, and every one
of them carries the coverage note the tools carry, because a report
that hides a gap in the record is a report that lies. The sixth, the
Top 100, is a written piece, and the one place a model writes for
Elixir; how it is kept honest is below.

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
| Sunday | **Collector activity** | Only if you run an [Elixir Collector](/docs/operators): what your collectors fetched, how much the edge filter saved, quiet stretches, and what you earned. One mail per account, every collector you run pooled. Covers Sunday 14:00 UTC to Sunday 14:00 UTC, the operator's week. |
| As it happens | **Milestones** | Congratulations when something you or an alt did is a first: a new arena, a promotion in ranked, a personal-best band, a career-wins or collection step, a badge, a card unlocked. Checked hourly; everything new since the last note rides together. |

## Milestones are firsts

A milestone mails once, ever, per account and subject, keyed by the
moment's own identity: the arena, the league, the band, the badge. A
season's re-climb of an arena you have already been congratulated for
is silent; a higher one is news. A move down never mails. Friends' and
watchers' moments belong to the Tracking report, not here.

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

Each kind has its own switch on your [Profile](/account/profile), with a
**send me this now** button beside it so you can see what a kind looks
like for your account before deciding. Every issue's footer has a
one-click link for that kind; mail clients that support one-click
unsubscribe show it as their own button. Turning a kind off is
immediate and yours to reverse.

## Every email, on the record

Every email Elixir sends you has its own id, printed in its footer
("This email is …"). [Activity → Emails](/account/activity/emails)
lists every product email sent to your account, newest first, the way
MCP requests lists every call; open one to see the mail as it went out
and to **report a problem with this email**, which files feedback with
that email attached so nobody has to describe it. Quote the id and we
can find the one send you mean in our logs. Reading your own record is
never counted as an open (the image below is stripped before it is
shown). Sign-in codes are not listed.

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
carries no tag. Nothing counted is tied to you: no per-recipient
identifier travels in either the image or the links; the email's own id
is printed in the footer as text and never in a link.

Names are links into Browse, where the record is; tags appear only where
a name alone could be ambiguous. Nothing in a report is advice.

---

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
