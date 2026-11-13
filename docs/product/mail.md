# Mail

*Rewritten 2026-11-13 to the social layer, from the brief Jamie ratified
on 2026-10-12, under [`VISION.md`](../../VISION.md) and the rulings in
[DECISIONS](../DECISIONS.md) of 2026-11-11 and 2026-11-12. Jamie's words
and rulings are tagged `[Jamie, date]`, readings of them
`[engineering, date]`. Ratified by Jamie, 2026-11-13 ("I think the rest
is good to go").*

## What it is for

"Keeping you up to date is part of the service, even when you do not
open the website." Mail is how what the people you follow did reaches
you when you are not looking. [Jamie, about] The moment that sells
Elixir today is the weekly email: you see that your nephew levelled up
and hit milestones, and you text him "wow, great job this week". [Jamie,
2026-11-11, `VISION.md`]

## The mail set

One scheduled mail to members, and mail to a role when there is
something for that role to do.

| Mail | Who gets it | When |
| --- | --- | --- |
| **The digest** ("Your digest", kind `tracking_report`) | Every person account, on by default | Weekly on Wednesday by default, daily or off by choice; never an empty one |
| **Collector activity**, with its upgrade notices | The people running a collector | Sunday, covering Saturday to Saturday UTC; an upgrade notice when an installed release moves up |
| **Actions waiting** (`clan_actions_waiting`) | A clan's verified leaders with an Action that became theirs | When an Action waits, at most once a day per clan |
| **An answer to your feedback** | The person who filed it | When it is answered, one mail per answer |

- **The digest is the one scheduled mail.** "One digest email and
  merging clan and those you follow is really needed since it will be
  common for someone to follow all members of their clan. However,
  leader action emails should be separate and on-demand when there is an
  action for them to perform." [Jamie, 2026-11-12] It is the clan's week
  and the people you follow in one mail: "Weekly by default, daily or off
  by choice, never an empty week." [Jamie, 2026-11-12] It keeps the old
  friends mail's switch, so an opt-out stays an opt-out. [engineering,
  2026-11-12]
- **Operational mail is apart.** "Keep the collector email… it is very
  specific and like the leader action email is for a unique channel. For
  example, we may send a notice to a collector if their collector isn't
  updating or stops sending data. It is operational." [Jamie,
  2026-11-12]
- **Service mail.** Sign-in codes, the welcome and account notices are
  service mail, with no turn-off. Agents are never mailed; an agent's
  feedback is answered to the agent. [Jamie, 2026-09-17, 2026-09-18]

## What the digest tells

- **The people you follow,** each once, under themselves: who played or
  posted, highlights first with the player's own words, a followed
  clanmate marked as in their clan. It names no one quiet. [engineering,
  2026-11-12]
- **Your clans' own news:** a finished race, who joined, who departed
  and role changes, never the clan's battle count or who went quiet,
  which are members' play. A clan with no news has no part. A departure
  says departed, even after a leader says removed, because the mail
  reaches people outside the clan. [engineering, 2026-11-05, 2026-11-12;
  Jamie, 2026-11-05, 2026-11-11, A2]
- **You:** your own and your alts' firsts and progress. [engineering,
  2026-11-12]
- **Left to Clan and Stats:** the war-deck trend, per-member performance,
  the form line, opponents and decks. [engineering, 2026-11-12]

## Principles that decide the details

1. **Mail tells from the timeline.** Every mail is a digest of timeline
   items for its window, composed by calling the tools, never a second
   derivation, with the coverage note the tools carry, "because a report
   that hides a gap in the record is a report that lies." [Jamie,
   2026-09-18, 2026-10-12]
2. **Mail collapses; the timeline does not.** The digest counts the
   small things (card unlocks, badges) and draws a clan as a headline
   and three facts; the timeline keeps everything. [Jamie, 2026-10-08;
   engineering, 2026-11-12]
3. **Scheduled mail is one a day.** "There is no hard 1 a day…
   however, SCHEDULED emails we are intentionally only doing one a day.
   On demand/event based emails are a completely different thing and
   flow whenever they flow." The Actions mail is capped at one a day.
   [Jamie, 2026-10-12, 2026-11-12]
4. **No one gets more mail from a merge.** A clan's news alone sends a
   weekly digest, and a daily one only on a day a race finished; a
   person who had turned clan mail off gets no digest for clan news
   alone; the digest off stays off. [engineering, 2026-11-12]
5. **Clan's mail goes through Elixir.** Clan writes the words; Elixir
   holds the address, the switch and the unsubscribe, and sends only to
   the account that verified a player who can act. [Jamie, 2026-09-25]
6. **An action in mail says why it waits.** A reason line for people
   who can already see the action, a subject that leads with it, and
   its number stays in Discord. [Jamie, 2026-11-05]
7. **A name opens the player page; a clan's door is chosen per reader.**
   Every player's name opens the player page, for every reader; a clan
   the reader is in opens Clan's War. [Jamie, 2026-11-05, 2026-11-12]
8. **Every send is on the record.** Each mail has an id in its footer
   that opens its record; the mail is kept as sent; feedback about it is
   one click; the relay logs the id, never the recipient. [Jamie,
   2026-09-19]
9. **Counted by issue, never by reader.** One pixel per mail naming the
   mail; campaign tags on links; SES tracking never on; no public issue
   page (sharing is forwarding). [Jamie, 2026-09-18, 2026-09-19]

## What it never does

Send a second scheduled mail to members; mail an agent; count a reader;
resend after a stop; print a nickname in public; tell a removal in the
digest; hide a
gap in the record; hotlink Supercell's art; carry a cheer, a follower or
anything else the bell tells. [Jamie, 2026-11-12: "nothing new goes to
mail or Discord"]

## Elixir's own voice is deterministic

Elixir funds no model use. Its own voice (mail, timeline text, Stats,
the site) is written from the record by code; models run on a clan's
own key in Clan, or in a person's own agent. [Jamie, 2026-10-12]

## Open

- A followed clan whose notifications the reader turned off is outside
  the digest, so its news no longer reaches that reader by mail: fewer
  mails, but a change in who receives a clan's news, flagged for Jamie
  in #823.
- Whether the bell should carry your own firsts, which reach you on the
  timeline and in the digest (#823).
- The digest's cadence default (weekly, daily, or the person's choice) is
  open in VISION; weekly by default stands until Jamie revisits it.
