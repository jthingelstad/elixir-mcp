---
slug: clan-settings
title: "Clan settings"
description: "Clan settings: the clan's Discord, its model key and spend cap, and what else leaders set apart from the policy."
section: clan
order: 12
navTitle: "Clan settings"
icon: settings
lede: "The clan's own settings, apart from its policy."
guide: clan-policy
---

# Clan settings

## Clan settings

**Run › Clan settings**, **Run › Discord** and **Run › Model & voice** hold
what belongs to the whole clan, with or without a policy, and each setting
saves on its own. Only the leader and co-leaders open Run; a member who
follows an old link to it lands on [Standing](/docs/standing), or the roster
when the clan has no policy yet:

- **What Clan records in Elixir**: the kinds of facts shared
  with Elixir, when each is shared and who sees it there. Kicks and
  leaves, promotions and demotions, awards, messages to the clan and
  where the award races stand go to everyone verified in the clan; kicks,
  leaves and the award races also to the clan's agent; a member's away
  only to the leaders.
- **Member map**: the clan map, where members add a city or region and see
  each other's local time. Only the clan's members with a verified player here see it, and
  it stays out of the game record. Only the leader and co-leaders can change
  whether the member map is on. The clan's activity
  channel is under **Run › Discord** ([The
  clan's activity in Discord](/docs/clan-discord#the-clans-activity-in-discord)).
- **Actions in Discord**: a webhook from one of the clan's Discord channels.
  Each open action leaders or elders can take is posted there and
  marked when it closes ([Actions in the clan's
  Discord](/docs/clan-actions-delivery#actions-in-the-clans-discord)). Connecting
  it posts a short message to check it; the address is kept encrypted
  and never shown again. Only the leader and co-leaders can connect,
  replace or remove it.
- **Clan model**: an Anthropic key of the clan's own, which
  lets a model draft the recruiting pitch in Recruit and, on an open
  action, the reviewed message (clan chat or a Clan Leader Message) for a promotion, demotion, awards
  announcement or policy-change announcement, plus welcome and post-decision
  removal chat lines, plus a departure message after a leader confirms
  Kicked or Left. Saved recruiting words say what the clan is about,
  and **How our messages sound** (below) how it sounds. The
  model is told what Elixir records about the clan, the Action and the
  member it is about, by name ([what it
  receives](/docs/clan-actions#the-words-to-send)), with what the leader
  asks for in **What should it say?** as written; tags, notes saved on
  an Action (anyone's), holds, a removal's rationale or inactivity
  numbers and a member's share of fame are never sent. Chat
  drafts use fixed tone choices for welcomes, removals and farewells.
  Everything it writes is a draft a leader edits and copies into the
  game, marked where it carries a number or a name it was not given. It
  never makes or completes a decision.
  Clan chooses the model for each use, and **Model & voice** shows which:
  Claude Opus 5.5 drafts the recruiting pitch and the messages on
  Actions, and Claude Sonnet 5.5 edits the activity channel.
  When the key cannot reach that model, the use takes the other of the
  two, then Claude Haiku 5.5; it never falls back to an older model, and
  a key that reaches none of the three is not accepted. Which models the
  key reaches is checked with Anthropic when the key is added and again
  about once a day when a leader opens the model editor. The key and its monthly
  cap are the leaders' choice; the model is not.
  Settings shows each use's tokens and about what it cost, and the
  month's total: the tokens at Anthropic's list prices (the date is on
  the page), an estimate rather than the bill. The leader or a co-leader
  may set a monthly cap in dollars. Once the month's (UTC) estimate
  reaches it, the model drafts nothing more until a leader raises or
  removes the cap or the month turns; a draft that starts under the cap
  may finish a little over it. The cap stays when the key is replaced.
  It is Clan's own stop: a spend limit on the Anthropic account
  is the one Anthropic keeps.
  The one use nobody reviews is the activity channel's editor, when a
  leader turns it on (below); its runs are counted apart, and the cap
  stops them too. A use whose answer never arrived (the provider may
  still have charged for it) is counted toward the cap at its estimate.
- **How our messages sound**: the clan's voice, in its leaders' own
  words (2026-10-20). The clan's model gets it as written both when it
  drafts a message on an Action and when it edits the [activity
  channel](/docs/clan-discord#the-clans-activity-in-discord). It sets the tone and the
  wording, never the facts: what a draft or a post may say, and what is
  never sent, stay as they are, and a voice never lifts a rule. At most
  400 characters in one paragraph, with no links or mentions; a longer
  one is refused, never cut. Empty means none. Only the leader and
  co-leaders read or change it. Until 2026-10-20 the activity channel
  kept a voice of its own; that voice became this one.
