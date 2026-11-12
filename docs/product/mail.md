# Mail

*Ratified by Jamie, 2026-10-12, in the sitting that drafted it.*

*Under [`VISION.md`](../../VISION.md) of 2026-11-11, Elixir is the missing
social layer of Clash Royale. Where this brief disagrees with the vision or
[DECISIONS](../DECISIONS.md), they win; the brief is rewritten after the
Design session (#752).*

## What it is for

"Keeping you up to date is part of the service, even when you do not
open the website." Mail is how the record reaches a person who is not
looking: the week as it closed, a big first the moment it happens, and
what in their clan is theirs to do. [Jamie, about]

## Who it serves

Every active person account, on by default for all seven kinds (kept
with public signup: keeping you up to date is the service), each a
switch of its own with a turn-off link in every issue; a stop is never
undone. [Jamie, 2026-10-12] Sign-in codes and account notices are service mail. Agents are
never mailed; an agent's feedback is answered to the agent. [Jamie,
2026-09-17, 2026-09-18]

## Principles that decide the details

1. **Mail tells from the timeline.** Every mail is a digest of timeline
   items for its window, composed by calling the tools, never a second
   derivation: every number is one a tool would give, with the coverage
   note the tools carry, "because a report that hides a gap in the record
   is a report that lies." [Jamie, 2026-09-18, 2026-10-12]
2. **Mail collapses; the timeline does not.** The friends mail counts the
   small things, draws a clan as a headline and three facts, and names
   the quiet in one line; the timeline keeps everything. [Jamie,
   2026-10-08]
3. **Seven kinds; scheduled mail is one a day.** Four weekly reports
   (clan, Arena, friends, collector), milestones as they happen, Clan's
   actions waiting after its morning run, and answers to feedback.
   Reports cover Monday 10:00 UTC to Monday 10:00 UTC and send at
   14:00 UTC. [Jamie, 2026-09-17, 2026-10-02] The collector report is
   the exception: it keeps its Sunday send and covers Saturday 00:00 UTC
   to Saturday 00:00 UTC ("since we send that on Sunday and I like that,
   let's do 0:00 UTC Sat to Sat"). [Jamie, 2026-10-12] The scheduled
   kinds (clan report, friends, Arena week, collector, actions waiting)
   send at most one of a kind about one subject a day; mail about an
   event (a milestone, an answer to feedback) flows when it happens:
   "there is no hard 1 a day… however, SCHEDULED emails we are
   intentionally only doing one a day. On demand/event based emails are
   a completely different thing and flow whenever they flow." [Jamie,
   2026-10-12]
4. **Milestones are the big firsts, once ever.** A new arena, league,
   best band, Evolution or Hero form, legendary badge, career step. A
   card unlocked or a badge level is a count in Tuesday's mail, never a
   mail of its own. A move down never mails. [Jamie, 2026-10-08]
5. **Clan's mail goes through Elixir.** Clan writes the words; Elixir
   holds the address, the switch and the unsubscribe, and sends only to
   the account that verified a player who can act. [Jamie, 2026-09-25]
6. **Every send is on the record.** Each mail has an id in its footer
   that opens its record; the mail is kept as sent; feedback about it is
   one click; the relay logs the id, never the recipient. [Jamie,
   2026-09-19]
7. **Counted by issue, never by reader.** One pixel per mail naming the
   mail; campaign tags on links; SES tracking never on; no public issue
   page (sharing is forwarding). [Jamie, 2026-09-18, 2026-09-19]
8. **Trends compare recorded weeks only.** A week the record lacks is
   left out, never a zero. [Jamie, 2026-10-08]
9. **A name opens the player page; a clan's door is chosen per reader.**
   Every player's name opens the player page, for every reader (Jamie,
   2026-11-12: "Yes, one page"); a clan the reader is in to Clan, Season. The
   facts stay one for every reader; the clan's choice is in the links.
   [Jamie, 2026-11-05, 2026-11-12]
10. **A quiet clan sends no report.** Nothing happened, nothing mailed; a race
    counts as something, and a failed read still sends with the gap noted.
    [Jamie, 2026-11-05]
11. **An action in mail says why it waits.** A reason line for people who can
    already see the action, a subject that leads with it, and its number stays
    in Discord. [Jamie, 2026-11-05]
12. **Firsts as they happen are the main player's.** An alt's wait for
    Tuesday's mail; with that mail off, the timeline has them. [Jamie,
    2026-11-05]
13. **Gone quiet is the clan's own.** Only verified members read it, as a last
    battle's date, never a count. [Jamie, 2026-11-05, 2026-11-06]

## What it never does

Mail an agent; count a reader; resend after a stop; print a nickname in
public; hide a gap in the record; hotlink Supercell's art.

## Elixir's own voice is deterministic

Elixir funds no model use. Its own voice (mail, timeline text, Ladder,
the site) is written from the record by code; models run on a clan's
own key in Clan, or in a person's own agent. This closes the 2026-10-11
question about model-written mail: no. [Jamie, 2026-10-12]

## Open

Nothing at the level of this page.
