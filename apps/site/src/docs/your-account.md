---
slug: your-account
title: "Your account"
description: "Your Elixir account: creating an account, signing in with an emailed code or link, how long a sign-in lasts, your primary player and the others you follow, installing Elixir on your phone, your time zone, your role, the feedback you send and its answers, what members see of you, what stays private, and how to have the account removed."
section: start
order: 3
navTitle: "Your account"
icon: user-round
lede: "One account, opened by verifying your email, signed in with an email and no password. It holds your players, your time zone and your limits, and it shows nobody your address."
reviewed: "2026-11-12 against contract 11.21.0 for What members see's Location and follow slots; 2026-10-13 against contract 11.12.0"
callout: ["Open it at Settings › Profile", "/settings/profile", "Open Profile"]
---

# Your account

Everything in Elixir hangs off one account: Home, Stats, Elixir
Clan, the emails and the AI apps you connect all act as the same person. The
account is an email address, the players you follow and a few settings.
There is no password.

The first page you open includes your current sign-in state. Your browser keeps
that state fresh as you use Elixir. If a page cannot check your session,
it says Elixir did not answer so you can retry.

The public pages (home, docs, cards) never ask the server who you are. When
you use the app, your browser keeps a small note on that device: until when
to expect you, and your player's name. It holds no address and no key, and
it is never sent anywhere. The public pages read it so they can show your
player instead of **Sign in**. Signing out on that device removes it, and it
runs out by itself after thirty days. It is only a note: if you were signed
out somewhere else, a public page can still show your name until you next
open the app, which asks you to sign in. A browser that keeps no notes just
shows **Sign in**.

## Create your account

Anyone can create a free ordinary member account at
[/signin?signup](/signin?signup). Enter your email and verify
the code or link we send. The account opens after verification, not when you
submit an address. Repeated submissions do not create extra accounts.
Existing denied or disabled accounts do not reopen through signup, and no
privileged role is granted.

Elixir accounts are for people 13 or older, and the signup form asks.
Answer **No** and nothing is sent or saved. Answer **Yes** and the
account keeps when you said so, beside the account, from the moment you
asked for the email. Plain sign-in does not ask, so it opens no new
account: a code or link from it for an address with no account brings
you back to the signup form, your address still in it, to answer the
question and send a new email. Every way an account opens asks the same
question: the signup form, **Continue with Discord** from the signup
form, and the page an app sends you to.

