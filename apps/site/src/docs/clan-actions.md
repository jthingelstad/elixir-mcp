---
slug: clan-actions
title: "Actions"
description: "Elixir Clan's actions: the calls a clan's policy hands its leaders, elders and members, each kind and who gets it, when one appears and is withdrawn, how to decide one, the inactivity clock behind a removal, holds and away notices, and the morning email."
section: clan
order: 4
navTitle: "Actions"
icon: list-checks
lede: "An action is one call the clan's policy hands to a person: promote, welcome, answer a departure. Clan suggests it with its evidence and words to send; the person decides, and makes the change in the game."
reviewed: "2026-10-03; Clan Actions review, contracts unchanged"
---

# Actions

Elixir Clan never acts in the game and never decides for anyone. When
the clan's [policy](/docs/clan-policy) says something should happen, it
raises an **action**: one numbered call for the person or role who can
make it, with the evidence, the rule that raised it, and the words to
send when there are any. Someone decides it, makes the change in the
game, and the action's log keeps what happened.

## Inspect a member's recorded activity

Roster names and member Actions link to **View member activity**, a private
read for a current member of a clan you belong to. It shows four ISO weeks
of clan-scoped recorded battle counts and observed donation counters, the
recorded war weeks' deck usage and points, and paged battles grouped into
recorded sessions. Each battle opens its existing full detail page. ISO
weeks and war weeks stay distinct; decks are never assigned to war days.

Battle detail is clipped to the member's current observed stint and only
battles whose participant names this clan. A returning player's earlier
stint and other-clan play do not enter these counts. Donation counters are
unknown for a week that starts before the current observed stint. Earlier
war weeks are omitted; weekly totals crossing the stint or fixed read
boundary remain unknown rather than being split into days. Missing or failed
coverage reads remain unknown. Profile-counter intervals ending in the last
seven days can show missing battles, but do not prove that the entire
displayed window was observed. No recorded battle is not proof of no play.
Saved Action evidence retains its original timestamp and policy version;
the activity view is a new read, not a change to the recommendation.

## The kinds

| Action | Goes to | Words to send |
|---|---|---|
| Promote to Elder | the leader and co-leaders | a Clan Leader Message |
| Demote to Member | the leader and co-leaders | a Clan Leader Message |
| Remove from the clan | the leader and co-leaders | a line for clan chat |
| Departure: kicked, left, or ignore? | the leader and co-leaders | none |
| Welcome a newcomer | elders, co-leaders and the leader | a line for clan chat |
| Going to be away? | the quiet member alone | none |
| Announce the season's awards | the leader and co-leaders | a Clan Leader Message |
| Tell the clan how it runs | the leader and co-leaders | a Clan Leader Message |

Every kind is off until the policy turns it on. Promotions and
demotions come with ranking Elder by participation
([Standing](/docs/standing)); the others each have a switch of their
own.

## When one appears

Clan reads the clan every morning from 11:00 UTC, and again when someone
opens Standing or chooses **Refresh suggestions** in Actions. Actions normally
opens the saved evaluation with its as-of time, keeping decisions quick; its
first reading or a changed policy also evaluates the record.
A member has at most one open action of each
kind. An action that stops being true is **withdrawn**, with the reason
in its log: the member left, played again, or rejoined; a welcome waited
a week past the join.

- A **welcome** is raised for someone who joined in the last three days.
  Its suggested words may use a recently recorded career fact or a proven
  return to the clan. Missing or old evidence gets a simple welcome; a career
  total is never described as a milestone just reached.
- A **departure** is raised when someone leaves and no removal action
  explains it, because a leave and a kick look the same in the record:
  say which, so the clan's history knows.
