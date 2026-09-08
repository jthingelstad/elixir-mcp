---
slug: privacy
title: "Privacy"
navTitle: "Privacy"
description: "What Elixir MCP stores, why, and what it never stores: public Clash Royale game data plus history, your email address and what we use it for, and no identifiers in analytics."
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

**Website analytics.** The public pages — the home page, the
documentation, updates and the changelog — use Tinylytics, a small
privacy-focused analytics service, to count visits anonymously: page
hits and visitor country. No cookies, no personal identifiers, no
cross-site tracking.

**The signed-in application still loads no analytics script.** Nothing
third-party runs inside your session — deliberately, because such a
script would execute on your account and admin pages with your own
authority. The app instead reports which *section* you viewed to our
own server, which relays a count: `/account`, `/explore`, `/data` and
so on. Never the full path — a player tag or a clan you were looking at
never leaves as part of a page view — and **no account is attached**.

Product events such as "a tool call happened" or "feedback was filed"
are counted server-side, with **no account attached** — the values
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
