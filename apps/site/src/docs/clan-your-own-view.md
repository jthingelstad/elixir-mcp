---
slug: clan-your-own-view
title: "Your own view"
description: "The view every clan member has of their own standing, activity and role in Clan."
section: clan
order: 14
navTitle: "Your own view"
icon: eye
lede: "What a member sees about themselves in Clan."
guide: clan-policy
---

# Your own view

## Your own view

What you connect to Elixir as yourself (your own `/mcp` connection,
Claude or another assistant signed in as you) can read your own view of
your clan with `clans_my_view`. It is on for every person and has no
switch. It reads exactly three things:

- **The policy summary:** whether the leaders have saved a policy, its
  revision, whether it is active (ten members or more), and which parts
  are switched on.
- **Your own standing line:** the line Clan shows you under **You
  here**: your status, what counted, the next step, your minimums and,
  when removal is on, your own inactivity state (at risk, never more).
- **The Actions waiting for you,** as the lines Clan's Actions list
  shows: number, type, label, the member it is about and when it was
  raised, each with a link to open it in Clan. An Action Clan has not
  numbered yet has no number and links to the Actions list.

It never shows another member's line, clock, hold or note; never a
removal Action, to anyone, a leader who would decide it included; never
an Action's evidence, log or comments; and it never decides anything.
Deciding happens in Clan. A leader's or co-leader's answer always says
that some Actions are shown only in Clan, whether or not any are
waiting.

The read needs a player you have verified on your account who is a
current member of the clan; a claim that is not verified gets nothing.
With two verified players in one clan, it reads as the one with the
higher role in the game. With no clan named it reads your primary
player's clan. An agent or an integration never reads it: it is yours,
not something you grant.

Standing and Actions come from Clan's last evaluation of the clan
(`standing.evaluated_at`); Clan's own page reads live, so it can be
newer. When there is nothing to show, `reason` says why: `no_policy`
(no policy saved), `too_few_members` (under ten), or `not_evaluated`
(Clan has not evaluated the clan under its current policy for your
player yet); the policy summary is always there.
