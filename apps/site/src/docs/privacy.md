---
slug: privacy
title: "Privacy"
description: "What Elixir MCP stores and why, in four buckets: public Clash Royale game data and its history; your own account's records, shown to you in full; aggregate measurement with no account attached; and sponsorship that buys nothing."
section: policy
order: 31
navTitle: "Privacy"
icon: eye-off
lede: "What is public-postured, what is private, and what is never stored."
---

# Privacy

**What this is.** Elixir MCP is a private beta, run by one person, with
every account approved by hand. It is free: nothing here is sold, there
is no advertising, and the only money is voluntary
[sponsorship](/support) that buys nothing. Public Clash Royale data is
already published broadly by third-party sites, so the record kept here
is not a new kind of exposure — but it is a genuine one, and the rest of
this page describes it plainly. If this ever opens to general signup,
the questions that come with that — lawful basis, data-subject rights,
how children are handled — get answered before it does, not after.

Everything below sorts into four buckets, and the distinction between
the second and the third is the one that matters: **your account's own
records** are kept per account, because the product is made of them,
and every one of them is shown to you; **measurement** is aggregate,
per page and per mail, and never knows who you are.

**1. Game data.** Game data from the public Clash Royale API: battles,
profiles, clan rosters, war standings. All of it is publicly queryable
by anyone with a tag and an API key. No sponsor owns any part of the
record.

