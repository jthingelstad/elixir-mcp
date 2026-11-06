---
slug: clan-discord
title: "The clan's activity in Discord"
description: "How Clan edits the clan's recorded activity into posts for its Discord, and what it never posts."
section: clan
order: 13
navTitle: "The clan's activity in Discord"
icon: message-circle
lede: "How the clan's recorded activity reaches its Discord."
guide: clan-policy
---

# The clan's activity in Discord

## The clan's activity in Discord

**Run › Discord**, for the leader and co-leaders,
with or without a policy, shows the activity channel, what is posted and its
voice as current-state rows. **Manage** opens each editor; closing discards
unsaved text. Leaders connect a webhook of its own: not the one Actions go to, and not
a person's [timeline cross-post](/docs/timeline). From then on the
channel tells what happens in the clan, as its members read it. It is an
editor, not a copy of the timeline: Elixir gathers what one moment
produced into one story and writes it as a sentence or two, with no
time and no link, for example "Ada moved up to Magic Academy with a 3-0
win over keyluis and set a new best of 12,005 trophies, joining Bo
there. Their Hog Rider cycle deck is 9-2 on ladder this season." A story
told more than three hours late says when in words ("Yesterday").

- **What makes a story**: one member's one battle (the arena it moved
  them into, the new best it set, the league it promoted them to, all in
  one post); the same kind of milestone reached by several members at
  once (up to five, one post naming each); a standout sitting, one post
  that grows; and anything else on its own. From the record Elixir adds
  what it knows: the deck the battle was won with and its record in that
  mode this season (ladder or Ranked), a second promotion in a day, the
  clanmates already in the arena a member reached (also when the roster
  saw the move before its battle arrived), and for a sitting its modes,
  its best win and its run.
- **One sitting, one post a day**: a member's sitting (battles less
  than half an hour apart) is told once a day. A new story from a battle
  or a sitting the channel already posted about that member today, and
  from before that post went up, is part of it: the post is edited to
  tell it too when it is under two hours old and one of the channel's
  three newest, otherwise the story is skipped. A member's second
  sitting in a day is skipped the same way, once anything from an
  earlier sitting (a move, a best, a league or the sitting) was posted. A promotion or a new best
  from a later battle is still its own post.
- **Skipped, with the reason**: a badge or mastery level-up below its
  top level (the top level and a new badge are told); a story already
  posted that only grew (a sitting with more battles but the same best
  win and its run not five longer); and something already told (the same
  member's same battle, or the same arena, league, trophy rung or
  milestone reached again within a week); and what is already told
  today (the same sitting as an earlier post about the member). Each
  skip is listed on the page with its reason.
- **Held a few minutes**: a story is posted once nothing has been added
  to it for four minutes, or ten minutes after it began, so what one
  battle produced arrives as one post: usually about six minutes after
  the activity lands in Elixir, at most about a quarter of an hour. A
  post is edited in place only when its story truly grows (a sitting's
  new best win, its run five longer), never posted twice.

- **What is posted**: three groups a leader switches. **Members**: who
  joins and who departs, and role changes made in the game. **Milestones**:
  members' standout sessions, badges, arenas, ranked promotions, new
  bests, collection levels, career wins and card unlocks, and the clan's
  awards. **Clan Wars**: the week's bracket, the boat crossing the finish
  line and how the week finished.
- **The policy decides the defaults**: Members and Milestones are on;
  Clan Wars is on when the policy says the clan takes part, and off until
  a leader turns it on when the policy does not say. When the policy says
  the clan does not take part, Clan Wars cannot be turned on. A leader's
  switch holds until a leader sets it back to the policy's default.
  Without a policy nothing is posted.
- **A departure** is posted as the roster sees it: the member departed.
  When a leader says which it was on the departure's action, that same
  message is edited to say the member was removed, or left on their own;
  it is never a second post, and a kick is never told as a leave.
- **When**: posting starts when the webhook is connected (or turned back
  on); nothing earlier is posted. Each story goes out a few minutes after
  the activity lands in Elixir, never on a schedule. Nothing pings
  anyone; items only the leaders may see are never posted.
