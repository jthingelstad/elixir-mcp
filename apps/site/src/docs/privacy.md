---
slug: privacy
title: "Privacy"
description: "Elixir is a free hobby service for folks who like Clash Royale. What it keeps (public game history, your account, aggregate counts), who it shares it with, and how to have yours removed."
section: policy
order: 31
navTitle: "Privacy"
icon: eye-off
lede: "A free hobby service: it keeps what it needs to work, and sells nothing."
---

# Privacy

**What this is.** Elixir is a free service, built as a hobby, for
folks who like the game. There is no company behind it, no
advertising, and nothing here is sold. An account opens after you verify your email. This page
says, in general terms, what the service keeps and why; the details
move as the service grows.

**Game data.** Elixir records public Clash Royale data from Supercell's
API (battles, profiles, clans, wars) and keeps it over time. The game
shows the present; Elixir keeps the history, and anyone with an account
can read it. Nothing is recorded that the game's API does not already
publish. The Elixir family's own apps can add facts of their own (a
clan's awards, a leader's note on why a member left, a best score in
one of the apps). Each one says which app it came from, and only the
people it is meant for can see it.

**Without an account.** One page of the record opens to anyone: a
battle's own page, with its link and share picture, so a battle can be
shared. The status pages ([The corpus](/data), [Recording now](/data/now)
and their JSON) count what the recorder holds and name no player or clan,
except that each collector is credited to its operator's primary player.
Everything else needs a free account.

**Your account.** Signing in keeps your email address, so the service
can send you sign-in codes and mail about your account. A new account
also keeps the time zone the signup browser reports, so its times read
on your clock; change it on Profile. It also keeps
the records the product is made of: what you claimed and recorded, your
agents and connected apps and the calls they make, where they connected
from, and the mail it sent you. You can see these records on your
account pages. Some are trimmed after a while; the [Limits](/docs/limits)
page lists how long. Your address is never public, and it goes to one
kind of app only: an Elixir family app you sign in to and allow to see
it.

**Mail.** Occasional product news goes out through
[Buttondown](https://buttondown.com). The sign-in/create-account form has
**Send me Elixir product news**, checked by default for a new account;
uncheck it before requesting the email to create your account without
newsletter enrollment. Email proof keeps that choice. Signing in to an
existing account leaves its newsletter choice and any unsubscribe intact.
When a sign-in or signup enrolls you in product news, Elixir sends
Buttondown your email address and your browser's IP address for spam checks.
Sign-in and welcome mail are service mail, independent of this checkbox.
Elixir also sends reports and notes about your own play, each
with its own off switch. Every mail has a way to stop it, and a stop is
never undone by the service. Mail is counted by issue (how many were
opened, which links were clicked), never by who opened it.

**Sign-in check.** The sign-in forms, on this site and on the page an
app sends you to when it connects to Elixir, use Cloudflare
[Turnstile](https://www.cloudflare.com/application-services/products/turnstile/)
to tell a person from a script that types someone else's address. Its
script loads when you start typing your email, and it is usually
invisible; Cloudflare may ask for a click. Cloudflare sees your browser
and its IP address, under its own
[privacy policy](https://www.cloudflare.com/privacypolicy/). Elixir
sends Cloudflare only the check's token, never your email address, and
keeps whether the check passed in its sign-in logs, beside a shortened
fingerprint of the address rather than the address itself.

**Counting visits.** Pages use [Tinylytics](https://tinylytics.app), a
small, cookie-free analytics service, to count visits and errors in
aggregate. No account is attached to a visit.

**Services Elixir uses.** Elixir runs on Amazon Web Services in the
United States, which also delivers its account mail. Buttondown holds
and sends the newsletter, Tinylytics does the counting, and Cloudflare
Turnstile checks the sign-in forms.
Fonts are served from this site, so reading a page tells no one else
what you read.

**A clan's own AI key.** If a clan's leaders add their own Anthropic
key, Elixir Clan sends Anthropic what it needs to draft the clan's
messages, including member names, and the clan's key pays for it.

**Discord.** If you cross-post your timeline (or an agent's) to a
Discord channel, each new item on it is posted there, where Discord
keeps it under its own terms and everyone in the channel can read it.
Elixir keeps the webhook sealed and never shows it whole. Turning
cross-posting off stops new posts; lines already in the channel are
Discord's to delete. A clan's leaders may connect two Discord channels,
each on its own: one for the clan's Actions and one for its activity.
Elixir Clan posts to whichever is connected, member names included.

**What Elixir keeps about its Discord posts.** For every message Elixir
posts, edits or decides not to post in a Discord channel (a timeline's
cross-post, a clan's Actions, a clan's activity channel), it keeps a
record for 90 days: the account or clan it was for, a fingerprint of
the webhook (never the webhook itself), which timeline items or Action
it told, the text as sent, what Discord answered, how long it took, and
why anything was skipped. About a day after a message is posted, Elixir
reads it back once through the same webhook: whether it is still in the
channel, how many of each reaction it has (counts only, never who
reacted), and whether a thread was started from it. It reads only its
own messages, never anyone else's. When a clan's own model writes its activity
channel, the record also holds each run's counts, about what it cost,
and any text Elixir's checks refused, with the reason; what each run
was given and looked up, and the model's full answers, are kept 30
days. If you rate one of these posts (👍 or 👎 on a delivery list, with
an optional note), the rating is a feedback item from your account that
points at the post's record, kept and answered like any other feedback.
Elixir's operators read these records to judge the posts' quality
and fix what is wrong; they are never published and are not part of
the game record.

**Collectors.** If you run a collector for the service, its card name,
status and fetch counts are public and credited to your primary player.
Your machine's own name and address are not published.

**Keeping and removing.** Game history is kept; it is what the service
is for. To remove your account and your address, email
[admin@poapkings.com](mailto:admin@poapkings.com) or use the feedback
form. Removing an account deletes the account, not the record: your
address, claims, nicknames, agents, connections, mail and usage go
([your account](/docs/your-account#removing-the-account) lists them).
The players' game history is public game data, as it is in the game
itself, and stays as any untracked player's does, under the
[record's retention rule](https://github.com/jthingelstad/elixir-mcp/blob/main/docs/product/record.md#when-a-person-leaves).
A few copies outside the database go on their own clocks: captured call
bodies within 90 days, Discord delivery records within 14, and your
newsletter enrollment and archived mail are removed by hand. The reviewed cleanup
removed retired automatic game-wide captures while preserving personal and clan overlap.
Older data can remain in encrypted automated backups until their normal
seven-day retention expires.

**Changes.** When the service changes in a way that matters to this
page, the page changes, and the change is listed under
[What's new](/updates).
