# Decisions

The decisions that still stand, one line each. The full reasoning lives in
the dated entry in `docs/NOTES.md` or its weekly archives (`docs/notes/`); search the
heading date. Do not re-litigate these; a change is a new dated NOTES entry
and an edit here. (Dates before 2026-09-08 point at the bold dated lead-ins
inside the V1/V2 build-order section, or at the top Decisions block, of
`docs/notes/2026-W36-W37.md`.)

## Product and scope

- **Recording is the lane** — "The lane is recording and making the record available"; Elixir is a data product for players' own agents, the agent is the analyst. (2026-09-19; Jamie)
- **No branded or derived player metric, ever** — Pilot Score is removed and was "a mirage"; no score, rating, lift, similarity or adoption-cost number replaces it. (2026-09-19; Jamie)
- **Facts, never judgments** — surfaces report disclosed rungs and raw facts (`member_left` stays raw); judgment belongs to verticals such as Clan and elixir-bot. (2026-09-13; Jamie)
- **Every aggregate ships its control** — "every aggregate ships the control next to the number, and the note fires on a detected confound, not as boilerplate"; it lives in the service, not in callers' prompts. (2026-09-18; Jamie)
- **Recommendations come from the player's collection** — agents suggest upgrade paths "grounded in what the player has"; `fit_for` on the meta tools, and the win condition matters more than the family. (2026-09-20, 2026-09-21; Jamie)
- **Mode discipline** — "game modes are really played as a different game"; a battle query with no mode is probably a bug. (2026-09-22; Jamie)
- **Elixir names decks; nothing clan-specific** — archetype names are vocabulary, never a verdict; "null is the correct answer" for a card no public title attests. (2026-09-20; Jamie)
- **Greenfield, multi-clan, game facts only** — elixir-mcp is the system of record for GAME facts, elixir-bot for COMMUNITY facts; no code reuse between them. (2026-09-04; Jamie)
- **Gated, free beta** — access is by request and owner approval; launch is free, and any paid tier needs express Supercell approval. (2026-09-03, Decisions block; Jamie)
- **No blockchain, POAP or ENS; no Supercell marks** — the unofficiality disclaimer appears on every user-visible surface. (Decisions block; engineering)
- **Collections are owned editorial groupings** — never global tags; membership is a reason to record; adding something means recording it (ADDED = RECORDED). (2026-09-05, 2026-09-06; Jamie)
- **Roles never gate visibility** — the tiers differ only in slots and call volume; 50 player slots at every tier; `contracts/roles.ts` is the one source. (2026-09-05, 2026-09-08; Jamie)
- **Principals: users, agents, integrations** — an agent's tier is capped at its owner's; `on_behalf_of` grants nothing (explicit tag > on_behalf_of > primary); no `act_as` switching. (2026-09-08; Jamie)
- **Refuse rather than choose** — with no `clan_tag`, the door uses the primary claim's clan or refuses `not_recorded`, never an alt's clan. (2026-09-19; engineering)

## Privacy and measurement

