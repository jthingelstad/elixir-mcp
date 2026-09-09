/**
 * What's new — the product-updates surface. Newest first. Every
 * user-visible ship appends an entry in the same commit (AGENTS.md).
 *
 * Rendered as a real page at /updates and summarised on the home page.
 * Lives in the static site because it is content, not application
 * state; it used to sit in the React bundle where no crawler or agent
 * could read it.
 */
export default [
  {
    date: "2026-09-09",
    title: "We now keep the game's own \u201clast seen\u201d",
    body: "Clash Royale reports when each clan member was last active, but only inside a clan's member list - a player's own profile endpoint does not carry it. Every roster poll delivered it and we threw it away, which meant it was unrecoverable for any moment we did not store. It is kept now, and shows up on a player's profile and on every roster row as last_seen_in_game. It answers a question nothing else here could: last_recorded_battle only moves when somebody plays a battle we captured, so a member who opens the game daily without battling looked identical to one who has gone. It is also the rule the game uses to decide who is in a river race - members last seen before the race began are left out of it entirely - so a quiet member missing from the war roster can now be told apart from a recording gap. It cannot be backfilled: it starts filling from the next roster poll.",
  },
  {
    date: "2026-09-09",
    title: "War now says who is in the clan but not in the race",
    body: "A clan leader counted 44 people in this week's race against 49 in the clan, and had no way to tell a recording gap from a real one. It was real: checked against the game's own live payload, its current-river-race participants list returned the same 44 and left out the same five people, so what we served was right all along - just silent about the difference. war_current now returns participants_count, member_count and members_not_in_race, naming the current members the race roster leaves out. The game gives no reason for the omission, so neither do we; the reason reads not_in_race_roster and nothing is invented. The omissions cluster on the least active members, which is exactly where a leader is looking, so the gap being visible matters more than it being small. The behaviour is written up in the public Clash Royale API reference for anyone else who hits it.",
  },
  {
    date: "2026-09-09",
    title:
      "An agent's key capabilities are editable too, and renaming says what went wrong",
    body: "An agent can connect either over OAuth or with its service key. Editing capabilities only reached the first: an OAuth connection's capabilities live on its grant and are edited on Account -> Connections, but a service key's live on the key, so an agent connected the usual way had no capability control anywhere. The agent's own page now edits them, with the same checkboxes and the same rules. A key issued before capabilities existed holds all of them, and is shown that way rather than as a key that can do nothing. Separately, renaming an agent could refuse every name with 'lower-case letters, numbers and hyphens' even when the name was perfectly valid: an agent's name is its live key's name, so an agent whose key was revoked has nowhere to keep one, and that failure was being reported as though the name were malformed. Each refusal now says which one it is, and the revoked-key case tells you to issue a new key first.",
  },
  {
    date: "2026-09-09",
    title: "Change what a connection can do, without reconnecting it",
    body: "Account -> Connections now lists the capabilities of every live connection and lets you edit them in place. Tick a capability to add it, untick one to take it back; the change applies to that connection's next call, with no reconnect and no new token, because a token's capabilities are read from the grant on every request. The list also covers your agents' and integrations' connections, which each authorize at their own address and hold their own grant - previously they appeared nowhere and could not be managed at all. Reading recorded data stays switched on for every connection, since a connection without it can do nothing.",
  },
  {
    date: "2026-09-09",
    title: "You can add a capability the app forgot to ask for",
    body: "Connecting an app used to grant exactly what that app requested, and nothing else could be added afterwards. Since the read-only challenge advertises only cr:read, an app that never asks to file feedback or change recordings could never be allowed to, and the refusal it got pointed at a consent-page control that did not exist. The consent page now lists every capability your app did NOT ask for as an unticked checkbox. Tick one and it is added to the connection; tick nothing and the grant is exactly what the app requested, as before. Only capabilities Elixir MCP defines are accepted, the request that reaches the consent page is the one that was bound when your code was emailed, and the app is told what it actually received.",
  },
  {
    date: "2026-09-09",
    title:
      "Refusals carry the same envelope as answers, and three numbers say what they count",
    body: "A round of agent playtesting found places where the service was hard to trust or hard to report. Failures now answer in the same shape as successes: a database that cannot be reached and a rate limit both return error.code, a message, a hint and a meta.request_id you can quote, instead of a bare 'Internal Server Error' or a bare 'rate_limited' string, and the rate limit sends Retry-After. three_crown_rate no longer counts a duel that summed three crowns across its rounds as a three-crown victory - numerator and denominator both exclude duels and boat attacks now, and head_to_head_battles is returned so the division can be checked. battles_performance returns decided_wins and decided_losses, because the documented win_rate formula could not be reproduced from the fields that were on the wire. Deck responses show the evolution form and tower troop that deck_hash is built from, so two decks with the same visible cards no longer differ by hash for no visible reason. war_current says day_kind and war_day beside season_id and returns decks_today as an explicit null with a reason off a war day, so a training day stops looking like a clan that no-showed. elixir_coverage reports measured_span and measured_hours, so a perfect completeness ratio over two days no longer reads as a fully captured week. The clan named when a connection opens is now the primary player's, and any others are named too.",
  },
  {
    date: "2026-09-09",
    title: "The Status page shows the work waiting, not only the work done",
    body: "The capture charts only ever showed completed fetches. A new 'Work waiting' gauge above them shows the other half as a queue, in pipeline order: subjects due for the next scheduler tick (the planner runs every five minutes, so due work piles up between ticks and empties at each one), jobs queued for a collector, jobs being fetched, and what was done this hour, with a countdown to the next tick and the due count broken down by endpoint. The bar fills against what the next tick can plan, so a bar past full means a backlog is forming rather than the normal between-tick pile.",
  },
  {
    date: "2026-09-09",
    title: "The Status charts say which bucket is still being filled",
    body: "Both capture charts on the Status page gap-fill up to the current minute, so the right-most bar was always the bucket in progress and read as zero for the first minutes of every five-minute window, which is exactly how long the scheduler waits between ticks. That bar is now shaded the way the Dashboard shades an unfinished day (and drawn as a dashed outline while still empty), its tooltip says 'bucket in progress' with the count so far, and each panel states its total (fetches in the last hour, fetches in the last 24 hours) beside the bucket size, so a short last bar can no longer be mistaken for a service that stopped fetching.",
  },
  {
    date: "2026-09-09",
    title: "Documentation for people who build on this",
    body: "The docs now carry the wire contract, not only the product: a protocol reference (transport, OAuth discovery and registration, PKCE and the resource parameter, the five scopes and the step-up challenge, every error code at every layer, the 48,000-character response cap, versioning and the tools/list cache-buster, cursors and argument rules); a limits page with one table of every quota and rate limit and the exact refusal each produces; a recording and coverage page that says what adding a player or clan actually fetches, how often, how one recording is shared, what collections do, how to read freshness and completeness, and what live_fetch can reach. The quickstart has per-client steps for Claude.ai, Claude Desktop, Claude Code and any MCP client, and an honest note on ChatGPT. The agents page is a builder's guide with a complete on_behalf_of exchange and event-cursor code. Events lists every topic's payload floor. Roles, integrations, responses, privacy and operators were corrected against the code, and headings now carry anchors.",
  },
  {
    date: "2026-09-09",
    title:
      "Players you ask about stay fresh, and bursts stop rolling off the log",
    body: "Two changes to how the recorder decides when to fetch a player's battles. First, asking about a player through any tool now keeps that player's battlelog within an hour for the next day; until now a friend who plays a few games a day sat on the daily fairness floor and could be a day stale exactly when you looked. Second, the recorder now measures how fast each player has recently filled the ~30-entry battlelog and polls before half that time has passed, so a grinder's evening burst can no longer push battles off the log before they are recorded; the previous rule learned activity only from what a poll harvested, which is precisely what an overflowed log hides. The burst rule is rolling out to half of recorded players first so the two halves can be compared over the same hours. Profile snapshots of active players are taken every eight hours instead of every two, since the record keeps one snapshot per day.",
  },
  {
    date: "2026-09-09",
    title: "The maintainer hears feedback as it arrives",
    body: "Feedback filed on the site or through a connected agent, and tier-upgrade requests, now email the maintainer the moment they land: the category, a short excerpt, and which account or agent sent it (never an address), with a link to act on it. Until now only access requests and collector events did, and feedback waited for the next review pass. Each kind of notification has its own subject line, and notifications ride the best-effort lane of the mail relay so they can never delay or dead-letter a sign-in code.",
  },
  {
    date: "2026-09-09",
    title: "Same rules at every door",
    body: "The explorer on the website now follows the same discipline as the MCP connection: the hourly rate limit and daily call budget are the same buckets, oversized results come back as the same bounded failure, and it serves read-only tools (nicknames excepted, which are the console's own feature). Every tool, on both doors, now checks its arguments against its published schema before running, so a misspelled argument or an out-of-range value is a clear refusal instead of a silent ignore. The usage page shows your tier's real ceilings rather than the member tier's. Malformed ids in console requests answer 400 rather than a server error. And the API origins now accept only requests that came through the site's CloudFront distribution, so the caller address recorded on every call cannot be forged.",
  },
  {
    date: "2026-09-09",
    title: "Agents share their owner's live lane, and are counted",
    body: "An agent's live Clash Royale fetches now come out of its owner's daily live budget, the same way its tool calls already did; until now each agent quietly carried a fresh live allowance its owner never had, so several agents on one account multiplied the one shared API budget. Each tier also has an agent count now (member 3, leader 5, family 10, partner 25, admin and owner unlimited), enforced when an agent is created and shown on the Roles page. Separately, a refused OAuth token at the MCP door answered with a server error instead of the 401 challenge a client needs to re-authorize; it answers 401 now.",
  },
  {
    date: "2026-09-09",
    title: "Three new axes, honest denominators, and a visible budget",
    body: "Eleven pieces of feedback from one agent session shipped together, because they shared a shape: the record held the detail and each tool exposed only one way to group it. battles_opponents groups a player's battles by opponent, so 'have I faced this player before' is one call instead of a five-page sweep. badges_rarity and badges_holders make badges a dimension across every recorded profile, with one-off badges told apart from tiered ones. cards_synergy answers 'what is Witch played with' with co-occurrence, distinct players per pair and lift. players_names resolves up to a hundred tags to names without spending the live lane. Every response now carries meta.quota - calls and live fetches used and remaining, and when they reset - so an agent can price a plan instead of rationing an invisible budget. The event feed needs only the read capability. Deck and card meta shrink toward the corpus, not toward a player's own record, flag samples below thirty decided battles, and itemize what they excluded; performance windows separate decided head-to-head battles from boat attacks. Duel rows say how many games they hold and the legend says their crowns sum. Collection cards decode their forms (evolution, hero) instead of leaving a bit field to be misread as progress, and the card catalog serves max level on the in-game scale like everything else.",
  },
  {
    date: "2026-09-09",
    title: "Every connection says what it has done, and from where",
    body: "Account - Connections now shows, per connected client, when it last actually called (rather than when it last collected a token), the address and country it called from, and how many calls it made this week - alongside the disconnect button that was already there. Credentials of yours that stopped working and are still being presented appear above the list, counted per source per day. Agents already got this; the personal door has it now too.",
  },
  {
    date: "2026-09-09",
    title: "See what is using each of your credentials",
    body: "An agent's page now shows where it connects from - address, country and what the client calls itself - and warns when something is still presenting a credential that no longer works, which until now was invisible because a refused call never becomes usage. Refused attempts are counted per credential, per source, per day, and name the key when it is one of yours. Addresses are cleared after 30 days and refusal records deleted after 30 days; see the privacy page. Local clients redirecting to an IPv6 loopback address are now accepted alongside localhost and 127.0.0.1.",
  },
  {
    date: "2026-09-09",
    title: "Connecting a client survives a double tap",
    body: "Submitting the authorization form twice - which phones do on their own after filling a one-time code - no longer replaces a successful connection with an error page. A repeat within two minutes repeats the same answer and returns you to your client, with every check on the request applied again and each authorization code still usable only once.",
  },
  {
    date: "2026-09-09",
    title: "Sign-in codes stop competing with each other",
    body: "A code sent for connecting an AI client and a code sent for signing in to the website are now kept separate. Previously the most recent code of either kind was the only one that could be used, so requesting one while the other was open made the other impossible to enter and could exhaust its attempts. When a code is refused, the page now says which reason applies - superseded, already used, expired, too many attempts, or a code from the other flow - and what to do next.",
  },
  {
    date: "2026-09-09",
    title: "Knowing whether an agent is working",
    body: "An agent's page now revokes its key, reports when it was last active across every key it has held, and says outright when the current key has never been used - the signature of a runtime still presenting the previous one, which produces no errors because a refused call never reaches the log. Your usage now counts what your daily limit counts: calls your agents made on your budget are included in the daily total and broken out separately, instead of being invisible until you were throttled.",
  },
  {
    date: "2026-09-09",
    title: "An agent's connect URL, and renaming",
    body: "An agent's page now shows the URL to connect a client at, with a copy button, and creating one shows that URL beside the key it hands over once. Agents can also be renamed after creation; the name stays unique among your live agents and travels with the agent when you issue a new key.",
  },
  {
    date: "2026-09-09",
    title: "A clan agent's tools default to its clan",
    body: "An agent connection omitting clan_tag now resolves to the clan the agent acts for, as its opening instructions have always promised. Clan defaults were previously derived from claimed players, which an agent does not have, so clan tools answered that the connection had no recorded clan membership while the same connection reported the clan by name. Agents with several clans default to their primary. Personal connections, explicit tags and leadership-scoped analytics are unchanged.",
  },
  {
    date: "2026-09-08",
    title: "A REST API for platform integrations",
    body: "Admin → Integrations now provisions platform keys, permissions, independent budgets and collection enrollment grants. The versioned API provides a game calendar, recorded player profiles, asynchronous refreshes and idempotent automatic recording enrollment. Elixir Drop is the first consumer. Personal and clan-agent MCP connections keep their existing behavior.",
  },
  {
    date: "2026-09-08",
    title: "Questions to try after connecting",
    body: "Account → Connections now suggests questions your recorded history can support. Copy one into your connected AI client to review your player snapshot, recent battles, decks, two recorded weeks or a recorded clan war. View the full question before copying; manual copying is available if clipboard access is blocked. The overview shares the same suggestions. New players see guidance while they wait for their first capture.",
  },
  {
    date: "2026-09-08",
    title: "Smaller modules, tested account journeys",
    body: "Account pages, API routes and maintenance commands now have smaller, focused modules. Successful account and agent journeys are tested against the real API on disposable databases, including first capture, agent creation, key rotation, suspension and resumption. Existing behavior is preserved. CI now runs the same complete verification gate as local development, including dead-code checks.",
  },
  {
    date: "2026-09-08",
    title: "Checked response metadata",
    body: "Response metadata is checked against the shared contract before a tool result is returned. The response guide now uses a generated, tested example, with UTC timestamps, explicit unknown freshness, and the current contract version. Valid answers and statistical calculations are unchanged.",
  },
  {
    date: "2026-09-08",
    title: "Statistics with explicit denominators and limits",
    body: "Deck and card meta now count only wins and losses in their decided totals, usage and shrinkage baseline; draws and unresolved results no longer depress that baseline. Empty samples report an unknown rate. Personal and clan Pilot Scores now share the same level inputs and qualifying population. Their responses spell out that the legacy standard-error field is an approximation, not a confidence interval for the score. The methodology documents the formulas, independent rounding of displayed rates, sample floors, dependent observations, and limits of rolling-baseline and tenure comparisons. Earlier release descriptions claiming guaranteed rankings or improvement independent of spending have been corrected.",
  },
  {
    date: "2026-09-08",
    title: "A first question your history can answer",
    body: "Your account overview now guides you from adding a player through the first capture to asking your own MCP client. Suggested questions follow the data actually recorded: a player snapshot first, then battle reviews, deck comparisons and comparisons between two weeks as those samples become available. Copy a question with coverage and freshness checks built in, or open the same player's recorded data to inspect it. Connection consent and successful data reads are shown separately, including recent repeat use. Copying a question never counts as a successful answer, and a small sample never promises proof of improvement.",
  },
  {
    date: "2026-09-08",
    title: "Answers that agree, with clearer evidence",
    body: "Performance summaries now count the whole period you ask about, including histories longer than 2,000 battles. Freshness follows the data used: a recent profile poll can no longer make an old battle log look current, and war answers show when the race was last observed. Coverage compares battles over the actual time between profile observations instead of treating several days as one, and later-arriving battles improve that estimate automatically. Results too large to deliver now fail clearly with a traceable request ID. The methodology explains the statistics currently served and distinguishes descriptive comparisons from proof of improvement.",
  },
  {
    date: "2026-09-08",
    title: "Agents you can actually run, and players you can tell apart",
    body: "Creating an agent used to be a one-way door: you could make one and revoke its key, and that was the whole story. Revoking was worse than a missing feature, because there was no way to issue a replacement - the only path back was deleting the agent and building a new one, which changes its address and loses its place in its own notification feed. You can now issue a new key in place, suspend an agent and resume it later, read every notification it has been sent, see who it answers for, and see how many of your daily calls it is spending. That last one mattered more than it sounds: an agent spends YOUR budget, and until now those calls appeared nowhere, so you could run out with a usage page reading nearly zero. A suspended agent's key simply stops working, the same as any invalid key. Separately: players you add can now be marked as your alt, a friend, or someone you are just watching. That setting has existed since the day relationships shipped and your agent has been reading it all along - but nothing could set it, so everyone came out as 'watching'. Now your agent knows which players are actually you.",
  },
  {
    date: "2026-09-08",
    title: "Visit counting works the same everywhere",
    body: "The signed-in application went unmeasured for a few days, and the reason was a fix that did not fix anything. Analytics had been taken off the application because third-party code running inside your session is genuinely worth avoiding - but the same script still ran on the documentation and home pages, which sit on the same address and the same session, so nothing was actually kept out. The application now counts visits the ordinary way, exactly like the public pages, and the roundabout route through our own servers is gone. No account is ever attached to a view, and the sign-in page still loads no analytics at all, because your sign-in link travels in that address. One change you may notice in effect rather than appearance: a page about a specific player or clan now reports as the page it is, with the tag alongside it, rather than as a page of its own.",
  },
  {
    date: "2026-09-07",
    title: "The documentation is a real website now",
    body: "Every page here used to be one file. Whatever address you opened - the docs, the tool list, the changelog - the server sent back the same home page, and your browser drew the rest. That works for a person clicking around and fails everyone else: search engines saw a single page wearing ten names, and an AI agent fetching a documentation URL got the home page instead of the documentation. The content pages are now genuine pages, each with its own address, title and description, readable without running any code. The tool reference is generated from the server's own registry, so it can no longer fall behind what your agent actually sees - it had drifted five tools behind. There is a new page listing everything that has shipped, and machine-readable files at /llms.txt, /llms-full.txt and /tools.json for agents that would rather read one file than crawl a site. Nothing moved: every address you had still works.",
  },
  {
    date: "2026-09-07",
    title: "Connected agents get only what you approve",
    body: "Connecting an agent used to ask for read access while its token could also change recordings, collections, nicknames, event state, and feedback. That mismatch is closed. The authorization page now lists each capability before you enter the code, read-only access stays read-only, and write actions require their own explicit grants. Tokens are also bound to this MCP server, so one minted for another resource cannot be replayed here. Existing connections keep read access; reconnect when an agent needs to make changes.",
  },
  {
    date: "2026-09-07",
    title: "One war clock for every clan",
    body: "Clash Royale resets war days at 10:00 UTC as policy, but it matches clans into races of five as matchmaking fills, so every clan's day really starts a little off that hour by its own amount. Following each clan's own drift is right for a single clan and wrong for an archive covering many: war day 3 ended up meaning a different twenty-four hours for every clan, so no two clans could be compared and a re-run of the same data could land on a different day. Elixir MCP now follows the policy hour for every clan. We still record and report when each clan's race was actually seen to open, and by how many minutes it differed, so anyone working with a single clan can correct for it.",
  },
  {
    date: "2026-09-07",
    title: "Collections keep their promises",
    body: "A round of fixes to what collections actually do. Raising a collection's scope to comprehensive now deepens the members it already holds, instead of only the ones you add afterwards - so a collection that says it captures battles captures them. Deleting a collection now stops the recordings it was the only reason for, rather than leaving them running for a list that no longer exists. And two roster edits arriving at once no longer overwrite each other, so an add can never quietly drop somebody another add just put in.",
  },
  {
    date: "2026-09-07",
    title: "The console hierarchy holds everywhere",
    body: "The admin console has always said that no admin can change the owner's account, or another admin's. The role controls enforced it; the approve/deny control did not, so an admin could deny a privileged account out of the service. Access decisions now answer to the same hierarchy as role changes. Separately, the site's edge was turning API refusals into blank successes: an unauthorized API call came back looking like an empty but successful answer instead of a refusal. Refusals now arrive as refusals.",
  },
  {
    date: "2026-09-06",
    title: "Collections collect",
    body: "Putting a player or clan in a collection now records it, for as long as it stays there. Until today a collection was only a list, so curating one recorded nothing and you had to add every subject to your account separately. Each collection also says how deeply to record what it names: everything including battles, or just the surface - a clan's roster, war and standings, or a player's profile. Editing membership is now a single box, one tag per line, and collection descriptions have room for real writing.",
  },
  {
    date: "2026-09-06",
    title: "Collectors credit the people who run them",
    body: "Every collector is somebody's machine, quietly fetching on a home connection so the archive keeps growing. The status page now says whose: each collector is credited to the player who runs it, beside the Clash Royale card it was named for. Only the game identity appears, never the account behind it.",
  },
  {
    date: "2026-09-06",
    title: "Capture charts stack by collector, and go back a day",
    body: "The capture chart told you how much was fetched but not by whom. Both charts are now stacked by collector, and hovering any bucket breaks it down - who fetched how many, and how many were rejected. Underneath it sits a second chart covering the last 24 hours in hourly buckets, which is where a collector that quietly stopped pulling its weight overnight becomes obvious. Empty stretches now draw as real zeroes instead of vanishing, so the time axis no longer lies about quiet periods.",
  },
  {
    date: "2026-09-06",
    title:
      "Collectors say both when they last spoke and when they last delivered",
    body: "The status page and the admin table were showing different times for the same collector, and both were right: one counted the last data we accepted, the other counted the last time the collector said hello. A collector that is polling happily but has nothing to fetch is idle, not broken, and only one of those numbers could tell you so. Both surfaces now show both times, labelled, on the same clock. The status page also dropped its queue panel - the queues it listed were retired weeks ago and six of the seven rows had been reading 'unavailable' ever since.",
  },
  {
    date: "2026-09-06",
    title: "Collector updates actually reach collectors",
    body: "Collectors only install the exact binary version and hash this server names, which is what stops a compromised release page from pushing code to operators. That naming step had never been used, so released collectors were quietly staying on whatever version they were installed with. We can now name a release in one command, and have named the current one.",
  },
  {
    date: "2026-09-06",
    title: "Provisioning tells you what it did",
    body: "Provisioning a collector token in Admin used to succeed silently: the token is staged for the operator's one-time reveal on their Collector page, so the Admin table just refreshed and looked like nothing happened. Admin now confirms the token is staged, keeps a 'token staged' note until it is revealed, links straight to the reveal when you own the collector yourself, and surfaces any failure instead of swallowing it.",
  },
  {
    date: "2026-09-06",
    title: "Collectors go zero-trust",
    body: "The collector fleet was rebuilt overnight around a simple rule: operators cannot be assumed safe. Collectors are now pure API clients - a bearer token we issue, three HTTPS routes, no AWS credentials of any kind - and the server computes what to fetch, stamps identity on every result, caps outstanding work, and quarantines a collector that takes jobs without returning them. Enrollment is just a name now (no IP collected), provisioning is a one-time download, and self-updates only install the exact binary hash the server names. Our two home collectors already run the new model - one in Go, one in Python, deliberately different so no single bad release can silence the fleet.",
  },
  {
    date: "2026-09-06",
    title: "Hardening pass from an outside assessment",
    body: "An independent review of the whole system produced a punch list, now shipped: war-day events and the current-war view survive season rollover (the period index resets each season - the anchors now know that), staying signed in actually works (sessions slide with activity up to 90 days instead of dying at day nine), every recorded payload is verified to be ABOUT the player or clan it was requested for, delayed data can no longer overwrite newer snapshots, and deploys now run schema migrations before new code goes live.",
  },
  {
    date: "2026-09-06",
    title: "Click into things",
    body: "Feedback items are now real pages - open one from your feedback list (or the admin queue) to see the whole conversation at a linkable URL, and maintainer responses are now composed right there. Collections opened up the same way: open a collection to edit it in place - members as rows, add and remove where you can see them - instead of the old squint-and-type row controls.",
  },
  {
    date: "2026-09-06",
    title: "Docs worth reading",
    body: "The Architecture page grew real depth: collectors in detail (card identities, credits, self-update, the capture audit), the push lane and Clan Pulse, how the feedback loop actually closes, and the no-NAT outbound relay design. It also now maps the public GitHub repos - Elixir MCP, the collector, Elixir Agent, and Elixir Drop - so you can read the code behind any of it.",
  },
  {
    date: "2026-09-06",
    title: "The Elixir MCP newsletter",
    body: "Elixir MCP now has a mailing list for occasional product updates, run on Buttondown the same way Elixir Drop's is: signing in enrolls you, every issue carries an unsubscribe link, unsubscribing sticks forever, and the email is pixel-free. Details on the privacy page.",
  },
  {
    date: "2026-09-06",
    title: "Anonymous visit counting",
    body: "The site now counts visits with Tinylytics - anonymous page hits, visitor countries, and a few product events (a tool call happened, feedback was filed). No cookies, no cross-site tracking, nothing attached to your account, and the sign-in page loads no analytics at all. The privacy page has the full story.",
  },
  {
    date: "2026-09-06",
    title: "Clan Pulse: run your clan with a routine",
    body: "Every clan you've added now sends one daily clan_pulse digest to your event feed: 24-hour battle activity, top players, members quiet five or more recorded days, war-day deck counts, and roster changes - facts only, the judgment stays yours. A war_day_open event fires the moment a new war day is first observed, and war_current now returns decks_today: named untouched/partial/finished lists, the nudge list. Point a scheduled agent at elixir_events and it can genuinely help run the clan - the recipe is in Docs > Tools.",
  },
  {
    date: "2026-09-06",
    title: "Clan notifications that actually notify, and a measured miss rate",
    body: "Two honesty upgrades. Clans you've added now feed your notification pipe with the things that actually happen: members joining, leaving, and changing role (before this, the only clan event was the weekly war boundary - technically working, practically silent). And every fresh battlelog poll is now capture-audited: if the rotating log fully rolled between polls, that's flagged as a possible gap, and the 24-hour gap count is public on Data > Status - so 'no gaps' is a measurement, not a promise.",
  },
  {
    date: "2026-09-06",
    title: "Look people up by name",
    body: "The Explore lookup now resolves names and your private nicknames, not just tags - type 'tyler' and land on the player you call Tyler (nicknames rank first), type a game name and get the record or a short pick-list when several match. Same honest miss when the corpus has nobody by that name.",
  },
  {
    date: "2026-09-06",
    title: "A status page you can put on your phone",
    body: "Data > Status is the live operational dashboard: pipeline health at a glance, every queue's depth and age (DLQ above zero shows red - that's an incident), each collector's heartbeat and hourly fetch rate, and the last hour of capture in 5-minute buckets with rejects in amber. Public by design, refreshes every minute, and built mobile-first - bookmark it on your phone.",
  },
  {
    date: "2026-09-06",
    title: "Nicknames — how YOU know them",
    body: "To you, Raquaza is Tyler. Now Elixir knows that too - privately. Set a nickname on any player's record page (or have your agent call elixir_nickname), and it's yours alone: search finds 'tyler' and ranks it first, summaries and rosters show the nickname beside the real name, and no other account ever sees it.",
  },
  {
    date: "2026-09-06",
    title: "Collectors: cards stay, arenas go",
    body: "The arena-climb was confusing flavor, so it's gone. What running a collector actually earns is now front and center: every 10 fetches adds +1 to your daily tool-call quota (capped at 4x your base), plus bonus recording slots while it runs. Each collector keeps its Clash Royale card identity - the card is its name; your machine label stays underneath.",
  },
  {
    date: "2026-09-06",
    title: "The redesign: an instrument, not a brochure",
    body: "The whole site moved to the new design language - Clash display type for the brand shell, gold reserved for what's YOURS (the star on your tag, your clan), purple as the working accent, denser tables with honest footnotes as first-class components. The headline change: Explore is no longer eight tabs of charts. It's a lookup - 'Do we have it?' - that opens deep-linkable records you traverse by clicking references: player to clan to war week to battle to deck. Every record page is one tool call, the same one your agent makes, with a raw-JSON view and a copy link. Charts now live only in Data, where corpus scale is the subject.",
  },
  {
    date: "2026-09-06",
    title: "Collector config from the website",
    body: "Provisioning a collector no longer means credentials over a side channel. Once the maintainer provisions your gateway, Account > Collector offers your complete configuration as a ONE-TIME download - it disappears from the server the moment you fetch it. You add exactly one thing yourself: your own Clash Royale API key. Pairs with the new Go collector: a single binary for Mac, Linux, and ARM NAS boxes, self-updating from signed releases.",
  },
  {
    date: "2026-09-06",
    title: "The intelligence tools reach the browser",
    body: "Web/agent parity closes out. The player explorer gains a Pilot Score tab - your score with its approximate standard-error field (not a calibrated confidence interval), the monthly trend, and the full Level Curve. Explore > Meta shows the observed deck and card meta plus weekly trends for any segment: the whole corpus, a clan, or a collection like the pros. And Clan & War now carries Standings (win rates vs the clan median), clan-wide Pilot Scores, and the war Scouting Report. Every view is the same registry call your agent makes.",
  },
  {
    date: "2026-09-05",
    title: "Your activity, your collector, on screen",
    body: "Account gained two pages. Activity shows three views of your own account: every MCP request your agents made (tool, timing, errors - the debugging view), your account's event history, and your notification pipe (with unread rows past your agents' cursor bolded; reading here never marks anything seen for them). Collector shows what your machines have actually done: a 30-day fetch chart per collector, endpoint mix, points, and the running version.",
  },
  {
    date: "2026-09-05",
    title: "The Data section",
    body: "Elixir MCP now shows its work in public. The new Data area carries the corpus dashboard - battles recorded per day, players observed, collector activity, full history - and the rendered contract changelog. The front page touts the live totals, and the public pages are crawlable: real content in the HTML, not just an app shell.",
  },
  {
    date: "2026-09-05",
    title: "The observed meta, and trends for any group",
    body: "Three new intelligence tools, grounded entirely in recorded battles. battles_meta_decks and battles_meta_cards show what's actually being played and winning - across the whole corpus, one clan, one player, or a collection like the pros - with shrunk win rates that moderate small-sample extremes without guaranteeing rank order, distinct-pilot counts, and evolution forms kept separate. battles_trends adds weekly series for the same segments: watch a clan's (or the pros') win rate, volume, and active players move week over week. No tier lists, no opinions - sample sizes ride every number.",
  },
  {
    date: "2026-09-05",
    title: "Added means recorded",
    body: "The model got simpler, at Jamie's direction: adding a player or clan IS recording it - no separate watch toggle, no follow bookmarks, no approval queue. Your tier's slots are the only gate, and the one per-subject setting left is the notification bell: whether that player or clan feeds your agent's event pipe. elixir_add_player and elixir_add_clan replace the watch tools.",
  },
  {
    date: "2026-09-05",
    title: "Watch clans yourself, and one ladder to rule them all",
    body: "Clan watching is now self-serve: add any clan to your account for free, and turn watching on or off yourself - activity or comprehensive - within your tier's slots. No more waiting for approval; the role ladder is the gate. The ladder itself gained its top rung: owner (the super admin) sits above admin, and admins now see the console with day-to-day powers. Docs pages are also directly linkable now (like /docs/roles).",
  },
  {
    date: "2026-09-05",
    title: "The entitlement ladder and the push lane",
    body: "Three ships in one. ROLES: five tiers (member, leader, family, partner, admin) now set recording slots and daily budgets - never what you can read; the full ladder is public under Docs > Roles, and upgrades are self-serve from Account > Overview. SELF-SERVE: the family tier and above create their own collections right on the Collections page. PUSH LANE: agents stop polling - the new elixir_events tool is a per-account event feed (new battles recorded, war week finished, feedback answered, tier changed) with implicit subscriptions: watching something IS subscribing.",
  },
  {
    date: "2026-09-05",
    title: "A navigable web app",
    body: "The site grew faster than its nav, so the nav got rebuilt: four areas - Explore (player, clan & war, collections, collectors), Account (overview, agents, usage, feedback), Docs, and Admin - each with its own page row underneath. Collections are now browsable by everyone under Explore, and the maintainer curates them from a new Admin page. Old links redirect.",
  },
  {
    date: "2026-09-05",
    title: "The feedback loop learns",
    body: "Round two, built from feedback about the feedback system itself: an MCP-visible changelog (elixir_changelog - what shipped since any contract version), machine-readable ship links on responses, a meta hint when a maintainer reply awaits you, and server instructions that ask agents to file friction on their own judgment - your agent reports friction so you don't have to.",
  },
  {
    date: "2026-09-05",
    title: "Open data and Collections",
    body: "Two big ones. All recorded game data is now readable by every account - the same access the game's own public API gives anyone (we add history, not exposure); account data stays private. And Collections arrive: curated groupings of players or clans - starting with a pros list - browsable by everyone, curated by the maintainer for now.",
  },
  {
    date: "2026-09-05",
    title: "First agent feedback, actioned",
    body: "The first feedback ever filed through the MCP write tool asked for three things - and shipped the same night: clans_pilot_scores ranks a whole clan's Pilot Scores in one call (was 18), players_search resolves clanmate names to tags, and battles_levels takes include_curve: false for repeated scoring. The event-mode taxonomy it also asked about had shipped hours earlier. Responses are on each item via elixir_my_feedback.",
  },
  {
    date: "2026-09-05",
    title: "Feedback gets answers",
    body: "Filed feedback now comes full circle: the maintainer can reply, and you (or your agent, via the new elixir_my_feedback tool) see each item's status and response. Nothing gets actioned invisibly - triggered by the first real agent-filed feedback, which deserved better than a void.",
  },
  {
    date: "2026-09-05",
    title: "Event modes, findable",
    body: "KHAOS drafts, Crazy Arena, Showdown - the rotating event modes were recorded all along but hard to discover. battles_performance group_by 'mode' now lists every named mode you've played with its record, and battles_query takes a game_mode filter ('chaos' finds all the Chaos drafts).",
  },
  {
    date: "2026-09-04",
    title: "Level Curve, Pilot Score, Scouting Report",
    body: "Two new intelligence tools, grounded entirely in recorded battles. battles_levels measures what card-level advantage is actually worth (a 66,000-observation curve) and scores any player's Pilot Score - performance relative to an in-sample level-gap baseline, with a descriptive monthly trend that does not prove improvement or spending independence. war_rivals is the Scouting Report: observed war history for every rival clan your brackets have ever contained. No tiers, no opinions - every number ships its sample size.",
  },
  {
    date: "2026-09-04",
    title: "Clan standings",
    body: "New clans_standings tool: every member's recorded win rate over a window, ranked against the clan median - the 'am I above average?' answer, built for agents (including Elixir, the POAP KINGS clan agent, whose stats answers are moving onto Elixir MCP).",
  },
  {
    date: "2026-09-04",
    title: "Clan recording scopes",
    body: "Clan recording now comes in two scopes: activity (the clan itself - roster, war, standings) and comprehensive (all of that plus every member's battles and profile, following the roster as membership changes). Existing recorded clans stay comprehensive.",
  },
  {
    date: "2026-09-04",
    title: "Tools organized by domain",
    body: "Tool names now lead with their domain - players_summary, battles_query, war_current, elixir_feedback - so every client lists them grouped: Players, Battles, Clans, War, Cards, Live, and Elixir MCP itself. The service domain also grew four tools: watch a player, request clan recording, corpus-wide data insights, and the collector ladder. Reconnect to pick up the new names.",
  },
  {
    date: "2026-09-04",
    title: "Round-3 playtest fixes",
    body: "Three fresh agent testers, thirteen fixes: war attendance now counts recorded battles (polls alone undercounted), opponent decks and names appear in battle detail, weekly trends align to real ISO weeks and show trophy-eligible counts, summaries add best-deck and draw counts, and the validation layer rejects forged cursors, empty tags, and out-of-range arguments loudly.",
  },
  {
    date: "2026-09-04",
    title: "The collector gets its own home",
    body: "Running a collector now means cloning one small repo (elixir-mcp-collector on GitHub) instead of the whole server codebase. Existing collectors migrated in place and keep self-updating.",
  },
  {
    date: "2026-09-04",
    title: "Raw history archives to S3",
    body: "Every payload the collectors fetch is now archived durably to S3 the moment it is admitted — the full raw history behind your record is kept forever and stays queryable, while the database keeps only the hot serving set.",
  },
  {
    date: "2026-09-04",
    title: "War tools tell the whole truth",
    body: "Honesty batch from agent playtesting: unknown war-day attendance is now null instead of a false zero, war participants say whether they are still in the clan, the seasons filter applies to member weeks, and comparison windows state plainly that they cover recorded battles only.",
  },
  {
    date: "2026-09-04",
    title: "Service tokens",
    body: "Long-lived API tokens for trusted services — the first step toward elixir-bot consuming Elixir MCP instead of running its own recorder.",
  },
  {
    date: "2026-09-04",
    title: "Collectors earn their keep",
    body: "Running a collector now raises your daily tool-call quota (every 10 fetches = +1 call, up to 4x), and every gateway gets a Clash Royale card as its avatar on the ladder.",
  },
  {
    date: "2026-09-04",
    title: "Documentation",
    body: "A new Docs section: what Elixir MCP is, how privacy and terms work, and the architecture — maintained alongside the code, so it is always current.",
  },
  {
    date: "2026-09-04",
    title: "Explore your data in the browser",
    body: "The new Explore page renders exactly what your agent sees: summary, battles, weekly trend, decks, collection, war, and coverage — every view is a real MCP tool call.",
  },
  {
    date: "2026-09-04",
    title: "Feedback goes straight to the roadmap",
    body: "Send feedback from the dashboard or have your agent call send_feedback — either way it lands on the maintainer's desk attributed to you.",
  },
  {
    date: "2026-09-04",
    title: "Trend, headline, and deck tools",
    body: 'get_performance can return a weekly win-rate series, get_player_summary answers "how am I doing?" in one call, and deck performance gained sorting and share-of-battles.',
  },
  {
    date: "2026-09-04",
    title: "Four months of history imported",
    body: "The elixir-bot archive was replayed into the recorder: battles back to mid-May, war seasons 133-135, and daily snapshots from July.",
  },
  {
    date: "2026-09-03",
    title: "Elixir MCP launches",
    body: "Recording, the MCP server, clan war data, and the gateway fleet — live from day one.",
  },
];
