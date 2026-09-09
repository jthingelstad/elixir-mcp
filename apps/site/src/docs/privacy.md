---
slug: privacy
title: "Privacy"
navTitle: "Privacy"
description: "What Elixir MCP stores, why, and what it never stores: public Clash Royale game data plus history, your email address and what we use it for, and anonymous analytics with no account attached."
order: 60
section: policies
---

# Privacy

**What this is.** Elixir MCP is a private beta, run by one person, with
every account approved by hand. It is not a commercial product: nothing
here is sold, there is no advertising, and there is no revenue. Public
Clash Royale data is already published broadly by third-party sites, so
the record kept here is not a new kind of exposure — but it is a
genuine one, and the rest of this page describes it plainly. If this
ever opens to general signup, the questions that come with that —
lawful basis, data-subject rights, how children are handled — get
answered before it does, not after.

**What we store.** Game data from the public Clash Royale API: battles,
profiles, clan rosters, war standings. All of it is publicly queryable
by anyone with a tag and an API key.

We store two things about your email address. A one-way hash is your
account's identity — it is what a sign-in looks you up by, and it is
the only thing older parts of the system ever see. We also keep the
address itself, so we can actually send you the mail the service
promises: your sign-in codes and links, and notices about your own
account. An account we cannot write to is an account we can never tell
anything. The address is never a lookup key, never appears on a public
surface, and is never sold, shared, or used to advertise. We also store
your timezone if you set one, and operational records of your own
activity: sign-ins, claims, recording changes, and your agent's tool
calls (used for quotas and product improvement — you can see your own
usage under Account > Usage).

**Who can see what.** All recorded game data — battles, profiles,
clans, war — is readable by every approved account, the same way the
game's own public API serves it to anyone with a key. Every individual
observation was public when we collected it, and nothing here is
visible that the game itself does not publish today. Be aware of what
is genuinely different, though: the official API answers about the
present and a short recent window, while we keep what we saw and make
it searchable over time. A season of somebody's battles, read in one
query, is a capability the game's own API does not offer, and any
approved account can run it. Your account data — claims, watches,
quotas, usage, feedback — is yours alone.

**Website analytics.** Every page — the public ones and the signed-in
application both — uses [Tinylytics](https://tinylytics.app), a small
privacy-focused analytics service, to count visits anonymously: page
hits and visitor country. No cookies, no cross-site tracking, and **no
account is ever attached to a view**. We cannot tell from analytics who
was signed in, and we do not try.

The sign-in page is the one deliberate exception and loads no analytics
at all, because a magic sign-in link arrives as part of that URL and a
live credential should not travel anywhere it does not have to.

What a page view records is the page: `/explore/player`, `/data/status`,
`/account`. Where a page is about a specific record, the Clash Royale
tag rides along as an ordinary attribute of the view. Those tags are
public game identifiers — the same ones printed in the game and served
by Supercell's own API to anyone with a key — not personal information,
and they are not treated as such here.

Product events such as "a tool call happened" or "feedback was filed"
are counted server-side, again with **no account attached** — the values
carry tool names and categories only, never your data, and never who
made the call.

**The newsletter, and why it is opt-out.** Elixir MCP is a private beta
and every account is approved by hand. Taking part includes occasional
product email — what changed, what broke, what is coming — so signing
in adds your address to the mailing list. That is a deliberate choice
rather than an oversight, and this paragraph exists so it is not a
surprise.

**You can leave at any time.** Every issue carries an unsubscribe link.
Unsubscribing is permanent and is never overridden: once an address has
told Buttondown to stop, nothing here re-subscribes it, including a
later sign-in. The list is hosted at Buttondown, which processes your
address on our behalf, and newsletter email carries no tracking pixels.
Sign-in codes and account notices are service mail and arrive whatever
you do with the newsletter.

**Running a collector.** If you volunteer a machine for the fleet, its
Clash Royale card name, status, and fetch counts are public, and it is
credited publicly to your primary claimed player name and tag. The name
you give your own machine is not published — it stays between you and
the maintainer — and neither is your IP address.

**Where your connections come from.** When a credential of yours is used
— an agent's key, or an AI client you signed in — we record the calling
IP address and the country the request came from, alongside which
credential was used and what the client calls itself. This is yours to
see, on your own account pages, and it exists because an account can
hold several agents and several connected tools: without it, five
agents are five identical rows saying something made a call.

The same is recorded when a credential is REFUSED, which is the case
that matters most. A key you revoked but that something is still
presenting is invisible otherwise, because a rejected call never
becomes usage — and that silence is exactly what a leaked or forgotten
credential looks like. Refusals are counted per credential, per source,
per day rather than logged one by one.

Addresses are removed after 30 days; the usage history stays without
them. Nothing here is shared, and it is never used to profile you, only
to answer "what is using this, and from where".

**What we never do.** No selling data, no advertising, no ad or
cross-site tracking, no analytics attached to your gameplay or your
identity. Feedback you send is read by the maintainer and used to
improve the product.

**Retention.** Recorded game history is kept indefinitely (it is the
product). Raw API payloads are archived. Operational logs are pruned
periodically. Connection IP addresses are cleared after 30 days and
refusal records deleted after 30 days, both by the housekeeping job; the
arguments of your tool calls are cleared from the call log after 90 days
and the calls themselves stay; event-feed rows go after 30 days;
integration usage counters after 90 days. The full table is on
[Limits](/docs/limits). Your email address is kept for as long as the account
exists, and goes when it goes. To remove your account, your address,
and your claims, use the feedback form or email the maintainer;
recorded public game data about the clan remains, as it would in any
clanmate's battle log.
