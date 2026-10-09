# Decisions

What stands, one line each. The code and the public docs
(`apps/site/src/docs/`) describe behaviour; this file records the choices
that constrain it. The reasoning behind a line is in git history
(`git log -S "<words from the line>" -- docs/`). Do not re-litigate a line. A
change is a dated `docs/NOTES.md` entry plus an edit here, written as the
current rule, never as "was X, now Y".

## Scope and footprint

- **Elixir is the recorder** — a Clash Royale recorder for a player, their friends and their clan: explored on the website, delivered in record-driven mail, and connected to a person's own agent over MCP as an extension. A feature must serve that circle without an autonomous elite population or game commentary; the top of the ladder and esports are out of scope.
- **No recommendations** — no deck, upgrade or matchup advice, recommendation scoring, priors or candidate generation, and none rebuilt over friends, clans or any smaller population.
- **No game-wide statistics** — no corpus card or deck performance, meta tools, global comparisons or population rollups. The card catalog and art, canonical deck identity, archetype labels, the factual event calendar and scoped personal and clan history stay.
- **No leaderboard capture or autonomous elite recording** — board endpoints are retired at plan, lease, submit and ingest (`RETIRED_RECORDING_ENDPOINTS`); a recorded player's own profile still supplies their rank.
- **No named recording Collections** — followed players are organized as primary, alt, friend or watching; no replacement grouping, curated creator catalog, always-on recording or popularity quota exemption. A player's owned-card collection is a game fact and stays.
- **History is kept for what someone tracks** — a roster poll of a clan nobody tracks keeps only the tracked players on it (membership, role, roster row, the clan's name) and writes no clan day row; a retained battle keeps every participant.
- **No branded or derived player metric, ever** — no score, rating, residual ("Elixir Lift"), similarity, playstyle or adoption-cost number.
- **Every aggregate ships its control** — the control sits next to the number, in the service; a note fires on a detected confound, never as boilerplate.
- **Elixir names decks, never judges them** — an archetype label is vocabulary, not a verdict; null is the correct answer for a card no public source attests; nothing clan-specific enters the vocabulary.
- **Elixir is the system of record for game facts** — only collectors write the game record; what family apps attest is held apart and labelled (Data model).
- **Orientation is release readiness** — a person opening Elixir understands that it is a recorder and sees a clear next step.
- **No blockchain, POAP or ENS; no Supercell marks** — the unofficiality disclaimer is on every user-visible surface, tool metadata included.

## Recording, collectors and rate budget

- **One global rate budget** — the collector fleet is redundancy, never quota; no pooling across collectors; the ceiling does not move. The tick charges only rows it inserts and plans inside capacity less queued bulk; every live mint takes a token or queues nothing.
- **Only collectors call the CR API** — the token lives on allowlisted operator machines, never in CI, a Lambda or a browser.
- **Zero-trust collectors** — no AWS access; Bearer `config`/`lease`/`submit`; the server chooses all work; provisioning is reveal-and-copy of a one-time token.
- **The collector is Go only** — a Python version still parses so the minimum can refuse it, and the 426 hint points to the Go installer.
- **Releases are signed candidates until named** — naming promotes to Latest after the hub verifies url, sha256 and signature against `COLLECTOR_RELEASE_KEYS`; unsigned releases are refused. There is no version pin, even for a canary; rollback is naming the previous release. Raising `min_client_version` is Jamie's call; it never refuses config and fails open on an unparseable version.
- **A stale client is fixed by updating the client** — never by restoring a retired field on the hub.
- **The signed badge is self-reported** — `signed`, `dev_build`, `unverified` or `mismatch` against every release ever named; public badge, admin/operator-only hash; nothing gates on it.
- **Which collectors run is answered by the hub** — Admin ▸ Collectors, `elixir_collectors` and `/api/public/status`, never repo docs.
- **The session clock is the player schedule** — follow up 30 minutes after a productive read, doubling after empty ones, 2-hour ceiling (jitter included); profiles daily and after a session.
- **A failed fetch is retried in minutes** — 15, 30, then 60 (`poll_state.retry_at`), planned and charged like any plan; freshness moves only on admission.
- **A 404 holds a subject for a day** — except `currentriverrace` within six hours of the clan's last admitted race, which keeps its cadence through the season roll.
- **Roster `lastSeen` never gates battle logs** — it is a profile-efficiency signal only.
- **`live_fetch` only fetches** — Jamie 2026-10-08: "live_fetch should ONLY live fetch and not record data." Its job is fetch-only (`job.record = false`): the payload reaches the caller from `live_fetch_result` (an hour at most) and never the record, receipts or archive; a recording ask turns an open fetch-only job into a recording one, never the reverse. `live: true` on a recorded tool, Verify and the first read on add record.
- **Never manufacture a request to diagnose** — wait for the natural wave; errors never advance freshness.
- **Ingest never pauses on catalog integrity** — an unseen card is stubbed and healed.
- **The retained record's archive is write-once** — `payloads/` is content-addressed (`If-None-Match: *`) and the rebuild source; every field has a manifest disposition. History leaves only through a reviewed, Jamie-approved manifest that also deletes the selected object versions.
- **Backfills and imports** — each gets its own revocable gateway row; a source database is opened read-only; the recorder wins on overlap; an approximated stamp never replaces a real observation.
- **Collector points reward `new_facts > 0`** — `yield_24h` stays; credits are points ÷ 10 everywhere they are stated.

## Data model and semantics

- **Tags are the only game IDs** — no surrogate keys; `claim` is the only join between accounts and game data; a claim unlocks history, it never migrates it.
- **Store UTC** — every connection's session zone is UTC; time zones are display only.
- **The game day is the 10:00Z grid** — daily series and `days: N` resolve on it; the war clock follows the policy grid for every clan, with the observed offset reported raw.
- **Mode discipline** — modes are different games: a rate with no mode carries its per-mode-group split and a note, and `mode: "event"` pools events with a note. A clanmate battle is `casual` even when tagged; an untagged `unknown` is `casual`, a tagged one is event content.
- **`event_tag` is the discriminator** — a null tag is a permanent format grouped by `type`; a tagged battle belongs to its event; never pool across them, and never invent groupings for `trail`.
- **Absence needs proof** — a missing capture, observation or profile clan is unknown, never zero or "no clan"; quiet days count only where complete reads bracket them.
- **Battle-stub identities are not the recorded population** — headline and population counts (badge populations included) count recorded players: direct, or members of a comprehensively recorded clan. Every retained battle still keeps factual rollups for all participants, so a later-tracked opponent's history is consistent.
- **A boat defense is not the member's battle** — it leaves every count of a member's own battles; a boat attack stays.
- **A duel counts as its rounds** — each round is one game with its own tower-less deck and result; `battles_decks` lists round decks apart.
- **War facts are weekly aggregates** — no surface splits a member's week by war day; judgments read the race's weekly `decksUsed` against four a war day up to the finish; the day in progress is the game's own `decksUsedToday`; training days are never attendance.
- **A week's donations are the highest counter seen in its game days** — never pin the reset minute.
- **A clan's profile aggregates carry each member's latest profile forward** — `members_profile_carried` says how many.
- **Historical clan presence reads historical membership** — at the window's end for summaries, at the moment's own time for moments.
- **Duration is a proven bound, never a timing** — both-negative trophy changes are a Path of Legends draw.
- **Labels go beside identifiers** — never instead; card levels on the 1-16 display scale (`displayLevel`); evolution forms never merge (`form: base|evolution|hero`).
- **Archetype grammar in code, vocabulary in data** — the grammar is in `packages/contracts`; the vocabulary is in cr-agent-api-docs, kept by the Clash Royale Analyst; Elixir never merges candidates. Win condition, bait/bridge and `names_deck` roles; CYCLE_MAX is 3.4; a new card triggers review.
- **Shared facts have one derivation** — the website, mail, MCP, the JSON API and Clan read the same functions over the same recorded facts.
- **Game facts and clan decisions stay distinguishable** — the recorder reports facts (`member_left` stays raw); policy evaluations and human decisions keep their provenance and visibility.
- **Attested facts** — family apps record what a person did in a clan, and an app's own computed results (`award_standing`), apart from the game record, labelled with the app, attesting verified player, role and time. Visibility is the type's rule at read time: clan facts to verified members (and their agents); an away only to that clan's verified leaders; a player fact to whoever has the player on their timeline.
- **Timeline shape** — a notification feed per subject: battle sessions, never individual battles; the clock is the agent's (`game_clock`), not the feed's.
- **The timeline is a newsfeed** — newest first everywhere (`elixir_timeline`, console, mail); past the cap keep the newest and count the rest; `next_cursor` and `mark_read` go to the window's end.
- **The record is the trigger** — a moment names the battle that caused it and how; absence over a guess; replays and backfills write rows, never moments.
- **Timeline evidence is a read-only drill-down** — exact ordered constituent games with honest completeness; a crossing links a game only when proved; late proof keeps the original moment identity.
- **Verify is one battle** — a battle in the player's own log after the brief with exactly the eight target cards; the target is one of their own Trophy Road decks with two cards swapped; the proof may be in any mode.

## MCP contract and versioning

- **`packages/contracts` is the single source** — tool schemas, the error enum, `deck_hash` and the meta envelope; additive is a minor, a behaviour correction a patch, and an output-schema change a patch that moves the fingerprint.
- **MCP majors track domain shifts** — an agent reasons from the current declaration; removing an unreliable field is a patch; a major is for a domain-model change that alters what a task means.
- **No deprecation window** — every client is first-party and updated in the same pass.
- **Omit the tag to mean yourself** — the brief names the caller; `game_clock` is subject-free.
- **Refuse rather than choose** — with no `clan_tag`, use the primary player's current clan or refuse (`no_subject`), never an alt's, a friend's or a tracked clan.
- **Name the recorded population** — segment tools require `segment`: `"mine"` or exactly one player or clan; corpus and collection selectors refuse.
- **Windows** — unbounded is anchored at the first recorded battle; a date-only `to` covers the whole day; `applied.window` echoes season and `crosses`; no blanket refusal for a missing mode or an unbounded window.
- **One name, one meaning** — `day` not `date`; `arena` is `{id, name}`; snake_case; `clan_war_trophies` is war trophies and `clan_score` is only the clan profile score; retired names are banned from declarations and current docs by a test.
- **Meaning rides on the value** — caveats sit on the field as enums explained once in a note; guards go beside an ambiguous field, never by renaming it.
- **Stated conventions are schema** — `verbosity`, `days`/`weeks` and `season` are accepted wherever the instructions say; no new `include_*` flags (`battles_query.include_total` stays).
- **Every tool publishes an outputSchema** — required fields at the top level, every leaf nullable, on `tools/list` for every principal.
- **Booleans are always emitted** — the clipped bucket's `partial` mark (with `covers`) is the one exception.
- **Descriptions are capped at 600 characters** — overflow goes to the docs page; every error carries a `class`; retry data is structured (`retry_after_s`).
- **Read-only tools race a deadline; writes never do** — a read answers `query_timeout` with a request id and waits at most 5 s for a lock, on every door (MCP, Explore, `/api/v1`); each function's `statement_timeout` is a ceiling just under its Lambda kill; a priced `result_too_large` is an answer.
- **`battles_decks` is a light list with one deck in full** — one-line `card_names` and `archetype_label`, paged by `offset`/`next_offset`; `deck_hash` returns one deck in full.
- **Size per door** — `clans_roster`'s per-member extras appear only where no result cap applies (`/api/v1`, Explore); `clans_participation` over MCP is a lossless table that keeps an eight-week, 50-member read under 40,000 characters.

## JSON API and integrations

- **`/api/v1` is a public, versioned product beside MCP** — people call it with OAuth (audience `/api/v1`), integrations with a key; a token for one door is never accepted at the other.
- **The JSON API keeps ordinary semver** — a removed or renamed field is a major of its own `info.version`; the path stays `/api/v1` because it is the OAuth audience; a test pins its version to the shape of every tool it mirrors.
- **Programs read the JSON API; agents read MCP** — Drop and a clan's website use `/api/v1`; the Discord agent stays on MCP unpinned and reads a missing field as unavailable, never 0.
- **Integrations are admin-provisioned** — platform access an admin issues, not a tier entitlement; the agent may provision the family's own; `clans:read`, `mail:send` and `facts:write` are granted only by name.
- **`clans:read` reads any recorded clan** — the participation, roster and war-history reads a person's grant has, so an app can work with nobody signed in; no person's token is stored for it.
- **Family OAuth clients are provisioned and confidential** — the `family_clients` op provisions them; registration refuses a family redirect; `client_secret_post` with the secret minted on the app's host; first-party means provisioned, and first-party clients are unmetered.
- **Drop's sign-in with Elixir stays** — its OAuth client, consent, account authentication and authorized API access are in scope.
- **No OIDC layer** — family apps sign in with Elixir's OAuth; no OpenID Connect issuer or separate SSO.

## Accounts, principals and privacy

- **Free public signup; collector admission stays governed** — email verification creates an ordinary member account; signup never grants a privileged tier, collector token or extra capacity, and never reopens a denied or disabled account. Launch is free, and a paid tier needs Supercell's express approval.
- **Roles never gate visibility** — tiers differ only in slots and call volume; 50 player slots at every tier; `contracts/roles.ts` is the one source.
- **Principals: users, agents, integrations** — an agent's tier is capped at its owner's; `on_behalf_of` grants nothing (explicit tag > on_behalf_of > primary); no `act_as`.
- **The hour is the principal's, the day is the payer's** — Jamie 2026-10-08: "yes, seperate limits." The MCP hourly bucket keys on the principal that made the call (each agent its own, at its owner's tier rate); the daily tool-call quota and the live lane stay the owner's. A key with its own ceiling keeps its own bucket.
- **Agents track in the person's pooled slots** — one pool across the person and every agent they own; a subject counts once, a clan at its widest scope; agents track over MCP as watching only, never "me"; an agent keeps the clan it acts for, and its owner can re-point it.
- **Primary player's clan is followed automatically** — Jamie 2026-10-08: "it should follow it automatically for the primary player assuming they have a clan set (not all players are in a clan)." Activity scope, primary only, only on an admitted profile's clan; never past a slot or in place of a person's own follow, never a clan they stopped tracking; the follow moves with the player; the approved people made before 0205 were switched on by 0206 (Jamie 2026-10-08: "Approved: backfill auto_follow_clan for the 35 existing elixir accounts").
- **Removing your primary is refused while you track others** — choose the new primary first; removing your last player is allowed.
- **Agent-only tools** — `elixir_identify`, `elixir_my_identities` and `clans_context` are hidden from people and integrations; a personal connection ignores `on_behalf_of`.
- **Universal reads** — all recorded game data is readable by every account; account data stays private.
- **CR tags are not PII; email is.**
- **Nicknames and machine labels are private** — the card name is a collector's only public name; public operator credit shows the primary player only.
- **The account's address goes only to the family's own apps** — `account:email` is refused at authorize for any non-family client and checked again at `/oauth/userinfo`.
- **What is kept and counted, SETTLED** — game data is public and recorded; your account is first-party; measurement is aggregate, with no per-recipient open or click, ever; money is voluntary sponsorship that buys nothing.
- **Product identifiers are not tracking identifiers** — a send id or request id is a pointer its holder can open, so it may appear in links.
- **Invites carry no referral ids** — an invite line or link is the same for everyone (Elixir's plain signup address): no referral code, invite id or tracking parameter, and nothing records who copied or shared one.
- **The beta pulse is aggregate by signup week** — Admin ▸ Beta pulse counts people (never agents or integrations) by ISO signup week, from records Elixir already keeps, and never names, lists or links an account; staff and their `+tag` test mailboxes are left out and counted apart; it stores nothing new, and mail opens stay in Tinylytics (Jamie, 2026-10-08: "aggregate beta pulse funnel in elixir Admin"). Came back is a sign-in or a call of the person's own on a later day of the account's own time zone (UTC without one), never a session merely seen (Jamie, 2026-10-08: "agree").
- **What we never do** — no ads, brokers, selling or sharing, engagement scoring, automation on read state, or commercial targeting from game data.
- **Analytics is client-side Tinylytics only** — never proxied through our API; the servers send Tinylytics nothing; `/signin` loads no analytics.
- **The policy pages restate the service in general terms** — short and plain, a free hobby service, contact admin@poapkings.com; the code is the policy, and the pages change only with Jamie's word.

## Clan

- **Clan is part of Elixir** — one session, React application, web API, Postgres ledger, jobs and deploy; no separate OAuth, store, build or stack. The engine is `packages/clan-engine`, orchestration `packages/clan`, private state `packages/clan-state`, views `packages/clan-web`.
- **Clan reads Elixir through a closed in-process reader** — the authenticated person's credential and recorded facts only; membership, verification and role are current checks; private Clan state is never imported into MCP or public game tools.
- **`clans_context` is the one bounded exception** — an agent-only reader of eight policy fields, through `@elixir-mcp/auth/clan-context`, with an explicit grant bound to agent, owner, primary clan and service credential, current verified membership checked on every read, and durable revocation; no default grant.
- **Nothing runs until a clan has a policy** — verified leaders and co-leaders may prepare and save a policy at any size; reviews, Actions, standing and awards need ten members; a below-threshold save announces nothing; saving is always a human choice.
- **War intent is separate from scoring** — leaders set participation intent explicitly; it stays unknown until chosen, and presets never infer it.
- **Inactivity means no battle activity in any mode** — logins and rewards do not count; a flat counter cannot admit a removal recommendation while all-mode absence is unproven; positive activity protects, and role protections stand.
- **Clan messages start in chat** — routine recognition, promotions, demotions and updates default to clan chat; award and rules announcements offer an explicit Inbox alternative; saved Actions keep their original channel; delivery receipts are explicit human records, never inferred or resent; a reported daily Inbox limit is guidance, never a gate.
- **Awards live under Clan for every member** — one season selected; weekly progress is one Action with per-message receipts; automation uses only the newest timely closed week and never backfills; after each recorded war-week close, raise a leader Action to share provisional standings, without duplicates and never posted automatically. Manual grants stay flexible (several FreePasses a season is fine).
- **Rookie means first recorded join this season** — the season-points podium among members whose first recorded join to the clan falls in the selected season; an earlier join or returning stint never qualifies; saved grants stay final.
- **Clan drafts words; people decide** — the clan's sealed model key drafts welcome, departure, recruiting and leader-message copy from frozen, sourced context; departure drafts need a leader-confirmed kick or leave; drafting never completes or posts an Action.
- **A clan's model is its own choice** — the key's model list refreshes itself (at most daily, when Settings is opened, and at once after a draft finds its model gone; never from drafting); a refresh or a new default never changes the saved model, a model the key no longer offers stays chosen and marked, and a failed refresh keeps the old list.

## Web

- **One origin, paths not hostnames** — `elixir.poapkings.com` serves the site at `/`, the Console, Ladder and Clan under `/console`, `/ladder` and `/clan`, and the MCP/OAuth and JSON API doors; Drop stays at `drop.poapkings.com`; poapkings.com is the clan's website.
- **The web lets people explore their record** — useful without an agent; MCP extends it; no general BI platform or global game analysis.
- **The console switches into an agent** — an agent's console is a place (`/console/agent/<public_id>/…`): configure what it tracks, notifies and acts for; new feedback is filed as you; integrations stay out.
- **The console tells time in the account's zone** — through the kit's `stamp`/`useClock`, named by zone; day-bucketed charts stay UTC and say so.
- **A new account starts on its signup browser's zone** — an account with no zone reads in UTC (Jamie, 2026-09-23); since 2026-10-08 a newly created account takes the zone the signup request's browser reported, under Profile's IANA check, frozen with the request like the news choice (Jamie: "Approved: new elixir accounts take the browser's time zone at signup"); sign-in never changes an existing account's zone, and zone-less accounts stay UTC until Profile or the one-click offer sets one.
- **A battle has a public page** — `/battle/<short id>`, no account needed: names, clans, both decks, towers, how it ended, session and meetings, never a nickname or account data; the left side is the recorded player. Personal share context stays in the browser.
- **The console /status page is signed-in** — public health is `/data/now` and `/api/public/status`.
- **Activity year reads log coverage** — a rolled log never draws as zero.
- **Adopt the ecosystem early** — React 19, TanStack and Tailwind v4 in the shared kit; kit gaps are fixed in the kit; no Radix before a real dialog; no PWA.
- **Fonts are self-hosted** — no font CDN; the CSP names no third party.
- **Card art is Elixir's mirror of the API's iconUrls** — card responses carry `art` by form on Elixir's origin (Jamie, 2026-10-08: "Card art should be in the api response for cards"); surfaces draw the played form, else the base card, else the name; no page, share image or mail hotlinks Supercell's CDN for card art; every deploy mirrors, seeded from the bucket so a prune never takes art.
- **Docs ship with the change** — the tool reference is generated from the registry; a docs pointer must resolve before a tool names it.

## Email

- **Send over SES, receive at Fastmail** — never create SES address identities under the stack's domain.
- **Six product kinds** — clan, arena, friends (tracking), collector, milestone and Clan's actions-waiting; each is an account switch, default on; at most one mail per kind and subject per day (milestone exempt, one clan report per tracked clan); bulk kinds carry one-click unsubscribe; login mail is transactional.
- **No editorial or model-written mail** — the retired `top_100` and `card_of_week` kinds stay valid only for sent history and old unsubscribe links.
- **Mail is composed by calling the tools** — never a second derivation.
- **Clan's mail goes through Elixir** — Clan composes `clan_actions_waiting`; Elixir holds the address, switch and unsubscribe, sends only to the account that verified a player who can act, at most once per clan per account per day, with the app's lines escaped.
- **A collector upgrade is one notice** — one mail per observed installed release upgrade, under the collector switch; dev builds and prereleases never count.
- **Every send has an id and a record** — the footer links the record, one-click feedback and the sponsorship line; the relay logs the send id, never the recipient.
- **Pixel and utm on all mail** — the pixel names the mail, never the reader; owner notifications carry none; SES open/click tracking is never enabled.
- **No public issue page** — sharing means forwarding the email.
- **Newsletter consent is explicit** — Buttondown is Jamie's announcement channel only; new signup shows "Send me Elixir product news", checked by default, applied only to a newly created account; sign-in never overwrites an existing choice.

## Operations and AWS

- **Cost calls are Jamie's** — account-wide spend never changes through an Elixir runtime change.
- **The database is db.t4g.micro** — again since 2026-10-08, the class the reserved instance covers; the small (2026-09-23 to 10-08) held a record the tracked-only correction removed.
- **No Lambda-to-Lambda from the NAT-free VPC** — VPC Lambdas hand work to the non-VPC relay by writing one object to the outbox bucket (`email/`, `clan-model/`) through the S3 gateway endpoint; S3 notifies SQS, which holds retries and DLQs.
- **Alarms go to the ops queue, never email** — Elixir application tags on everything.
- **A custom metric exists only to back an alarm; no dashboard** — anything else is a property on the EMF line or a database row; no per-entity dimensions.
- **DNS stays at Namecheap** — Jamie applies records by hand.
- **A secret rotates without a sign-out** — every signing secret has a verify-only previous value; `docs/SECRETS.md` is the runbook; values are Jamie's, set in the console.

## Schema and migrations

- **The migrate Lambda is the only applier** — at deploy, never at handler start or by hand; only `{}` migrates, and an unknown op key is refused (`unknown_op`).
- **Expand-and-contract** — drop a column or table only after no deployed reader uses it.
- **Migrations never rewrite a large table** — add the column, fill it with a keyset-batched op, index it in its own migration; never re-key a large table or change a column type in place.
- **Lock shapes take three migrations** — NOT VALID, VALIDATE, NOT NULL, each in its own file; a migration locking a table it did not create sets `lock_timeout` first; shipped migrations are sha256-pinned.
- **Our enums are CHECKed; API enums stay open** — ingest never fails on a value the game adds.
- **Cards are rows, not JSON** — fixed-shape JSON becomes typed columns; `deck_hash` is the natural key.
- **Time-series shape** — `season` keyed on `season_month`; `war_period` rows; day grain with the last observation winning; a war-id mismatch alarms but never relabels.
- **A backfill that does not vacuum is not finished** — never run a backfill and a deploy together.
- **Live diagnostics only through migrate ops** — EXPLAIN the exact SQL the tool serves.
- **Incident authority** — while the door or pipeline is failing, the Elixir Operator may run `{terminate_backends}` (named, on a migration or backfill backend past five minutes) and `{gateway_drain}`/`{gateway_recover}`, recording each use in NOTES; account-touching write ops (`{account_*}`, `{oauth_grants}`) stay Jamie's.

## Agent team and process

- **The ledger is the read path** — objective runs, skills and sessions read this file for what stands; NOTES is working notes.
- **main takes only pull requests** — rebase-merged by auto-merge when `validate` is green, up to date with main or not (2026-10-08; main's push run tests the combination); no review required, no bypass; `deploy.mjs` refuses a HEAD that is not a green `origin/main` (`--break-glass` only when GitHub is down); a flake is fixed the day it blocks.
- **One worktree per run; the lease guards production** — every run edits in its own worktree at a fresh origin/main and lands a PR; the lease is claimed only for a deploy, a migration run or an ops-lambda write; use `&&`, never `;`, before push or deploy.
- **The acceptance suite is the release gate, opted into per deploy** — read-only, with its own token and bucket; `--acceptance=<family>` when a tool in that family changes, the whole suite for shared code or a release; a skip prints a warning.
- **The Gym has standing authority** — it fixes and deploys its findings without asking, one contract bump per family round, no MCP majors, under its own `gym` principal; a change to a response the JSON API mirrors stops for Jamie; a refuted case is pruned once what it tests is gone.
- **Close the loop** — feedback is never actioned invisibly; acceptance means passing from the first call; every contract bump updates the changelog.
- **Feedback is one system** — every door (MCP, `/api/v1/feedback`, the Console, Ladder, Elixir Clan, the docs, an email footer) files into `feedback` through `@elixir-mcp/feedback`, with an `area` and `feedback_ref` pointers; one admin queue answers all of it, and only the Elixir admin answers (2026-10-08, Jamie). Sign-in required, no anonymous feedback for beta; `admin@poapkings.com` is the fallback. A person is mailed each answer they have not already read (`feedback_answer`, one per answer). An agent relays a person's feedback with `on_behalf_of`; the answer goes to the agent. Drop stays out.
- **New indexes or tools must collapse a measured walk** — check an audit claim against the calling client first.
- **Standing owners** — four objective owners (Elixir Operator, Data Auditor, Feedback Manager, Security Reviewer) cover Elixir and Clan (`AGENT-TEAM/`); there is no Rankings Analyst and no separate Clan owner.

## Declined

- **Outcome ratings** (Elo, Glicko, TrueSkill, Bradley-Terry) — the matchmaker has already spent the information.
- **Matchup expectations** — the elixir-bot matrix was a mistake and does not come forward.
- **Rhythm-placed battlelog polls** — they cannot cut empty polls without over-capacity.
- **Bulk live name resolution** — it drains the one CR budget for cosmetic strings.
- **Importing elixir-bot's judgment** (awards, decisions, memories, dossiers) into Elixir or Clan.
- **WAF, RDS Proxy and Performance Insights** — cost exceeds the footprint.
- **A `war_week.season_id` foreign key** — it would refuse API facts.
- **Favourite-card or deck-slot verification** — neither proves control.
- **Database restore readiness work** — no restore runbook or rehearsal, longer retention, Multi-AZ, off-account copy or archive-replay proof; archive replication is a separate, open question.