- **Four buckets, SETTLED** — game data is public and recorded; your account is first-party; measurement is aggregate with "no per-recipient open or click, ever"; money is voluntary sponsorship that buys nothing. Never re-litigate. (2026-09-19; Jamie)
- **Product identifiers are not tracking identifiers** — a send id or call id is a pointer its holder can open, not measurement; supersedes "no per-recipient identifier in links" and the first footer pass. (2026-09-19; Jamie)
- **What we never do** — no ads, brokers, selling or sharing, engagement scoring, automation on read state, or commercial targeting from game data. (2026-09-19; Jamie)
- **Universal reads** — all recorded game data is readable by every approved account; account data stays private; supersedes the terms-review "own context only" rule. (2026-09-05; Jamie)
- **CR tags are not PII** — email is PII. (2026-09-08; Jamie)
- **Nicknames and machine labels are private** — the card name is a collector's only public name; public operator credit shows the primary player only. (2026-09-06, 2026-09-07; Jamie)
- **Analytics stays client-side Tinylytics** — never proxied through our API (#25 was reverted: "should have asked"); `/signin` loads no analytics. (2026-09-08, 2026-09-19; Jamie)
- **Name-pattern studies go through `{name_census}`** — counts and means only; nothing per player leaves the database. (2026-09-20; engineering)

## Tool contract and versioning

- **`packages/contracts` is the single source** — additive changes are a minor, a patch is a behaviour correction only, and an output-schema change is a patch that moves the fingerprint. (2026-09-10, 2026-09-17; engineering)
- **No deprecation window** — every client is first-party and updated in the same pass; breaking renames are batched into one major. Supersedes Phase 5's 30-day window. (2026-09-19 Phase 6; Jamie)
- **The 7.0.0 refusals are dropped** — no blanket mode refusal and no unbounded-window refusal or season default; supersedes the 09-22 intent. (2026-09-23 Closing out; Jamie)
- **Segment is required; the corpus is never a default** — "the population is named" on the six segment tools, and every corpus read carries a `population` block. Supersedes the 1.0.0 corpus default. (2026-09-19 Phases 3 and 6; Jamie)
- **One name, one meaning** — `day` not `date`; `arena` is `{id, name}`; snake_case; retired names are banned from `tools/list` and current docs by a test. (2026-09-19 Phase 6; engineering)
- **Meaning rides on the value** — caveats sit on the field (`elixir.caveat`) as enums explained once in a note; guards go beside the ambiguous field, never by renaming it. (2026-09-19, 2026-09-23; Jamie)
- **Stated conventions are schema** — `verbosity`, `days`/`weeks` and `season` are accepted on every tool that the instructions say they apply to; no `include_*` flags. (2026-09-15, 2026-09-18, 2026-09-20; engineering)
- **Every tool publishes an outputSchema** — required fields at the top level, every leaf nullable; it stays on `tools/list` for every principal. (2026-09-21 6.14.0; engineering)
- **Booleans are always emitted** — never only when true. (2026-09-21 6.13.0; engineering)
- **Descriptions are capped at 600 chars** — overflow goes to the docs page; every error carries a `class`; retry data is structured (`retry_after_s`). (2026-09-19 Phases 1 and 5; engineering)
- **Read-only tools race a deadline, writes never do** — the result is `query_timeout` with a request_id; a priced `result_too_large` is an answer, not a defect. (2026-09-19 Phase 1, 2026-09-21; engineering)
- **The war family's `clan_score` is war trophies** — `clan_war_trophies` is added; the old names are deprecated aliases for 7.0.0 ("one break, not two"). (2026-09-23 6.19.0; Jamie)
- **Omit the tag to mean yourself** — the server brief names the caller at initialize; `game_clock` is subject-free. (2026-09-08; Jamie)
- **The JSON API (`/api/v1`) is a public, versioned product beside MCP** — people call it by OAuth (audience `/api/v1`), integrations by key; a token for one door is never accepted at the other. (2026-09-23; Jamie)
- **Elixir Clan reads Elixir through `/api/v1`, never MCP, and is not metered** — Clan is a program, not an agent; first-party clients (every redirect on a family origin) are unmetered (plan: ../elixir-family/plans/clan-app-api.md). Clan may be broken meanwhile. (2026-09-23; Jamie)

## Tools and data semantics

- **The game day is the 10:00Z grid** — daily series and `days: N` resolve on it; the war clock follows the policy grid for every clan, with the observed offset reported raw. (2026-09-07, 2026-09-19 Phase 4; Jamie)
- **Windows** — an unbounded window is anchored at the first recorded battle; a date-only `to` covers that whole day; `applied.window` echoes season and `crosses`; the meta tools default to the current season. (2026-09-19 Phase 4, 2026-09-17; engineering)
- **`event_tag` is the discriminator** — a null tag is a permanent format grouped by `type`; a tagged battle belongs to its event; never pool across them; `trail` is event content (supersedes `trail`→casual and the pair design). (2026-09-22, 2026-09-22 6.17.0; Jamie model)
- **The meta population excludes event content and non-chosen decks** — decks a player did not choose are "not informing meta"; a null `deck_selection` is kept. (2026-09-22 6.17.0; Jamie)
- **Archetype grammar in code, vocabulary in data** — the grammar lives in `packages/contracts`; the vocabulary lives in cr-agent-api-docs and is kept by Understand Clash Royale; Elixir never merges candidates itself. (2026-09-20 6.5.0; engineering)
- **Archetype roles** — win condition, bait/bridge flags and `names_deck`; a new card, not a season roll, triggers a vocabulary review; CYCLE_MAX is 3.4 (measured). (2026-09-20 6.9.0, 6.10.0; Jamie)
- **Timeline shape** — a notification feed per subject, not an event stream; individual battles never appear, battle sessions do; the clock is the agent's, not the feed's (no `war_day_open`). (2026-09-13; Jamie)
- **The record is the trigger** — moments name the battle that did it and attach HOW; "absence over a guess"; replays and backfills write rows, never moments. (2026-09-15, 2026-09-16, 2026-09-17; Jamie)
- **A cutoff is not a floor** — a PoL board is Supercell's top-N cut; the horizon comes from the table and reads "unrecorded", not "unchanged". (2026-09-20 6.2.0; engineering)
- **Duration is a proven bound, never a timing** — both-negative trophy changes are a PoL draw, not two losses. (2026-09-22, 2026-09-23 6.18.0; engineering)
- **Labels go beside identifiers** — never instead of them; card levels use the 1-16 display scale via `displayLevel`; evolution forms never merge (`form: base|evolution|hero`). (2026-09-19, 2026-09-03; Jamie)
- **Verify is one battle** — a battle in the player's own log after the brief, with exactly the eight target cards; the target is their own deck with two cards swapped; `currentDeck` is useless as proof. (2026-09-12, 2026-09-13; Jamie)
- **Store UTC** — timezone is display only; SQL date boundaries say `at time zone 'UTC'` explicitly. (2026-09-03, 2026-09-23 Closing out; Jamie)
- **Tags are the only game IDs** — no surrogate keys; `claim` is the only join between accounts and game data; a claim unlocks history, it never migrates it. (2026-09-03; Jamie)
- **The badge corpus is the players recorded now** — a profile the record no longer polls is left out of badge questions over the corpus; "there is no practical way we could do otherwise". (2026-09-23; Jamie)
- **A week's donations are the highest counter value seen in its game days** — the counter only climbs until the weekly reset; never try to pin the reset minute. (2026-09-23; Jamie)

- **Players and clans known only from a battle stub are ghost entries, never metrics** — they exist to name an opponent and to seed history if recorded later; every metric counts recorded players (direct, or a member of a comprehensively recorded clan), clan segments included, and every headline count is recorded, with observed as the secondary line. (2026-09-23; Jamie)
- **A clan's profile aggregates carry each member's latest profile forward** — a member not polled that day counts with their last read, and `members_profile_carried` says how many. (2026-09-23; Jamie)

## Recording, collectors and rate budget

- **One global rate budget** — the fleet is redundancy, never quota multiplication; this is ToS posture, and the ceiling does not move. (Decisions block, 2026-09-10; engineering)
- **Zero-trust collectors** — no AWS access, Bearer config/lease/submit, and the server chooses the work; provisioning is reveal-and-copy of a one-time token. (2026-09-06; Jamie)
- **Releases are candidates until named** — naming promotes to Latest; `min_client_version` never refuses config, fails open on unparseable versions, and should not be "fixed". (2026-09-06; Jamie)
- **The session clock is the player schedule** — follow up 30 min after a productive read, double after an empty one, 2 h ceiling; profiles are read daily and after a session. Supersedes the yield clock, loss bound and roster gate. (2026-09-19; Jamie)
- **Roster `lastSeen` never gates battle logs** — it is a profile-efficiency signal only. (2026-09-13 Ratified at session close; Jamie)
- **Never manufacture a request to diagnose** — wait for the natural wave; errors never advance freshness. (2026-09-14; engineering)
- **Ingest never pauses on catalog integrity** — an unseen card is stubbed and healed ("Loading battles is more important than eventual catalog integrity"). (2026-09-15; Jamie)
- **The S3 payload archive is kept forever** — `payloads/` never expires and is the replay source; every payload field needs a manifest disposition, and the full audit gates a release. (2026-09-11, 2026-09-22; Jamie)
- **Backfills and imports** — each gets its own revocable gateway row; the elixir-bot DB is opened read-only; the recorder wins on overlap; never let an approximated stamp replace a real observation. (2026-09-15, 2026-09-18; engineering)
- **Collector points and `yield_24h` stay as they are** — points reward `new_facts > 0`; re-pointing was declined. (2026-09-21; Jamie)

## Schema and migrations

- **Migrations never rewrite a large table** — add the column, fill it with a keyset-batched op, index it in its own migration; never re-key a large rollup table or change a column type in place. (2026-09-15 INCIDENT, 2026-09-17, 2026-09-19 Phase 3; engineering)
- **Lock shapes take three migrations** — NOT VALID, then VALIDATE, then NOT NULL, each in its own file. (2026-09-17 Phase C; engineering)
- **Expand-and-contract** — drop a column only after no deployed reader has read it; the migrate Lambda is the only applier. (2026-09-21 0150; engineering)
- **Our enums are CHECKed, API enums stay open** — ingest must never fail on a value the game adds. (2026-09-15 Schema hygiene; engineering)
- **Cards are rows, not JSON** — fixed-shape JSON becomes typed columns; `deck_hash` stays the natural key. (2026-09-15, 2026-09-17 Phase E; Jamie)
- **The schema review and time-series decisions are ratified** — `season` keyed on `season_month`, `war_period` rows, day grain with last observation winning, and a war-id mismatch alarms but never relabels. (2026-09-17; Jamie)
- **A backfill that does not vacuum is not finished** — never run a backfill and a deploy together (migrate has reserved concurrency 1). (2026-09-22; engineering)
- **Live diagnostics only through migrate ops** — EXPLAIN the exact SQL the tool serves. (2026-09-15, 2026-09-17; engineering)

## Email

- **Send over SES, receive at Fastmail** — Fastmail "isn't for that"; never create SES address identities under the stack's domain. Supersedes Fastmail JMAP sending. (2026-09-16, 2026-09-17; Jamie)
- **Six kinds, at most one mail per person per day** — each kind is an account switch, default ON; bulk kinds need one-click unsubscribe; login mail is transactional with no unsubscribe. (2026-09-18, 2026-09-17; Jamie)
- **No per-user LLM mail** — Top 100 is the only LLM issue, one for everyone, written by Anthropic direct from a non-VPC editor, not Bedrock; "the builder computes and the model writes". (2026-09-18; Jamie)
- **No public issue page** — "sharing means forwarding the email". (2026-09-18 late; Jamie)
- **Pixel and utm on all mail** — the pixel names the mail, never the reader; owner notifications carry no pixel. Supersedes the pixel-free promise. (2026-09-18 late; Jamie)
- **Every send has an id and a record** — the footer links the record and one-click feedback, plus the sponsorship line; the relay logs the send id, never the recipient. (2026-09-19; Jamie)
- **Mail is composed by calling the tools** — never a second derivation; Buttondown stays Jamie's announcement channel only; newsletter is opt-out. (2026-09-18, 2026-09-07; Jamie)

## Web and site

- **The web is a record browser, not a BI platform** — "the agent is the analyst; the website's job is verification"; web and agent see the same registry. (2026-09-06, 2026-09-04; Jamie)
- **Adopt the ecosystem early** — React 19, TanStack, and Tailwind v4 in the shared kit; kit gaps are fixed in the kit, never copied; no Radix before a real dialog; no PWA ("just make it a mobile view"). (2026-09-13, 2026-09-06; Jamie)
- **Docs ship with the change** — the tool reference is generated from the registry; docs pointers must resolve before a tool names them. (2026-09-04, 2026-09-18 Phase 4; Jamie)
- **Activity year reads log coverage** — a rolled log never draws as zero; the 24×7 rhythm tile is removed. (2026-09-13, 2026-09-19; Jamie)

## Operations and AWS

- **Cost calls are Jamie's** — RDS stays db.t4g.micro (settled); account-wide spend never changes through an Elixir runtime change. (2026-09-13, 2026-09-21; Jamie)
- **Alarms go to the ops queue, never email** — Elixir application tags on everything; the dashboard is a stack resource pinned by a test. (2026-09-04, 2026-09-17; Jamie)
- **No Lambda-to-Lambda from the NAT-free VPC** — use a queue; metrics go out as EMF on stdout. (2026-09-18, 2026-09-06; engineering)
- **DNS stays at Namecheap** — Jamie applies records by hand. (2026-09-03; Jamie)
- **Collector-door cost is judged by route attribution** — no fixed baseline. Supersedes the check-in-era rule. (2026-09-22; engineering)
- **The database is db.t4g.small** — the micro ran out of EBS byte balance and memory under ordinary pre-launch load; the micro reservation still applies (size-flexible). (2026-09-23; Jamie)

## Agent team and process

- **The acceptance suite is the release gate** — "we run the risk of regression without it"; it is read-only, has its own token and bucket, and is skipped only with a WARNING. (2026-09-21; Jamie)
- **The Gym is a repo skill with standing authority** — fix and deploy each family's findings without asking, one contract bump per family round, no majors; it uses its own `gym` principal. (2026-09-23; Jamie)
- **Close the loop** — feedback is never actioned invisibly; acceptance means passing from the first call; every contract bump updates the changelog. (2026-09-05, 2026-09-18; Jamie)
- **Lease first** — every mutating actor claims the checkout lease; deploy from a clean worktree; use `&&`, never `;`, before push or deploy. (2026-09-06, 2026-09-13, 2026-09-19 Phase 3; engineering)
- **New indexes or tools must collapse a measured walk** — check audit claims against the calling client first. (2026-09-23; engineering)

## Declined, do not propose

- **Outcome ratings (Elo, Glicko, TrueSkill, Bradley-Terry)** — dead, because the matchmaker has already spent the information. (2026-09-19; Jamie)
- **"Elixir Lift", `adoption_cost` and playstyle or similarity scores** — they are the Pilot Score mistake again. (2026-09-19, 2026-09-21, 2026-09-14; Jamie)
- **Matchup expectations** — "the elixir-bot matrix was a mistake and does not come forward". (2026-09-20; Jamie)
- **Rhythm-placed battlelog polls** — they can't cut empty polls without over-capacity; a "unicorn hunt". (2026-09-19; Jamie)
- **Bulk live name resolution** — it drains the one CR budget for cosmetic strings. (2026-09-09; Jamie)
- **Importing bot judgment** (awards, decisions, memories, dossiers) — judgment belongs to the bot or Clan. (2026-09-15; Jamie)
- **Splitting `trail` into invented groupings** — "there must be some reason they are stored differently". (2026-09-22; Jamie)
- **WAF, RDS Proxy and Performance Insights** — cost exceeds the footprint. (2026-09-07; engineering)
- **A `war_week.season_id` FK and `card_pair_season`** — the FK would refuse API facts; `card_pair_season` blew the time budget. (2026-09-17; engineering)
- **Favourite-card or deck-slot verification** — neither proves control. (2026-09-12; engineering)
- **A lower full-verbosity page limit, `pvp_decks`, and a king-tower level comparison** — the data can't support them or the refusal already prices the retry. (2026-09-22, 2026-09-23; engineering)