- **Going to be away?** goes to a member who has reached at risk on the
  [inactivity clock](#the-inactivity-clock), asking them before anyone
  else is.
- An **announcement** is raised when a season's awards are decided, or
  when the leaders save a new version of the policy.

## Deciding one

Actions shows one **Open** list by default. Choose **Closed** to see the most
recent decisions from the last 30 days; older decisions remain in History.

| Action | The choices |
|---|---|
| Promote, demote, remove | **Complete**, or **Decline** with a reason (not now, knows the member, evidence wrong, handled in the game, other) |
| Departure | **Kicked**, **Left** or **Ignore**, with an optional note |
| Welcome | **Welcomed** or **Skip** |
| Announcement | **Sent** or **Skip** |
| Going to be away? | **Mark me away**, or **I'm not away** |

Make the change in the game, then mark the action. For a promotion
that means promoting the member and sending the Clan Leader Message;
they go together, as one action. Once decided, the decision stands; an
action someone else already decided says so.

After a **Complete**, Clan watches the record: if the role change or the
removal shows up within the clan's outcome window (48 hours to start),
the log says it was confirmed; if not, it is flagged. After a
**Decline**, the same kind for the same member waits before it can come
back: a week for a removal and two weeks for a promotion or demotion, to
start, or what the clan set.

Every action has a log: when it was raised and by which rule and policy
version, every comment, the decision and the outcome. Anyone who can
see it can comment, up to 1,000 characters.

An award progress update has one numbered Action containing every message in
order. Edit and copy a part, send it in the game, then choose **Mark message N
sent**. Copying alone records no delivery. Each receipt keeps the actual words,
sender and time; retries preserve it. **Complete update** becomes available
after every part is marked sent. **Skip remaining messages** closes the update
while keeping parts already sent. A failed Elixir recording can be retried by
the original sender without sending the game message again.

## The words to send

A Clan Leader Message is the game's leader message: only the leader and
co-leaders can send one, it has a title of up to 24 characters and a
body of up to 180, and it stays in every member's inbox. A clan chat
line is for the chat. Edit welcomes (up to 120 characters) and removal
messages (up to 200) before copying them into the game. Each field counts
characters and warns about known chat-filter problems. Copying a field waits
until its text fits; your edits stay in place to shorten. Nothing is ever
posted for the clan automatically.

With the clan's own model set up under **Manage ▸ Settings**, an open
Leader Message, welcome or removal action offers leaders and co-leaders
**Draft in our voice**. It uses the
clan's Anthropic key to draft a promotion, demotion, awards announcement
or policy-change announcement, a welcome, or a chat line to use after a
removal decision. After a leader confirms **Kicked** or **Left**, the departure
Action can also draft a respectful departure message or farewell. An observed
departure alone does not say which happened; an unconfirmed or ignored
departure has no voice draft.

The model may use the welcome Action's frozen return or recorded career
detail with its original observation time. Freshness was checked when that
detail was saved; drafting does not fetch a new profile or turn a career total
into a newly reached milestone. For a confirmed departure it receives the
leader's classification and confirmation time, the observed departure time,
and recorded tenure when known. Tenure's metric observation time is not stored;
it does not prove the member's exact or entire time in the clan.

Member names, tags, private decision notes, inactivity rationale, scores and
broader history stay local. Clan puts the name back into the model's
placeholder. The model never decides whether to promote, demote or remove
anyone. Drafts are bound to the Action's context: a changed confirmation or
frozen detail clears older words and rejects an in-flight result.

The clan's saved words in **Recruit** supply its voice. Choose a fixed tone for a chat line, or add a short Leader Message note
without member details; review and edit the answer.
**Put back what I had** restores your previous words. Elders can edit and
copy welcomes without using the clan's model. Completing a welcome records
the words as edited. Drafting completes no action and sends no game message.
While a draft is loading, copying and action decisions wait for it to finish.
Review the returned words before sending and marking the action complete.

When a call's outcome is unknown, that attempt counts toward the daily
limit. Check the use log in Settings before requesting another draft;
Elixir does not automatically repeat it. The daily use limit is not a dollar cap.
The use record counts attempts; an unknown result is not confirmation of
a provider charge. Review your provider's usage record for billing.
The worker checks for an existing reply before starting a request. A missing
reply or claim is confirmed separately from denied access; a denied read of
an existing object still fails without starting another model call.

## The inactivity clock

When the clan turns on **Suggest removals**, a member's days since their
last battle run a clock: **getting quiet**, then **at risk**, then a
removal action once they have stayed at risk for the days the clan set.
The leader, co-leaders, members on a hold and, unless the clan allows
it, Elders stop at at risk and are never put up for removal. When the
record cannot see a member's battles, the clock waits.

Two things pause it:

- **A hold**, set by the leader or a co-leader on a member who said they
  will be away. Silence is not a hold.
- **An away notice**, set by the member under **Away**, up to the number
  of days the clan allows. Leaders see it beside the member's name. It
  waits until the member's player is verified.

## Who sees what

**Actions** lists what is waiting for you and what closed in the last
30 days. You see the actions that are yours, by your name or by your
role, and no others: another's action number answers that there is no
such action. **Nobody below co-leader ever sees a removal action or who
is on the clock.** The leader and co-leaders also have **History**,
every action the clan has had with its outcome, and the holds.

You need a verified player to decide or comment; until then you can
read your own actions.

## The morning email

**Clan actions waiting** comes from Elixir in the morning, after the
clan is read, when something new became yours to do: everything waiting
for you, newest first, and a link straight to it. It goes only to the
account that verified the player, only while that player is in the
clan, and at most once a day per clan. Turn it off on
[Profile ▸ Email](/console/account/profile/email)
([Turn an email off](/docs/turn-an-email-off)).


Verified leaders and co-leaders can open a declined Action from **Closed** or
**History** and choose **Reopen action**. It returns the same numbered Action
to Open, keeping the original decline in its log and retaining any parts
already marked sent. Completed, withdrawn and fully delivered Actions cannot
be reopened. Reopening keeps the original evidence and does not send a message.

New award updates use compact game copy; as-of times and coverage remain in
the app for review. Each ordered part fits the existing Clan Leader Message
fields. Review and edit the words you actually send before marking that part
sent; saved receipts and older frozen suggestions retain their original words.