Beside it, and never mixed into it, are **attested facts**: what a
person did in a clan through one of the Elixir family's own apps (a
leader saying a departure was a kick or a leave, a promotion made, the
clan's own award, a member saying they are away, a message sent to the
clan), or what a family app's own game produced for a player (a personal
best in Elixir Drop). Each says who said it, in which app, and when, and
is shown only to the people its kind allows: the clan's verified members,
and for a departure's kind or an away only its leaders; an agent never
sees those. What a clan shares is the clan's choice, made in the app.
See [attested facts](/docs/integrations#attested-facts).

**2. Your account.** We store two things about your email address. A one-way hash is your
account's identity — it is what a sign-in looks you up by, and it is
the only thing older parts of the system ever see. We also keep the
address itself, so we can actually send you the mail the service
promises: your sign-in codes and links, and notices about your own
account. An account we cannot write to is an account we can never tell
anything. The address is never a lookup key, never appears on a public
surface, and is never sold, shared, or used to advertise. It is released
to one kind of client only: an app of the Elixir family itself (Elixir
Clan, Elixir Drop) that you sign in to with Elixir, when you approve its
request to know your address. No other client is ever granted it — no
MCP client, no agent, no integration
([Protocol](/docs/protocol#signing-a-person-in-with-elixir)). We also store
your timezone if you set one, and the records of your own activity
that the product is made of: sign-ins, claims, recording changes, your
agent's tool calls, every email we sent you, and the feedback you filed.
They are used for quotas, for debugging, for answering your reports and
for deciding what to build — and every one of them is yours to see, in
full, under Activity and Usage: each request id opens the call record
(request and response kept 90 days), each email opens the mail as it
was sent. Identifiers from these records — a request id, an email's id,
a player tag — appear wherever the product needs them, including in
links inside the mail we send you; they point at records you can
already open, and they are not tracking identifiers. Nothing in this
bucket is shared, sold, or used to target you with anything.

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

**3. Measurement.** Every page — the public ones and the signed-in
application both — and every mail we send uses
[Tinylytics](https://tinylytics.app), a small privacy-focused analytics
service hosted in Europe, to count in aggregate: page hits and visitor
country, opens per mail issue, clicks per campaign. No cookies, no
cross-site tracking, **no account is ever attached to a view, and no
open or click is ever attributed to a recipient**. We cannot tell from
measurement who was signed in or who opened what, and we do not try.

The sign-in page is the one deliberate exception: it loads no analytics
script, and the view itself is never recorded, because a magic sign-in
link arrives as part of that URL and a live credential should not travel
anywhere it does not have to.

What a page view records is the page: `/explore/player`, `/status/service`,
`/account/activity/e`. Where a page is about one player or clan, the
Clash Royale tag rides along as an ordinary attribute of the view (a
public game identifier, not personal information). Where a page is one
of your own records — a call, an email — the view reports the kind of
page and not which record, so the report reads as pages rather than a
thousand one-hit rows; that is report hygiene, and the promise above is
what it rests on.

The signed-in console also sends two kinds of event to the same
Tinylytics site, so a broken or slow page is visible without anyone
reporting it: a **browser error** (the error's name and the kind of page
it happened on) and a **slow or failed request** (a timeout, a network
failure, a malformed answer, or a request that took longer than a few
seconds, named by the kind of page or the API route with every id
collapsed). Neither carries a record id, a tag, a token or anything
about who you are.

Nothing is sent to Tinylytics from Elixir's servers. Tool calls,
sign-ins and feedback stay in Elixir's own records; the only
measurement is the page and mail counting above.

**4. Money.** Elixir is free and stays free. It is supported by
voluntary [GitHub sponsorship](/support) that buys nothing — no quota,
no retention, no features, no priority, no different treatment — as
Supercell's Fan Content Policy requires of donations. The ask is the
same for everyone: the Support page, the console's top bar, and a line
in every product email's footer. Nothing about your account or what
you do decides whether or how you are asked, and there is no list of
who gave.

**The newsletter, and why it is opt-out.** Elixir MCP is a private beta
and every account is approved by hand. Taking part includes occasional
product email — what changed, what broke, what is coming — so signing
in adds your address to the mailing list. That is a deliberate choice
rather than an oversight, and this paragraph exists so it is not a
surprise.

**The reports, and the milestone note.** Elixir also sends eight kinds of
mail ([Email](/docs/email)): six weekly mails (four reports and two
written pieces), a congratulations when something you did is a first,
and, for the Elixir family's app Elixir Clan, a note when something in
your clan is yours to do (the app writes it and names your player;
Elixir sends it, so your address never reaches the app). They
are on by default for the same reason the newsletter is, each is its
own switch on your account page, and every issue carries a one-click
off for its kind. Turning one off is recorded on your account and never
overridden. The reports are built by programs from the same readers the
tools use; the Top 100 and Card of the Week are written by a language
model from a brief a program built, and the program checks every number
before it sends.
Every mail Elixir sends, sign-in codes included, carries a Tinylytics
pixel and campaign-tagged links: an open and a click are counted against
the MAIL (which kind, which issue), never against you. Every product
email also carries its own id in the footer and links into your own
account's record of it; that is bucket two, not measurement. What the
counting can and cannot tell us is on [Email](/docs/email).

**You can leave at any time.** Every newsletter issue carries an unsubscribe link.
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

Signing in to the console records the same for each browser session: a
short client label ("Safari on iPhone", never the raw user agent), the
IP address and the country, shown to you in your Profile's list of
signed-in devices.

The same is recorded when a credential is REFUSED, which is the case
that matters most. A key you revoked but that something is still
presenting is invisible otherwise, because a rejected call never
becomes usage — and that silence is exactly what a leaked or forgotten
credential looks like. Refusals are counted per credential, per source,
per day rather than logged one by one.

Addresses are removed after 30 days, a connection's and a console
session's alike; the usage history stays without them. Nothing here is shared, and it is never used to profile you, only
to answer "what is using this, and from where".

**What we never do.** No advertising and no ad or retargeting scripts;
no data brokers; no selling or sharing of anything here. No
per-recipient open or click tracking, no engagement scoring, and no
automation that acts on whether you read your mail. No use of game data
to target an individual with anything commercial. Sponsorship is never
tied to anything about your account. Feedback you send is read by the
maintainer and used to improve the product, and nothing else.

**Retention.** Recorded game history is kept indefinitely (it is the
product). Raw API payloads are archived. Operational logs are pruned
periodically. Connection and console-session IP addresses are cleared
after 30 days and refusal records deleted after 30 days, all by the
housekeeping job; the
arguments of your tool calls are cleared from the call log after 90 days
and the calls themselves stay. The timeline's game-moment ledger is kept
with recorded game history; a timeline read covers at most 30 days, which
is a delivery window rather than a deletion policy. Integration usage
counters go after 90 days. The full table is on
[Limits](/docs/limits). Your email address is kept for as long as the account
exists, and goes when it goes. To remove your account, your address,
and your claims, use the feedback form or email the maintainer;
recorded public game data about the clan remains, as it would in any
clanmate's battle log.
