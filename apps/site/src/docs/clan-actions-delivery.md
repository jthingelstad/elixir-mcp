---
slug: clan-actions-delivery
title: "Actions by email and Discord"
description: "The leaders' morning email and Actions posted to the clan's Discord: what each holds and who sees it."
section: clan
order: 7
navTitle: "Actions by email and Discord"
icon: send
lede: "Where leaders hear about open Actions outside Clan: the morning email and the clan's Discord."
guide: clan-actions
---

# Actions by email and Discord

## The morning email

**Clan actions waiting** comes from Elixir in the morning, after the
clan is read, when something new became yours to do: everything waiting
for you, newest first, each with a line saying why it is waiting and a link
straight to it. The subject leads with the action, and the number Discord uses
stays out of the mail. It goes only to the
account that verified the player, only while that player is in the
clan, and at most once a day per clan. Turn it off on
[Settings › Emails](/settings/emails)
([Turn an email off](/docs/turn-an-email-off)).

## Actions in the clan's Discord

The leader or a co-leader can connect a Discord webhook under
**Run › Discord** ([Clan settings](/docs/clan-settings#clan-settings)).
From then on, every open action that leaders or elders can take is posted
to that channel as one message: its number, what it is and who it is
about, and a link to it here. When someone completes or declines it,
the same message is edited to say so and by whom; when Clan withdraws it,
the message says that. A declined action that is reopened reads as open
again.

- The channel only receives. An action is decided here, in Clan, never
  from Discord; whether a leader may one day act from Discord (deciding an
  action, a member marking themselves away) is deliberately left open
  while we learn what clans do there. Clan does not answer questions in
  Discord either: conversation is the [Discord bot](/family/discord)'s,
  which a clan runs on its own keys.
- Actions already open when the webhook is connected are posted too; one
  that closes before it was ever posted is not.
- A member's own **Going to be away?** prompt is never posted.
- Messages name the member, removals included, so use a channel only the
  clan's leaders can read. The link opens the action only for someone
  signed in who could see it here.
- Messages go out as Clan works: after a visit that raises or decides an
  action, after the morning read, and a minute after each batch, so a
  close is edited within minutes. They go in action number order, up to
  ten at a time, spaced under Discord's limit for a channel; a long
  backlog arrives over a few minutes.
- Nothing pings anyone unless the leader or a co-leader names one Discord
  role to mention (Settings, by the role's id). That role, and only it, is
  mentioned when an action is first posted; an edit never mentions
  anyone. Connecting a different webhook clears the role, since it may
  be another server's channel.
- A forum channel's webhook works: each action becomes a forum post of its
  own, named for it, and its close is edited in that post. A webhook
  ending in `?thread_id=` posts every action into that one thread.
- Settings lists the last deliveries: posted, edited, refused (with what
  Discord said), and those Discord never answered, which may be in the
  channel and are never sent again (a duplicate is worse than a missing
  message). It counts what did not arrive in the last 30 days. When
  Discord refuses one action's message, only that one is skipped.
- A leader or co-leader can rate each delivered message with 👍 or 👎,
  and a note if they like: feedback to Elixir about that message from
  their own account (Elixir cannot see the channel), and each sees only
  their own.
- Until a webhook is connected, **Today** suggests one to the
  leader and co-leaders. If Discord stops taking it (the webhook was
  deleted, say), posting stops and **Run › Discord** and **Today** say so.