- **Edited by the clan's own model**: with the clan's own model key
  set, a leader can have the clan's model edit the channel in the clan's
  voice (**How our messages sound** in Run › Model & voice, described in [Clan settings](/docs/clan-settings#clan-settings);
  the page shows it and links there). Its posts are made without
  anyone reading them first. The model is handed a run's stories, up to
  12, each with Elixir's own words for it, and the clan (its name,
  recruiting words, goals, member count and last war weeks), the
  moment's own facts (the battle and who it beat, the badge, the best
  set, the week's place) and, for a member, what Elixir records about
  them: trophies, best, arena, career wins, collection level, time in
  the clan and any earlier stint, recent war weeks as decks and points,
  the clan's awards they hold as announced this season and last, their
  last three moments from the past two weeks while the channel posts
  Milestones (never the one being posted; for up to eight members in
  one run), how often the channel already told about them this week,
  and the channel's own words in its last three posts about them
  today. A departure's story is told only the member's time in the clan
  and the weeks they played. Never a tag, a member's share of fame, an
  award not yet announced, or anything private to Clan.
  Before it answers, the model may look things up in the clan's record,
  read-only, in up to two rounds of at most six lookups each, a member
  found by name (a name two current members share is not looked up): a
  current member's record as above; a current member's battles in the last
  seven days (up to ten: the mode, the result and crowns, the opponent,
  the deck's archetype, the trophy change and roughly when, in words);
  and what the channel posted in the last three days. Then it edits: it
  may tell several stories in one post, skip a story with a short reason
  (shown on the page), and tells the rest in one to three sentences. A
  departure is never skipped and never told with another story, and
  neither is a post being edited in place.
  A departure keeps Elixir's sentence for it word for word (departed,
  was removed, left on their own); the model may add only a thank-you
  or a farewell in English, never a reason or anything else.
  A post that drops or changes a member's or opponent's name, carries a
  number or a name it was neither given nor looked up, says a time of
  day, leaves out when a story over three hours late happened ("earlier
  today", "yesterday"), changes a departure's sentence or adds more than a thank-you or a farewell to it, tells a
  story another post already told, carries a link or a mention, or runs
  past 600 characters is refused, and its stories are Elixir's own. So is every
  story the model leaves out, and every story when the model cannot be
  used or has not answered in time. At most 50 editor runs a day (a run
  is one to three requests: its lookups, then its answer), counted
  apart from the leaders' drafts and shown in the key's use log with
  each request; the clan's monthly cap, when set, stops them as it stops
  drafts. What a run costs is on [Limits](/docs/limits).
  **Preview the last 5 in the clan's voice** hands the five newest
  stories the channel could post from the last week to the editor, in
  the clan's saved voice, and shows what it would do: each post with
  the stories it tells and Elixir's versions of them, each skip with its
  reason, and each story kept in Elixir's words with why when the model's
  post or skip was refused. It is one request with no lookups, so a
  real run may say more. It posts nothing and counts as one of the
  leaders' drafts for the day.
  Without a key, the page points to Run › **Model & voice**.
- Connecting posts a short hello to check the webhook; it is kept
  encrypted and shown only shortened. A webhook may end in `?thread_id=`
  and a thread's id, to post into one thread; a forum channel's webhook
  is refused, since a forum takes threads, not messages. If Discord stops
  taking it, posting turns off and the page says why. If Discord refuses
  one post, only that post is skipped and the page shows what Discord
  said. Posts go at most about 25 a minute, under Discord's limit for a
  channel. Pausing or disconnecting leaves the messages already posted.
- The page lists the channel's last 40 deliveries and skips from the
  past 30 days, each post whole as it was posted, with any the clan's
  model wrote marked **by the clan's model**, and each skip with what it would
  have said and why it was skipped, by Elixir's rule or by the clan's
  model. It also counts the posts not
  delivered; a skip is not one of them.
- A leader or co-leader can rate each post that reached the channel with
  👍 or 👎, and a note if they like. Elixir cannot see the clan's channel,
  so this is how it learns which posts read well there: the rating goes
  to Elixir as feedback about that post from the leader's own account,
  and each leader sees only their own.