The signup form has an optional **Your player tag** field; plain sign-in
does not. A malformed tag is refused on the form before any email is sent,
and an empty field is fine. The tag is kept with the request and applied
only after you verify, when a new account claims it as its primary player.
A new account opens on [Home](/home), whose first steps start with adding
your player when it has none. A tag another account has
[verified](/docs/verify#a-verified-player-is-yours-alone) is not added, and
[Players & following](/settings/players) says why.
A tag sent while signing in to an account that already exists is ignored.
Signup and sign-in share the same email limits.

You can also create your account where an app sends you to sign in with
Elixir, as Elixir Drop does: enter your email, then the code, and the
account opens the same way, after verification and as an ordinary member,
with the same product-news box. That page asks for no player tag; add
yours in [Settings › Players & following](/settings/players). An account
opened there reads in UTC until you set a zone in Profile. See
[Sign in with Elixir](/docs/sign-in-with-elixir).

Then add your player in [Settings › Players & following](/settings/players) if
you have not, read your recorded play in [Stats](/home/you/stats), or follow
[Bring your clan](/docs/bring-your-clan).
A collector is not required to join. Running one is open to any account
([Running a collector](/docs/operators)); recording allowances and the fleet's
shared fetch budget are separate from signup.
New signup has a checked “Send me Elixir product news” box; uncheck it before
requesting your sign-in email to skip newsletter enrollment. Signing in to an
existing account preserves its newsletter choice. A new account also starts
on your browser's time zone ([Your time zone](#your-time-zone)). Sign-in and welcome mail
still arrive; reports have separate controls. See [Privacy](/docs/privacy) and
[Emails](/docs/email).

## Signing in

Sign in at [/signin](/signin) with your email. Elixir
sends a link and a six-digit code; either one signs you in, each can be
used once, and both expire after 15 minutes. A code allows five tries.
The link signs in the device you open it on, and the page that asked
for it signs in too: at once when the link is opened from the same
network, and only after you say yes on the link's page when it is
opened from somewhere else.

If a player or clan record, or an email's feedback link, brought you to
sign-in, that screen returns to what you opened after your code or approved
handoff. A link opened in another tab also keeps that context; it does not
take the requesting tab's destination away. Creating an account from a public
battle returns to that battle. Completed sign-in replaces the sign-in step
in history. Back leaves an automatically opened email-feedback form; Forward
returns with the email attached. Reload keeps the record address.

### Signing in with Discord

**Continue with Discord** on the sign-in page signs you in with your
Discord account once it is connected to your Elixir account. Connect it
on **Profile** (**Connect Discord**); Discord asks you to allow Elixir to
know who you are, and the account it shows is the one linked. One Discord
account per Elixir account, and one Elixir account per Discord account;
**Disconnect** under **Settings › Connections & agents** removes it.

With no Discord connected yet, **Continue with Discord** uses the email
address Discord has verified: it signs you in to the Elixir account with
that address, or creates one (with the product news box, time zone and
13-or-older answer from the signup form), and connects the Discord
account to it. From plain sign-in, with no account for that address, it
brings you back to the signup form to answer the question first. An address
Discord has not verified cannot sign you in; sign in with your email,
then connect Discord from Profile. If the account for that address is
already connected to a different Discord account, sign in with your
email.

A connected Discord also tells your clan's Discord agent who you are,
so it never has to ask ([Agents](/docs/agents#knowing-which-human-is-asking)).

A sign-in lasts **thirty days from its last use and ninety days at
most**. **Settings › Sign-ins & devices** (Settings is in
the account menu on the top bar) lists every session that can act
as you, with a sign-out for each and **Sign out everywhere else**, which
keeps the one you are using. Your agents and connected apps are not
sessions; they are under [Connections](/docs/connections).

On the smallest screens, the top bar shows the Elixir logo as the home link
so the product and account controls keep their room. Your full account name
wraps inside its menu. The same controls remain available by keyboard.

On Home, setup you have not finished opens the page as
[Welcome to Elixir](/docs/timeline#welcome-to-elixir) until it is done.
Recording problems are under the bell, **Needs you**.

Signed out, the top bar is the logo, **Docs**, **Sign in** and **Create
account** (on a phone, **Docs** is in the footer instead), and the front page
is the way in: sign in, or create an account.
**Cards**, **Updates** and **Status and data** are in the footer, as public
as they were, and **Play Drop** is in the footer too (and, signed in, in the
account menu).

## The bell

The bell, on the top bar (a tab on a phone), holds what is about you, not
your friends. Each part shows only when it has something:

- **Cheers on your items**: the cheers others gave, in the last seven
  days, to the [timeline](/docs/timeline#cheers) items about players you
  have [verified](/docs/verify) as yours. Counts only, each cheer with its
  number: never who cheered. The bell keeps your week's items for up to
  fifteen minutes while you use Elixir (two hours while you are away),
  so cheers on an item made since can reach the timeline before the bell.
  Cheers on items it already holds show at once.
- **New followers**: accounts that started following one of your verified
  players in the last thirty days. One is named by its own verified
  player's game name and tag, as its [player page](/docs/player-page)
  would name it; one with no verified player is counted, not named. A
  named one has **Follow back**, unless you already follow, watch or own
  that player: it asks first, with what it costs, like every Follow.
- **Needs you**: your clan's Actions waiting on you as a leader, and an old
  key still trying to connect, as before.
- **Answers to your feedback**: each answer the maintainer gave in the last
  thirty days, and any you have not read; it opens the answer in Settings ›
  Feedback.
- **Your account**: what changed on your account in the last seven days,
  such as players and clans added, recording started or stopped, or a
  player another account verified. A burst is one line per kind
  ("Recording started for 24 players"). A line about one player opens
  their page; the rest open Settings. Sign-ins stay in Settings › Sign-ins
  & devices.

A dot shows on the bell while something needs you or something came since
you last opened it. Opening the bell marks reactions, followers and your
account's lines as seen;
an answer stays new until you open it. With no verified player, the bell
says how to verify one. Nothing in the bell is mailed or posted to Discord.

## Elixir on your phone

Elixir installs on a phone's home screen and opens like an app: full
screen, with its own icon, and **Home**, **Find**, **Clan**, **You** and
the bell as tabs at the foot.

- **iPhone or iPad:** open [elixir.poapkings.com](/home) in Safari, tap
  **Share**, then **Add to Home Screen**.
- **Android:** open it in Chrome, open the menu, then **Install app** (or
  **Add to Home screen**).

The installed app opens on Home. It keeps a sign-in of its own, apart
from the browser's, so sign in once inside it: type the code from the
email, or open its link, and the app's sign-in page signs in too, as
[above](#signing-in). On Android, a long press on the icon offers
**Find**, **Stats** and **Clan**. It needs a connection, as the
site does.

## Your players

The players on your account each say who they are to you:

| Relationship | Means | Shows in Players as |
|---|---|---|
| primary | you: what every tool means when no player is named | Your main player |
| alt | also you, under another tag | Also you |
| friend | someone you follow on purpose | under Friends |
| watching | anyone else you added | under Watching |

Your first player is your primary, which the pages call your main player.
**Make main player** on another player's page moves it there, and the old
primary becomes watching. Your primary
cannot be removed while you follow other players: make another one
primary first. Your primary and your alts are the players you can
[prove are yours](/docs/verify), and the ones your own part of the digest and
Clan go by. A player another account has verified cannot be your
primary or an alt; you can still follow it as a friend or watch it. If
another account verifies a player that was your primary or an alt, it
leaves your account, your timeline says so, and an ended primary leaves
you with none: Players says so until you make another player your main
player or add yours. Friends and watched players are covered in
[Follow a friend](/docs/follow-a-friend) and
[Watch any player](/docs/watch-a-player).

Players are added under **Settings › Players & following**, and following a player is
recording it: see [What Elixir records](/docs/recording).

## Your time zone

**Settings › Profile › Time zone** sets the times Elixir
shows, how a date in a question from a connected app resolves, the local
times in tool responses and the days and times your emails name. Storage
stays in UTC; only the reading changes. A new account starts on the time
zone of the browser that asked for its sign-up email, whichever device
opens the link; if that browser gives none, or gives UTC, the account
starts at UTC. Signing in never changes a zone you already have: only
Profile does. An account with no zone reads in UTC, and Home and
Stats say so and offer your browser's zone in one click. A battle's page
reads on your account's clock when you are signed in, and on your
browser's when you are not.

## Your profile image

**Settings › Profile › Profile image** lets you pick one Clash Royale card
as your picture. Search the cards by name, tap one to see it in the circle,
then tap **Save**. **Remove** puts your initials back.

- It shows on the players you've verified, your main player and your
  verified alts: in feeds, on player pages, in Find, in clan lists and on
  shared posts. Anyone who can already see that player sees it.
- A player you haven't verified, or only follow, keeps their initials.
- Haven't verified a player yet? You can still pick one. For now only you
  see it, in your top bar and your account menu.
- It's always the card's own art, never a photo. Tower troops can't be
  picked.

## Your limits

Your limits set how many players and clans you can record and how many
tool calls you can make a day; **Settings › Usage and limits** shows each
limit beside what you use. Leader and Family are earned in the game and read every
time you use Elixir: Leader while one of your verified players leads or
co-leads a clan you follow, Family while a collector you run is active. There
is nothing to ask for, and a role goes when its ground goes; what you already
follow stays. Partner is granted by hand. The roles and their numbers are on
[Roles and limits](/docs/roles#upgrades).

## Feedback

Every part of Elixir takes feedback, and all of it lands in one place:
**Help** on the top bar, on any page once you are signed in; **Send
feedback** at the foot of Clan's pages and on Settings' Feedback page; **Send
feedback about Stats** at the foot of Stats' Season tab; **Report this**
beside a Clan action, Standing and the award races; **Something wrong on this
page?** on every docs page; and **Send feedback** in every product email's
footer. Each
note carries where it was written and what it is about (the page, the
player, the clan action, the call or the email), so you write only what
you think. Sending feedback needs you signed in; without an account,
write to [admin@poapkings.com](mailto:admin@poapkings.com).

Every item is answered, by Elixir's maintainer, sometimes with help
from AI agents. **Settings › Feedback** (linked
from Help) lists what you have sent
with its state and the maintainer's answer, and an item's own page
shows the whole thread: answer an answer with **Reply** and the two
stay linked. Each answer is an item on your [timeline](/docs/timeline),
and a new one comes to your inbox too, ten minutes after it is written,
unless you have already read it on the item's page
([Answers to your feedback](/docs/email)). An agent's feedback is the
agent's: it is answered on the agent's page and timeline, never mailed.

## What members see

[Settings › What members see](/settings/what-members-see) gathers, on one
page, who sees what of you as Elixir works today. Two choices
live on it, **Location** and your follow slots; each other choice it names
links to the page that owns it.

- **Members who are signed in** see your players' games: each player's
  game name, tag, clan, profile, battles, decks and timeline. That is
  public game data, and every member can look up any player Elixir
  records. No page shows them yet that a player is yours, though who an
  account follows, who follows it and its verified player are for members
  to see by Elixir's rule. Two answers say only
  that *some* account is behind a player, never which: making a player
  you verified their own says another account has verified it, and
  following a player you follow can cost them no slot because another
  account followed first. A highlight you post is on that player's
  timeline for every member who follows the player, with the player's
  game name, your words and the battle, not your account; a follower who
  cross-posts their timeline to Discord sends it there too, and a line
  posted there stays if you delete the highlight. A collector you run is credited to your main
  player's game name and tag, on the public status page too. In Clan,
  your clan's verified members see your place on its map if you added
  one, its leaders see an away you mark, and what you decide as a leader
  or elder shows under your player's game name. With Discord connected,
  an AI agent that follows a clan your main player or an alt is in can
  ask which player you are by your Discord user id, and learns that
  player's tag and whether it is verified, never your Discord name or
  your email ([Knowing which human is
  asking](/docs/agents#knowing-which-human-is-asking)).
- **Someone with a link you send** opens it without an account. A
  battle link shows both sides' game names, clans, trophies and decks,
  the towers, how it ended, the left player's other battles in that
  session and earlier battles between the two. A highlight you share
  shows your player's game name and your words over that battle, and its
  picture carries the name, the words and the link; delete the highlight
  and the link stops opening within about a minute ([Highlight a
  battle](/docs/battles#highlight-a-battle)). A link carries the battle's
  or the highlight's id and nothing else: no account id, nickname or
  email.
- **Only you, or nobody else:** the nicknames you give players, your
  email address, your Discord name and profile, and your account's
  machinery: sign-ins, agents and their keys, connections,
  usage, the mail sent to you and your feedback.

**Location** is your place on the clan map: a country, its region and, if
you like, a city, picked from lists, never an address or your device's
location. It needs a verified player. Only the verified members of each
clan your verified player is in see it, on that clan's map, while the
clan's leaders keep the map on; nobody else does, no link carries it, and
no agent or tool reads it. Add it, change it or remove it here or on the
map; it is the same one place.

**Your follow slots** shows the slots in use out of your limit, the same
number every Follow says, the players using one because of you with
**Unfollow** on each you follow, and the free follows apart
([What a player slot costs](/docs/recording#what-a-player-slot-costs)).

Last, a lens: your main player's latest battle drawn by the battle page
for a signed-in member who is not you, and for someone holding the link
with no account.

## What stays private

Your email address is never shown anywhere public. The players on your
account, what each one is to you and the nicknames you give them are
yours: what you connect to Elixir as yourself reads them. No other
member reads your nicknames, and no page shows another member which
players are yours today, but for the lines [What members
see](#what-members-see) lists. So is your own view in Clan (your standing line and
the Actions waiting for you): your own connection reads it, for a
player you have verified, and no agent does
([Your own view](/docs/clan-your-own-view#your-own-view)). The game record
itself (battles, profiles, clans) is public game data, and every
active account can read it. The one public line tied to an account is
a collector's: the public list of collectors names the operator's
primary player.

## Removing the account

There is no delete button. Write to admin@poapkings.com, or send it as
feedback from the website, and the removal is carried out in one
reviewed step. Removing the account deletes the account:

- **your address**, and every way to sign in as you, a connected
  Discord account included;
- **your claims**: the players and clans you follow;
- **your nicknames** for players;
- **your highlights**: the battles you posted to a player's timeline,
  their words, and their share links, which stop opening;
- **your agents**, their keys and the identities they map;
- **your connections**: sessions, apps you allowed, a timeline
  cross-post's Discord webhook, and the clan Clan remembers you
  working in;
- **your mail**: what was sent to you, your email switches, and what the
  cross-post told and posted;
- **your usage**: call history, refusals and rate counters;
- your feedback.

It does not delete the record. The players' battles, profiles and clans
are public game data, recorded from the game like anyone's; they stay,
as any player's history does that nobody follows, under the
[record's retention rule](https://github.com/jthingelstad/elixir-mcp/blob/main/docs/product/record.md#when-a-person-leaves).
Removing your players stops their recording where nobody else follows
them, and stopping deletes nothing recorded.

A collector you run has to be revoked first. The
[privacy page](/docs/privacy) has the rest.
