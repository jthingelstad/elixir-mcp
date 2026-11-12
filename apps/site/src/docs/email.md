---
slug: email
title: "Email"
description: "Elixir's email: one digest of the people you follow and your clan's week, weekly or daily, with each player told once; Clan's note when an action is yours to do; your collector's week if you run one; and the answer to feedback you filed. Every one is a switch in Settings; every issue carries a turn-off link; opens and clicks are counted per issue, never per reader."
section: friends
order: 4
navTitle: "Email"
icon: mail
lede: "One digest of the people you follow and your clan, weekly or daily. Besides it, only mail with something for you to do or read: clan actions waiting, your collector's week, and answers to your feedback."
reviewed: "2026-11-12 one digest: the clan report, Arena week and milestone mails folded into it; 2026-11-12 your digest, weekly or daily by your choice; 2026-10-12 the collector week is Saturday to Saturday; 2026-10-12 no email is composed by a model"
---

# Email

Elixir sends **one digest**: the people you follow and your clan's week,
in one email, weekly by default. It is the only scheduled email most
people get. Besides it, Elixir mails you only when there is something for
you: a clan action that is yours to do, your collector's week if you run
one, and an answer to feedback you filed.

| Kind | When | What it is |
|---|---|---|
| **Your digest** | Wednesdays at 14:30 UTC, or daily, or off: your choice | The people you follow and your clan's week in one story, each player once: [below](#your-digest). Skipped when nothing happened. |
| **Clan actions waiting** | When an action becomes yours | From [Clan](/clan), when something new in your clan is yours to do (promote, welcome, answer a departure, say whether you are away), with everything waiting for you and a link to act. Clan checks each morning, after its daily read, and mails only when something new is yours since your last one: nothing waiting, nothing sent, and at most one a day per clan. Only if you can act on it, only to the account that verified the player. Clan writes the words and Elixir sends them, so the app needs no address to mail you. |
| **Collector activity** | Sundays at 14:00 UTC | Only if you run an [Elixir Collector](/docs/operators): each collector by its card, its full reported version and the collector page's security status (signed, dev build, unverified or mismatch), whether it is checking in, silent or stopped, its fetches this week and how many of them added new facts to the record; how much was blocked as already recorded, and your limits: an active collector raises them to [Family](/docs/roles#upgrades). One mail per account, every collector you run pooled. Covers Saturday 00:00 UTC to the next Saturday 00:00 UTC, the week that closed the night before. |
| **Answers to your feedback** | When answered | When Elixir's maintainer answers [feedback](/docs/your-account#feedback) you filed and you have not read the answer yet: what you wrote, the answer, its status and the version it shipped in, with a link to the item. One mail per answer, sent after ten quiet minutes, so a correction made straight away is one mail. Getting the email does not count as reading the answer: opening the item does. An agent's feedback is answered to the agent, never mailed. |

All of them start **on** for an active person account, and each is **a
switch** ([Settings › Emails](/settings/emails)), with a *turn off* link
in every issue and one-click unsubscribe in mail clients that support it.
Sign-in codes and account notices are service mail and arrive whatever
you choose here.

Every email is built from your record by the same readers the tools
answer with, with no language model anywhere in it. Every number is the
number a tool would give you, with the coverage note the tools carry,
because a report that hides a gap in the record is a report that lies.
Clan actions waiting carries Clan's own words, the lines its Feed shows,
and an answer to your feedback is the maintainer's answer as it was
written.

## Your digest

Your digest is your [timeline](/docs/timeline) for your inbox: the
people you follow and the clans you track, told as one story. The email
chooses what to say, and the timeline keeps everything.

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
  their [highlights](/docs/timeline#highlights) first, with their own
  words, then the big [firsts](/docs/milestones) (a new arena, league,
  best band, form, legendary badge or career step), a move between clans
  or a return, each with a link to the battle that did it when the record
  knows it. Cards unlocked and badge levels are a count. A clanmate you
  follow says which of your clans they are in.
- **Your clan:** each clan you track with news of its own: a river race
  that finished (its place and fame), who joined and departed, and role
  changes, as a headline and at most three facts with the rest counted.
- **You:** your own week, your firsts, your cards and badges counted, and
  each alt that played, with its firsts.
- **Never an empty week:** when no one you follow played or posted,
  neither did you, and no clan you track has news, no digest comes.

**Each player once.** Following everyone in your clan is common, so the
digest never tells a player's week twice: their battles, firsts and
highlights are told under them, and the clan's part keeps to the clan's
own news. A clanmate you follow who left the clan is told in the clan's
part, not again under them. A clan's battle count and who went quiet are
on [Clan](/docs/clan-week), not in the mail.

What an app attests (Clan's departures, roles, awards and messages,
Drop's personal records) stays out of the digest; the timeline still
carries them to their readers. Anything a person typed, a name, a
nickname or a highlight's words, is shown as text.

## Collector upgrade notices

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

## What every email looks like

Every email Elixir sends wears the same frame, so a sign-in code and a
digest are plainly from the same sender: Elixir's logo and name at
the top with a plain label naming the part of Elixir it comes from,
the mail itself, and a footer that
says why you got it and when the next scheduled one comes, in your own timezone.
Each mail uses readable headings and rows, and its coverage note stays
visible below the main link. A scheduled email's footer then has one line, **Turn off this mail · Manage
emails · Send feedback · Mail** and the first six characters of its id, then the
disclaimer; a sign-in code or a welcome has no such line, because you asked
for it. The logo and card art are PNGs served from
elixir.poapkings.com, never Supercell's servers, and each card says its name
to a mail client that does not show images. The one other image is the open
pixel ([below](#what-the-mail-counts)). A deck is drawn the way the
game draws it, eight cards in a row, with the tower troop named under
it. A digest stays small enough that Gmail never cuts it short: it
counts what it leaves out and links the rest.

## Turning one off

Each kind has its own switch on [Emails](/settings/emails)
(Settings › Emails). The digest shows its local day and time and its
cadence beside its switch. The other kinds follow below, then the
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
path that names the mail, not the reader (`/mail/tracking_report/2026-W37`); it is an
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
and a finished race's link its Season and Week, so a mail opened
after the next roll still opens what it described. Nothing in a report is
advice.

---

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
