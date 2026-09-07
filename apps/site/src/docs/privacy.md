---
slug: privacy
title: "Privacy"
navTitle: "Privacy"
description: "What Elixir MCP stores, why, and what it never stores: public Clash Royale game data plus history, your email address and what we use it for, and no identifiers in analytics."
order: 4
---

# Privacy

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

**Website analytics.** The site uses Tinylytics, a small
privacy-focused analytics service, to count visits anonymously: page
hits, visitor country, and product events such as "a tool call
happened" or "feedback was filed". No cookies, no personal
identifiers, no cross-site tracking — event values carry tool names
and categories only, never your data. The service also counts a few of
its own events server-side (how many MCP calls happened) with no
account attached. The sign-in page loads no analytics at all.

**The newsletter.** Opt in under Account and we add your address to the
Elixir MCP mailing list for occasional product updates. It is off
unless you choose it — signing in does not enroll you. The list is
hosted at Buttondown, which processes your address on our behalf.
Every issue carries an unsubscribe link, unsubscribing is honored
permanently — the service never re-subscribes an address that opted out
— and newsletter email carries no tracking pixels. Sign-in codes and
account notices are service mail and arrive whatever you choose here.

**Running a collector.** If you volunteer a machine for the fleet, its
Clash Royale card name, status, and fetch counts are public, and it is
credited publicly to your primary claimed player name and tag. The name
you give your own machine is not published — it stays between you and
the maintainer — and neither is your IP address.

**What we never do.** No selling data, no advertising, no ad or
cross-site tracking, no analytics attached to your gameplay or your
identity. Feedback you send is read by the maintainer and used to
improve the product.

**Retention.** Recorded game history is kept indefinitely (it is the
product). Raw API payloads are archived. Operational logs are pruned
periodically. Your email address is kept for as long as the account
exists, and goes when it goes. To remove your account, your address,
and your claims, use the feedback form or email the maintainer;
recorded public game data about the clan remains, as it would in any
clanmate's battle log.
