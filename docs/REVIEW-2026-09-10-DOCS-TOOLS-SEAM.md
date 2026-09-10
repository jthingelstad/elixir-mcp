# Review 2026-09-10: docs vs code, the tool surface, and the agent seam

Three questions from Jamie, answered against contract **0.43.0** (commit
`1df8694`): does the documentation cover what the code does; is the tool
surface consistent enough for an agent to learn; and where is the agent-to-MCP
seam leaving value on the table. Recommendations only. Nothing here is applied.

**Method.** Read every page in `apps/site/src/docs/`, the registry and all ten
tool modules, `packages/contracts`, the initialize/invoker/protocol layer, the
docs corpus builder, `docs/NOTES.md` (ratified decisions are not re-litigated
below), yesterday's `DOCS-GAP-2026-09-09.md`, and both first-party consumers
(`elixir-mcp-discord`, `elixir-bot/elixir_mcp.py`). Called eleven tools
read-only through this session's own connection as King Thing to see real
response shapes. Measured the published `tools/list`. Read the server's own
call log (`mcp_call_audit`, every request since the table began on
2026-09-03) through the migrate Lambda's read-only `audit_census` op, plus
the pending-feedback op and the MCP Lambda's CloudWatch log; Part 4 is what
the log says and it changed the priority of several items above it.

**Three things found on the way that are defects, not opinions:**

1. This session's cached tool list does not contain `elixir_docs`,
   `elixir_examples` or `elixir_updates`, deployed about six hours earlier.
   The cache-buster works as designed and the agent still cannot call the
   tools until its client re-initializes. Part 3.1 is about this.
2. `elixir_events` rows carry `at`; `events.md:30` and `agents.md:145`
   promise `created_at`. Verified live and in `tools/elixir.mjs` (the handler
   writes `at: r.created_at.toISOString()`).
3. `entitlements.mjs:268` tells an agent that "elixir_watch_clan requests
   recording". That tool was removed in 0.19.0. The hint reaches every caller
   who names an unrecorded clan.

---

## Part 1: documentation against the code

Yesterday's gap audit was field-level (every endpoint, limit and error code)
and the rewrite it drove is good. What remains is concept-level: things an
agent reading through `elixir_docs` needs and cannot find on any page, plus a
handful of statements the code has moved past.

### 1.1 Statements that are wrong today (fix without a decision)

| Where | Says | Reality |
|---|---|---|
| `protocol.md:226-228` | person 44, agent 41, integration 39 tools | 47 / 44 / 42. Hand-typed; `tools.agentCount` already exists as generated data and the same fix (a `tools.count` and a new `tools.integrationCount`) makes the table immune. |
| `tools.njk:50` | "Forty-four tools on one page is a wall" | 47. Use `tools.count`. |
| `events.md:30`, `agents.md:145` | event rows carry `created_at` | wire field is `at`. Fix the docs now (see 2.2.12 for the 1.0 option). |
| `protocol.md` cursors | `battles_query` cursor is opaque | it is `battle_time\|battle_id` in clear text. Say "treat as opaque" or make it so; a consumer will parse it otherwise. |
| `entitlements.mjs:268` | hint names `elixir_watch_clan` | `elixir_add_clan`. Code, but it is documentation an agent reads at the moment it needs it. |
| protocol "Machine-readable surfaces", quickstart, docs index | nothing about the three docs tools | 0.43.0 shipped self-documentation over MCP and no page says so. One row in the protocol table, one sentence in quickstart "Ask something" ("ask your agent to read the docs"), one entry under "For agents" on the index. |

### 1.2 Concepts that should exist and do not

Each of these is spread across tool `note` strings, one tool description, or
nowhere. The audience for a concept page is an agent that has just been asked
a question and is deciding what to call; a person reads the same page once.

**A. The battle model.** Nowhere on the site: the six `mode` groups and which
API battle types they fold (`modes.ts`: PvP→ladder, pathOfLegend→ranked,
trail/clanMate2v2/friendly→casual, riverRace*/boatBattle→war, challenge,
tournament); `type_class` pvp vs boat; duels as one row for up to three games
with crowns summed; what "decided" means (draws and unresolved excluded); "both
perspectives of every battle" and the `me` / `opponents` / `teammates` shape;
deck identity (`deck_hash` from card + form + tower troop, never level); the
form bit field; `tower_hp`, support cards, `league_number`, `arena`. Today an
agent learns "ladder = Trophy Road; ranked = Path of Legends" from one argument
description on one tool and the rest from `card_legend` and
`denominators_note` after the fact. Proposed: a `battles` page in *The record*
(or a first section of `recording.md`), with the mode table generated from
`modes.ts` so it cannot drift.

**B. Time and clocks.** One place for: `as_of` (computed) vs `observed_at`
(polled) vs `battle_time` (played); the 10:00 UTC policy day and why every
clan shares it; `war_day` 1-based and `day_in_week` 0-based; period, section,
week, season, Colosseum; ISO weeks in `group_by: week`; account timezone and
date-only arguments; `battle_time_local`; `trophies_as_of` being a date;
snapshot days; "observed between polls" for events. Today this is the 1,500
character `as_observed_note` that `war_current` repeats on every call, three
bullets in the protocol conventions, the integrations game-clock section, and
part of methodology. Proposed: a `time` page, or a "Clocks" section on
`protocol.md`, and the war note shrinks to one sentence plus a pointer.

**C. Subject resolution.** The precedence (explicit tag, then `on_behalf_of`,
then the primary claim) is in a code comment and half a protocol bullet. The
part nobody documents is that **the same argument name has a different
default across tool families**: `player_tag` omitted means *you* on the eleven
player-shaped tools and means *the whole corpus* on the five segment tools
(`battles_meta_decks`, `battles_meta_cards`, `battles_trends`,
`cards_synergy`, `badges_*`). Also: "your clan" is the primary player's clan,
an agent's clan comes from the agent record not a claim, `players_search`
ranking sources, nickname layering. Proposed: a "What omitting an argument
means" table in protocol conventions (player tools / clan tools / segment
tools / none), and the segment tools' first sentence saying "defaults to the
corpus".

**D. A glossary.** The service has its own vocabulary and `elixir_docs`
search is word-based, so a page that defines the words is directly what makes
search work: recorded, added, claim, relationship, primary, reason, scope
(activity/comprehensive), segment, corpus, decided, head-to-head, nod,
coalesced, policy day, points vs fame, boat, Colosseum, PoL, form, tenure,
pulse, live lane, collector, door, principal, budget account, capture gap.
Cheap; forty short entries.

**E. Choosing a tool.** The tools reference is exhaustive, not navigational.
Nothing says "start with `players_summary`; `battles_query` is the workhorse;
`battles_performance` for a window; `battles_decks` before `battles_query`
with a `deck_hash`; `clans_roster` once then `war_current`; `game_clock`
before deciding who to look at". The examples imply it. One hand-written page
of about forty lines, a table from question shape to tool, plus the three
canonical call sequences (how am I doing; scout a bracket; name to tag to
drill). This is the page an agent would read first through `elixir_docs`.

**F. Response shapes.** The largest structural gap and the one the field
audit could not fix by prose: `/docs/tools` documents inputs only. Every
response field (`decided_battles`, `share_of_battles`, `members_not_in_race`,
`seen_through`, `name_known`, ...) is learned by calling. Part 3.2 proposes
`outputSchema` on the declaration so the same generator that builds the tools
page can render "what comes back" and the contract validates it. Until then,
a golden response fixture per tool rendered under each tool heading is the
cheap version.

### 1.3 The docs as a corpus (they now feed `elixir_docs`)

- `architecture.md` carries a 50-line inline `<svg>`; the corpus builder
  passes it through, so an agent asking for the architecture page reads SVG.
  Strip `<svg>` blocks in `packages/docs/build.mjs` (keep the `aria-label` as
  a line of text).
- `tools.njk` and `docs-index.njk` are not in the corpus (only `.md` is).
  Their prose about scopes and "the families" is the only place some of it
  lives; move the scope paragraphs into `protocol.md` (mostly duplicated there
  already) so nothing is site-only.
- Search matches substrings per word, so "quota" finds "quotas" but "quotas"
  does not find "quota". A trailing-`s` strip on query terms is enough.
- `lede` is what the index returns; a few pages have a lede that is a slogan
  ("The short version: unofficial, best effort, be decent."). For the index an
  agent reads, `description` is the better field, or the lede should say what
  the page answers.

---

## Part 2: the tool surface

### 2.1 What is already right

Domain prefixes; shared `TAG_SCHEMA`, `ON_BEHALF_OF_SCHEMA` and window
descriptions by reference; a closed error taxonomy with hints that name the
fix; the meta envelope validated at two boundaries; strict schema validation
before the handler; every tool classified or the build fails; grouped titles
so clients that sort by title show the tree; the identity paragraph and
`_meta` principal block at initialize. These are the conventions. What follows
is where the surface has outgrown them.

### 2.2 Inconsistencies, each with a recommendation

**1. Four window idioms, five silent defaults, no uniform echo.**
`from`/`to` on 11 tools; `days` on `battles_levels`, `clans_standings`,
`clans_pilot_scores`; `weeks` on `battles_trends`; `seasons` on
`war_history`; `last_n_battles` on `battles_performance`. Defaults differ
silently: meta tools 28 days, standings 30, levels 90, trends 12 weeks,
summary a fixed 30, and `battles_decks` **unbounded** (the live call returned
217 all-time battles with `total_battles_in_window` and no bounds). The echo
of what applied is `filters_applied.from` here, `window_from`/`window_to`
there, `window_days`, `days`, `basis`, or nothing.
*Recommend:* every windowed tool accepts `from`/`to` (keep `days`/`weeks` as
sugar where they exist; additive), and every windowed response carries one
`window: { from, to, source: "argument" | "default" }` block. Highest-value
consistency fix on the list: an agent that cannot see the window it got will
quote an all-time figure as a recent one.

**2. One echo block instead of five.** `filters_applied`, `window`,
`segment`, `basis`, `limit_applied`, `sort`, `min_battles` are echoed
differently per tool and `limit_applied` by only three. *Recommend:* a single
`applied` object on every response (`window`, `limit`, `sort`, `mode`,
`segment`, `min_battles`, whatever the tool took), so "what did I actually
ask for" is one key everywhere. Additive; the old keys can stay a while.

**3. Same argument, different default (see 1.2.C).** `player_tag` omitted
means you or the corpus depending on the family. *Recommend now:* the segment
tools' descriptions open with "Defaults to the whole recorded corpus", and the
protocol conventions table says which families default to what. *At 1.0:*
consider `segment: { player_tag | clan_tag | collection }` as a nested object
on the five segment tools so the name itself says it is a scope.

**4. Three idioms for response size.** `summary: true` (`clans_roster`),
`verbosity: full | compact` (`battles_query`), `include_curve`
(`battles_levels`). Meanwhile `war_current` returns ~20 KB for a 49-member
clan (45 participants, then the same names again under `decks_today`),
`cards_catalog` and `players_collection` are unconditionally full. The
recorded war-deck nudge routine needs only `decks_today.counts` and the
`untouched` names. The log agrees (Part 4.3): average result bytes are
37 KB for `players_collection`, 35 KB for `cards_catalog`, 25 KB for
`live_fetch`, 15 KB for `battles_meta_cards`, 13 KB for `battles_query`,
11 KB for `clans_pilot_scores`, 10 KB for `clans_roster`. *Recommend:* `verbosity` as the one convention, added to
`war_current`, `clans_roster` (retire `summary` at 1.0), `players_collection`,
`cards_catalog`. Compact `war_current` = standings, period, counts,
`members_not_in_race`, no per-member lists.

**5. Fifteen names for explanatory prose.** `note`, `denominators_note`,
`as_observed_note`, `member_note`, `deck_note`, `weekly_note`, `mode_note`,
`scale_note`, `forms_note`, `range_note`, `card_legend`, `methodology`,
`decks_today_reason`, `completeness_note`, plus `notes[]` on `game_clock`.
Measured per call: `war_current` ~2,400 characters of stable prose,
`battles_performance` ~900, `elixir_coverage` ~700. The honesty machinery is
ratified and this is not a proposal to remove it. *Recommend:* one shape,
`notes: string[]` for caveats and `methodology: {}` for formulas
(`completeness_note` stays in meta because it is per-call and the envelope is
closed). Then, page by page, move the formula-level paragraphs into docs
sections (`elixir_docs` can now return one H2) and leave each tool a one-line
caveat plus `docs: "methodology#the-level-curve-and-pilot-score"`. The
trade-off is explicit: an agent that never reads docs loses the long form, so
the one sentence that must survive on the wire is the one that changes what
it says ("cite as observed so far, never as final").

**6. Annotations that disagree with behaviour.** `destructiveHint` is `false`
on every tool, including `collections_edit` whose `set` replaces membership
wholesale and stops recordings, and the two `elixir_add_*` tools whose
`remove` action releases claims. `elixir_events` is `readOnlyHint: false`
under `cr:read`; a client that auto-approves read-only tools will prompt on
every poll of the feed, which is the scheduled-routine case the tool exists
for. `players_profile({ live: true })` reaches the CR API but the tool is
`openWorldHint: false`. *Recommend:* `destructiveHint: true` on
`collections_edit`, `elixir_add_player`, `elixir_add_clan` (or split `remove`
into its own tool at 1.0); `readOnlyHint: true` on `elixir_events` (the
contract comment already argues the cursor is a bookmark); note the live flag
in `players_profile`'s description as open-world.

**7. `elixir_add_player({ action: "remove" })`.** An "add" tool that removes,
silences and re-scopes, with `make_primary` duplicating
`relationship: "primary"`. The console's ruled vocabulary is "Track a
player"; the docs say "add" and "recorded"; three words for one act.
*Recommend at 1.0:* `elixir_track_player` / `elixir_track_clan` with the same
actions and no `make_primary`. Not now: the 0.9.0 mass rename showed what a
rename costs clients that cache.

**8. Group is not prefix, and one group is a bucket.** `badges_*` sit in
Players; `game_clock` in War; `cards_synergy` in Cards while
`battles_meta_cards` is in Battles; `elixir_coverage` (about a player's
record) in Elixir MCP. The Elixir MCP group holds 16 of 47 tools: account
(`my_players`, `add_*`, `nickname`, `identify`, `my_identities`), feed
(`events`), feedback (`feedback`, `my_feedback`), help (`docs`, `examples`,
`updates`, `changelog`), service (`collectors`, `data_insights`), and
`coverage`. Group lives only in the title annotation and the site, so a
regroup breaks nothing. *Recommend:* Account, Feed, Help, Service as four
groups; `coverage` to Players. The family pages on the site follow for free.

**9. Two overloaded error codes.** `not_found` means "unknown to the record
and the live API" and also "no default player / `on_behalf_of` unmapped";
`bad_request` means "your input is malformed" and also "the result exceeded
48,000 characters" (the request was fine). Agents branch on the code.
*Recommend:* two additive codes, `no_subject` (hint: ask the human or pass a
tag) and `result_too_large` (hint: the narrowing arguments). Also: the daily
quota refusal (`-32029`) is the one refusal with no meta and no `request_id`;
DOCS-GAP item 6 already lists the three quota shapes.

**10. Argument naming.** Segment tools take `collection` (a slug);
`collections_get`/`collections_edit` take `slug`. *Recommend:* `collection`
everywhere a collection is referenced (alias now, retire `slug` at 1.0).
`tags` on `collections_edit` is mixed-kind by design; fine. `page`, `example`,
`badge`, `card`/`card_id` name the entity; fine.

**11. Limit maxima** range 20 to 300 with no rule. Fine as long as `applied`
echoes the limit (2.2.2). Consider one default for "list" tools.

**12. Timestamps.** `trophies_as_of` is a bare date; `battle_time_local` is
"2026-09-09 23:31:47 (America/Chicago)", a display string; event rows use
`at` where the rest of the surface uses `<thing>_at`. *Recommend:*
`battle_time_local` as ISO with offset; at 1.0, `at` becomes `created_at` on
events.

### 2.3 Conventions worth writing down, and enforcing

A short "Tool conventions" section in `docs/ENGINEERING.md`, with the
registry test extended to enforce the mechanical ones:

- **Names.** `<domain>_<noun>` for reads; `<domain>_<verb>_<noun>` only for
  writes. `*_tag` one tag, `*_tags` an array, `collection` a slug.
- **Defaults.** Player-shaped tools default to the caller; clan tools to the
  recorded clan; segment tools to the corpus; the first sentence of the
  description says which, in a fixed phrase.
- **Windows.** `from`/`to` on every windowed tool; `window` echoed with its
  source.
- **Echo.** One `applied` block.
- **Size.** `verbosity` is the only size control.
- **Prose.** `notes[]`, `methodology{}`, `docs` pointer; a note is one
  sentence; formulas live in docs.
- **Errors.** Closed set; every hint names one executable next step (tool and
  arguments).
- **Annotations.** `readOnlyHint` true unless account state visible to others
  changes; `destructiveHint` true if any action removes; `openWorldHint` true
  if any path reaches the CR API.
- **Declarations.** Description at most ~600 characters (today the longest is
  1,670; the mean is 420); shared schemas by reference; `limit` has a maximum;
  an `outputSchema` and one golden fixture per tool.
- **Test.** Windowed tools have `from`/`to`; `limit` has `maximum`; no
  top-level key matching `/_note$/` outside the convention; every tool in a
  group that exists in `GROUP_ORDER`.

---

## Part 3: the agent-to-MCP seam

**1. The cached tool list, seen from inside.** A stateless server cannot
push `listChanged`; the fingerprint in `serverInfo.version` and
`elixir_changelog` are the right design and they still leave the agent
unable to call a tool its client has not re-listed. This session is the
proof. Two additions that reach agents without waiting on clients:

- **Resources.** Publish the docs, examples, updates and changelog also as MCP
  resources (`elixir://docs/<slug>`, `elixir://docs/<slug>#<section>`,
  `elixir://examples/<slug>`, `elixir://changelog`), and declare the
  `resources` capability. Clients list resources lazily at read time rather
  than caching them at connect; Claude Code and Claude Desktop already expose
  list/read. Resources are the spec's primitive for reference material; the
  three tools stay for clients without resource support. Same corpus, one
  more reader.
- **Prompts.** Declare `prompts` and expose the eleven examples as prompt
  templates. Clients surface prompts as slash commands or quick actions, so a
  person who just connected sees "Win your river race" without reading
  anything. The transcripts already exist; a prompt is the question plus the
  setup hint.

**2. `outputSchema` and `structuredContent`.** Responses are JSON inside a
text block, which is fine for the model and invisible to everything else. The
2025-06-18 protocol lets a tool declare `outputSchema` and return
`structuredContent` alongside the text block. Doing so, incrementally from the
ten most-called tools, gives three things at once: the response contract
appears in `tools/list`, the docs generator can render "what comes back" under
every tool (Part 1.2.F), and the registry can validate a response the way it
validates the meta envelope today.

**3. Feedback is asked for and refused by default.** Not hypothetical: the
newest pending feedback item (id 30, filed 2026-09-10) opens by saying two of
its items were parked for a day because `elixir_feedback` itself answered
"Insufficient scope: required cr:read feedback:write". The instructions tell
every agent to file friction on its own judgment; an OAuth connection holds
`cr:read` unless the person ticked `feedback:write` on consent, so
`elixir_feedback` answers 403 with a step-up the popular clients do not
implement. The protected-resource document advertises `cr:read` only.
Precedent: `elixir_events` moved under `cr:read` (feedback #16) for the same
reason. *Product call for Jamie:* fold feedback under `cr:read` at the MCP
door (the scope can remain for the console), or pre-tick it on the consent
page. "Feedback is never metered" and "feedback needs a scope most grants
lack" are in tension.

**4. What the seam costs per session and per call.** `tools/list` is
55,467 bytes (about 14,600 tokens): 19,795 of description and 27,339 of
schema. The schema half is larger than the prose because the `on_behalf_of`
text (380 characters) is inlined into fifteen tools and the tag text into
eleven. Per call, the envelope is about 650 characters (disclaimer, quota,
polls), and the stable notes add up to 2,400 more on the war tools. *Not*
recommending touching the disclaimer (golden rule 10). *Recommending:* the
canonical explanation of `player_tag`/`on_behalf_of`/windows moves to the
instructions block once, and the per-argument descriptions shrink to one
line; the notes migration in 2.2.5. Together that is roughly a third of the
list and a quarter of a war response.

**5. Timezone for agents that serve many people.** Date-only arguments
resolve in the account's timezone; an agent's account has one timezone and a
Discord has many. Additive: an optional IANA `timezone` argument on windowed
tools, or a timezone stored with `elixir_identify` so `on_behalf_of` carries
it.

**6. The instructions block.** It already does the hard thing (identity
first). Two additions: name the three "start here" tools per kind (person:
`players_summary`, `battles_performance`, `elixir_events`; agent:
`clans_roster`, `war_current`, `elixir_events`), and tell the agent that the
manual is readable through `elixir_docs` (the block predates 0.43.0 and does
not mention it). The agent variant says "pull clans_roster ONCE"; now that
`summary: true` exists, say when the full roster is needed.

**7. Hints as executable next steps.** Most hints already name a tool. Make
it the rule (2.3) and it catches the stale `elixir_watch_clan` class by test:
every tool name that appears in a hint must exist in the registry.

**8. The two consumers.** `elixir-mcp-discord/src/prompt.js` still carries
the 0.37.0 workaround ("if a tool says no recorded clan, pass `clan_tag`
explicitly") for a defaulting bug fixed 2026-09-09; retire the block so the
prompt stops teaching the model to pass the tag. Its feedback sweep keys on
English phrases while the tool results now carry structured error codes; the
`tool_error` path could carry the code. `elixir-bot` pins `MAJOR.MINOR`
("0.43") and will warn on every additive minor, which is exactly the release
the contract says is safe; pin the major, or compare against the changelog's
`breaking` field.

---

## Part 4: what the call log says

`mcp_call_audit` holds every tool call the door has served. The 7-day and
30-day censuses are identical, so the table begins with the 0.9.0 rename
week: **2,727 calls, 2026-09-03 to 2026-09-10, from three accounts** (Jamie's
person account, the Discord agent, and elixir-bot on the person account).
That is the caveat on everything below: the log measures Jamie's own agents
under adversarial use, not beta users. It is still the only behavioural
evidence there is, and it moved five recommendations.

| Surface | Calls | Errors | Rate |
|---|---|---|---|
| `svc:elixir-mcp-discord` | 1,676 | 21 | 1.3% |
| `mcp` (OAuth, human-driven clients) | 762 | 43 | 5.6% |
| `svc:elixir-bot` | 127 | 33 | 26% |
| `web` (Explore) | 79 | 0 | |
| `svc:elixir-drop` | 68 | 0 | |
| `rest` | 15 | 0 | |

### 4.1 Polling is 56% of all traffic, and the hint built to prevent it never arrives

`elixir_events` (763 calls) and `elixir_my_feedback` (761 calls) are 1,524 of
2,727 calls, all from the Discord bot's 300-second tick. The events poll is
cheap (5 ms, 484 bytes). The feedback poll is not: the bot re-reads its whole
feedback ledger on every tick, 5.5 KB a time, about 4 MB a week, to discover
whether the maintainer has answered anything. `meta.feedback_responses_pending`
exists precisely so a consumer never has to do that, and **the bot cannot see
it**: only tools that build the full envelope through `buildMeta` (player,
battle and war subject tools) carry `events_pending` and
`feedback_responses_pending`. `elixir_events`, `game_clock`, `elixir_docs`,
`elixir_changelog`, `elixir_feedback`, `elixir_collectors` and
`elixir_data_insights` build a bare envelope. Verified on this session's own
`elixir_events` call: its meta has neither hint, while `players_summary` a
second earlier reported both. A consumer whose only regular call is the feed
is exactly the consumer the hint was for.

*Recommend (now):* stamp both hints in the invoker or protocol layer the way
`quota` already is, so every response carries them. Then the Discord bot
reads `elixir_my_feedback` only when the hint is non-zero. Quota consequence
worth writing on the agents page: this polling pattern costs about 218 calls
a day, 44% of a member-tier budget and 11% of a leader's; nobody noticed
because the owner is unlimited.

### 4.2 Five tools run close to client timeouts

| Tool | Avg ms | Max ms |
|---|---|---|
| `clans_pilot_scores` | 11,602 | 22,568 |
| `battles_levels` | 6,034 | 22,202 |
| `battles_meta_decks` | 5,564 | 17,747 |
| `live_fetch` | 5,195 | 12,265 |
| `clans_standings` | 3,812 | 8,369 |

elixir-bot's HTTP timeout is 15 seconds; the Discord bot's direct client
allows 20; hosted MCP clients typically allow 30 to 60. A call that times out
on the client side audits as a success on the server side, so the log cannot
show how often this already happens. The level curve is refit over a rolling
window on every call, which is the cost in the first two rows.

*Recommend:* materialise the level curve daily (a small table keyed by
window and mode) so the personal and clan Pilot Score tools read it; report
p95 latency per tool in the census and alarm when any tool's p95 exceeds ten
seconds; state expected latency on the tool reference for anything over two
seconds, since an agent that knows a call takes ten seconds does not fire
three of them in parallel.

### 4.3 Sizes, and one tool that cannot fit its own cap

Average result bytes: `players_collection` 37 KB, `cards_catalog` 35 KB,
`live_fetch` 25 KB, `battles_meta_cards` 15 KB, `battles_query` 13 KB,
`clans_pilot_scores` 11 KB, `clans_roster` 10 KB, `war_current` 8 KB (20 KB
on a war day, measured today). `live_fetch` was truncated on 4 of 25 calls
(16%), which is the raw battle log exceeding 48,000 characters; the live
fetch is spent, the CR budget is spent, and the caller gets a `bad_request`.
`cards_catalog` is a static 35 KB read five times this week by an agent that
wanted a card id.

*Recommend:* `live_fetch` refuses the `/battlelog` path before spending the
lane, with a hint naming `battles_query` (recorded) or a projected compact
form; `cards_catalog` gains `ids` / `query` filters and is also published as
an MCP resource (Part 3.1), which is what static reference data is for; the
`verbosity` convention (2.2.4) lands on the tools in this list first.

### 4.4 Where the errors are, and what the log cannot tell me

- `war_history`: 35 errors in 160 calls, 32 of them `invalid_tag`, on the
  elixir-bot surface (26% of that surface's calls fail). elixir-bot calls it
  with `{ player_tag, seasons: 2 }` from `_resolve_member_tag`, which passes
  any string starting with `#` through unvalidated. Its own logs hold no
  refusal lines for the week. **The audit row stores the bounded arguments,
  and no op exposes them**, so the single most useful thing in the log
  (what did the caller actually send) is unreadable without a deploy.
- `clans_roster`: 6 `not_entitled`, 4 `not_recorded`; `war_current`: 3
  `not_entitled`. The entitlement refusals are the agent-clan defaulting bug
  fixed 2026-09-09. The `not_recorded` refusals are the rival-scout routine
  doing the obvious thing: `war_current` names four rival clans and
  `clans_roster` on any of them fails, because bracket rivals are never
  recorded. `players_profile` has `live: true` for exactly this case;
  `clans_roster` does not.
- `battles_query`: 8 `bad_request` (plus 4 on the pre-rename name);
  `battles_meta_cards`: 4. Strict validation refusing something, most likely
  `limit` above 25 at full verbosity or two segment arguments at once.
  Arguments needed to say which.
- `players_timeline`: 2 `internal`. No `tool_failed_unexpectedly` line in the
  MCP Lambda's log for the last seven days, so they predate the 2026-09-09
  logging change. Unresolved.
- `live_fetch`: 7 `live_unavailable` in 25 (28%). The live lane is the least
  reliable tool on the surface; the 12-second deadline against an 8-second
  collector poll wait leaves little margin.

*Recommend (now):* an `args_census` op, read-only, that reports per tool and
error code **which argument keys were present** and the error message class,
never values, so "what trips strict validation" and "what did elixir-bot
send" are one Lambda invoke. `live: true` on `clans_roster` for the rival
case (the consistency point in 2.2 and the observed need are the same
change). The `war_history` refusal wants a look at elixir-bot's
`_resolve_member_tag` once the arguments are visible.

### 4.5 Never called

`players_names`, `badges_rarity`, `badges_holders`, `battles_opponents`,
`cards_synergy` (the five 0.39.0 tools, shipped 2026-09-09 for one agent's
eleven feedback items) have zero calls; so do `elixir_examples` and
`elixir_updates` (hours old) and `elixir_add_player` / `elixir_add_clan`,
which have never been called over MCP at all (every add went through the
console). One day is not a verdict on the 0.39.0 batch, but the feedback
ledger already records `shipped_in` and `related_tools` and nothing reads
them back against the audit.

*Recommend:* the census reports calls-since-ship for every feedback item
with a `shipped_in`, so "did the requester use it" is a query and the next
feedback batch is judged by adoption rather than by shipping. If the two
`add_*` tools are still uncalled after the beta, the MCP `recordings:write`
surface is a 1.0 simplification candidate (note only; not a proposal yet).

### 4.6 Smaller signals

- `elixir_my_players` was called 35 times by one account in a week the
  instructions have said "you do not need this". Either the client is not
  passing `instructions` to the model (several do not) or these are sessions
  cached from before 0.31.0. The audit has `client_name` since 0059 and the
  census does not group by it; a per-client breakdown would show which
  clients drop the instructions block and which fail scope step-up.
- The human OAuth surface's 5.6% error rate is the number that matters for
  the beta. Every refusal there is a wasted model turn. The argument census
  is how to bring it down before inviting anyone.
- Legacy names (`get_*`, `query_battles`, `cr_api_live`, `list_my_players`)
  stop on 2026-09-04, the rename day, and REST operation names
  (`game.clock`, `players.read`, `collections.members.add`) share the table
  under `surface: rest`. Harmless; the census should not list them beside
  MCP tools.
- `game_clock` is 2 ms and 809 bytes and was called 25 times by all three
  accounts: the "what day is it before who to look at" premise holds.

### 4.7 What `live_fetch` was used for, as far as the record can say

Jamie's framing: `live_fetch` is the catch-all for a one-time read; frequent
use is a signal that a tool is missing. The audit says 25 calls this week
(plus 6 under the pre-rename name `cr_api_live`, all on 2026-09-04), one
account, 7 `live_unavailable`, 4 truncated, average 25 KB, last call
2026-09-09 20:40Z. **It does not say which paths**: the arguments are in the
row and nothing reads them, the live lane writes no log line, and the
collectors log only "N jobs done". The job ledger's `lane = 'live'` column
would answer in one query and no op exposes it either. What follows is
triangulated from the S3 payload archive, where a receipt for a subject
nobody records can only have come from a live read.

| Path | Evidence | Reading |
|---|---|---|
| `/locations/global/rankings/players`, `/locations/global/pathoflegend/players` | 1 + 3 archived payloads (6 receipts), all 2026-09-05 05:16 to 05:22Z; the scheduler never polls rankings | Used once, on the day the paths were added for agent feedback #6, never since. Not a tool signal. |
| `/clans/{tag}` for this week's four bracket rivals (`#G2P0PPGQ`, `#L0Y2CJ8J`, `#QUGRGLU2`, `#YY20VJLU`) | exactly one `clan` receipt each, all 2026-09-08, no river-race receipts for any of them | The shape of a scouting routine that asked `clans_roster` about each rival, got `not_recorded` (4.4 counted those refusals), and fell back to a raw clan read per rival. **This is the tool gap.** |
| `/clans/{tag}/riverracelog` for eight clans nobody records | one receipt each, 2026-09-03 and 09-04 | Early scouting-report development under the old name; not recurring. |
| `/players/{tag}/battlelog` | the 4 truncated calls: a raw battle log is the only allowlisted payload that exceeds 48,000 characters | A "what did they just play" read that cannot be delivered through this tool at all; the live fetch and the CR budget are spent and the caller gets `bad_request`. |
| `/players/{tag}` | indistinguishable from bulk in the archive | The remaining ~10 calls; `players_profile({ live: true })` already covers this case, so any use here is the agent not knowing that. |

Attribution is unresolved (one account; the Monday rival reads fit the
Discord bot's `rival-scout` routine, but the person surface and Explore are
possible), which is itself the finding: three independent stores had to be
joined by hand to get a partial answer to "what is our catch-all being used
for".

**Signals for the surface, ranked by evidence:**

1. **An unrecorded clan has no tool.** `clans_roster` and `war_current`
   refuse anything not recorded; a rival is never recorded; the only path is
   raw `live_fetch`. `players_profile` already has the shape: `live: true`
   fetches any tag, records it opportunistically, spends one live fetch.
   Give `clans_roster` the same flag (recommended in 4.4; this is the
   second, independent line of evidence), and consider `war_current` too, so
   "what is the rival doing today" is a tool answer.
2. **Fresh battles have no tool.** The recorded log is the right answer
   ninety-nine times in a hundred (the reader cap keeps a read subject
   within an hour), but "right now" has no lane except a raw fetch that
   cannot fit the cap. Either refuse the path up front (4.3) or give
   `battles_query` a `live: true` that triggers one battle-log poll and
   returns the recorded, compact result. The second is the consistent
   design; the first is the cheap guard until then.
3. **Leaderboards are not a signal.** One burst on the day of the request.
   Leave the paths in the allowlist and do not build a tool.

**Keeping it rare.** Three small things make the intent enforceable rather
than hoped for: the census reports `live_fetch` share of calls per account
and per path (the argument census in 4.4 gives the path); the instructions
block names the recorded alternative for each allowlisted path in one
sentence ("profile: `players_profile(live)`; battles: `battles_query`;
clan: `clans_roster`; race: `war_current`") so the model learns the catch-all
is the last resort; and the tool's own hint on success carries the same
pointer when a recorded equivalent exists for the path just fetched. The
Discord bot's prompt already says "never more than once per post" and the
Monday pattern suggests four in one post; the server is the place to make
that visible.

---

## Part 5: staged, a material change to logging: capture the payloads

Jamie, 2026-09-10: the server should log not just the tool used but the
payload sent in and the payload sent back; this is bread and butter for
knowing how the product works and where to improve it; it should be visible
in the console, the call log clicking through to request, response and
performance metrics. Every investigation in Part 4 that ended in "the log
cannot say" ends differently with this in place. Staged here as a design,
not built.

### 5.1 What is captured today, and where it stops

`mcp_call_audit` holds one row per call: tool, arguments bounded to 4,000
bytes (top-level keys kept in order while they fit, the rest named in an
`_audit` envelope with a digest), `duration_ms`, `result_bytes`,
`truncated`, `error_code`, `request_id`, token, client name, viewer address
and country, surface. No response body. No breakdown of the duration. The
console's Activity page lists the rows; a notification id opens its body
(`/account/activity/n/<id>`); a call id opens nothing.

### 5.2 What to capture

Per call, keyed by `request_id`:

| Field | Source | Note |
|---|---|---|
| request: full arguments | invoker, after `redactArgs` | the existing key-name redaction stays; nothing in the surface takes a secret and the guard keeps it that way |
| response: full body | invoker, after the tool returns, before the cap check | the JSON the client received, including `meta`; on error the error body; on truncation the untruncated body plus the flag (the point of capture is to see what the cap ate) |
| JSON-RPC layer refusals | protocol layer | today a `-32029` quota refusal or a `-32601` hidden-tool refusal never reaches the invoker and so never audits; capture them as rows with no tool body |
| `duration_ms` | exists | end to end inside the handler |
| `db_ms`, `db_queries` | a timing wrapper on the `pg.Client` handed to the tool context | one connection, queries are serial, so the sum is exact |
| `live_wait_ms` | the live lane | time blocked waiting for a collector; null when no live fetch |
| `serialize_ms`, `result_bytes` | protocol render | how much of the wall time is the body |
| `cold_start` | Lambda init flag | explains the outliers in 4.2 |
| `principal_kind`, `on_behalf_of` (as given) | context | lets the census split person / agent / integration and count delegated calls |
| `contract_version`, `tools_fingerprint` | server | which surface the client was talking to |

### 5.3 Where to put it

Bodies do not belong in the audit row: `players_collection` averages 37 KB
and a partner tier is entitled to 15,000 calls a day. The house pattern is
already decided for raw observations: S3 is the system of record, Postgres
keeps the hot pointer. So:

- **S3, same archive bucket**, `calls/dt=<date>/request_id=<id>.json.gz`
  holding `{ request, response, timings }`, written after the response is
  sent (the ping already rides a `finally`; the body write joins it) so
  capture never sits in front of an answer. A failed write logs
  `call_capture_failed` and the audit row says `captured: false`; a call is
  never refused because capture failed.
- **Postgres**, additive columns on `mcp_call_audit`: `captured boolean`,
  `db_ms int`, `db_queries int`, `live_wait_ms int`, `serialize_ms int`,
  `cold_start boolean`, `principal_kind text`, `on_behalf_of text`, and the
  JSON-RPC-layer rows. Expand-and-contract; the existing bounded `args`
  column stays as the hot copy for the census.
- At today's volume (2,733 calls, average body under 6 KB) that is under
  20 MB a week compressed. At a busy beta (say 20,000 calls a day) it is
  tens of MB a day; lifecycle to Infrequent Access at 30 days as the
  payload archive does.

### 5.4 Retention and the privacy page

Recorded game data in a response is public-postured and kept indefinitely
elsewhere anyway. The account-scoped parts are the issue: `on_behalf_of`
ids, nicknames in responses, feedback text. The Limits table today says call
arguments are cleared after 90 days; the captured bodies should follow the
same rule (S3 lifecycle expiry at 90 days, `captured` flipped by the
housekeeping job), and the Privacy page's "operational records of your own
activity" paragraph gains one sentence saying the request and response of
each tool call are kept for 90 days and are visible to the account on
Activity. Docs ship with the change.

### 5.5 The console

- **Activity → Calls** stays the log table (one component, per the
  redesign). Each row's `request_id` opens **`/account/activity/c/<id>`**:
  the tool and when; the request as rendered JSON; the response as rendered
  JSON with the `meta` envelope folded and arrays collapsed past twenty
  rows; a metrics strip (`duration_ms`, `db_ms` / `db_queries`,
  `live_wait_ms`, `serialize_ms`, `result_bytes`, `truncated`,
  `cold_start`, `error_code`, quota after the call, client, country); and
  the sibling links: the same agent's previous and next call, and the
  feedback form pre-filled with the `request_id` (the thing the docs tell
  people to quote).
- **Admin → Across accounts** gets the same record over every account, plus
  the two census views this review kept wishing for: per-tool argument
  presence (which keys, how often, `live_fetch` by path) and per-tool
  latency percentiles with the `db_ms` split. Those are queries over the
  columns above; the bodies are only opened one at a time.
- A captured body is served from S3 through the web API with the same
  session check as the row; never a public URL.

### 5.6 What it unlocks, in this review's terms

Part 4.4's "what did elixir-bot send to `war_history`" is one click. Part
4.7's "what is `live_fetch` used for" is a group-by. The `verbosity` and
`window` echo proposals get measured before and after. Adoption of a shipped
feedback item is visible as real calls with real arguments. The response
shapes an `outputSchema` should declare can be derived from a week of
captured bodies rather than written from memory. And the next review starts
from evidence instead of triangulation.

### 5.7 Order of work

1. Migration (additive columns), the `pg` timing wrapper, the S3 writer in
   the invoker's `finally`, JSON-RPC-layer rows. One deploy; nothing
   user-visible yet.
2. The call record page and the Activity row link; the privacy and limits
   sentences in the same commit.
3. Admin census views and the housekeeping expiry.
4. Retire the 4,000-byte bounded `args` copy only if the census no longer
   needs it hot (probably never; it is small).

---

## What I would do, in order

**Now, no decision needed (defects).** Generated counts in `protocol.md` and
`tools.njk`; `created_at` to `at` in `events.md` and `agents.md`; the
`elixir_watch_clan` hint; "treat the cursor as opaque"; document the three
docs tools on protocol, quickstart and the index; strip SVG from the corpus;
retire the Discord bot's clan-tag workaround. From the log: stamp
`events_pending` and `feedback_responses_pending` on every response in the
invoker (4.1) and gate the Discord bot's feedback poll on it; refuse the
live `/battlelog` path before spending the lane (4.3); the `args_census`
op and a `client_name` breakdown in the existing census (4.4, 4.6).

**Next, additive and agent-facing (needs a nod, not a design session).**
The `window` and `applied` echo on every windowed tool; `verbosity` on
`war_current`, `clans_roster`, `players_collection`, `cards_catalog`; the
four-way regroup of Elixir MCP and `coverage` to Players; the three
annotation fixes; `no_subject` and `result_too_large`; `from`/`to` on the
`days` tools; the instructions additions; `resources` and `prompts`
capabilities over the existing corpus; the `notes[]`/`methodology` shape; the
glossary, battle-model, clocks and choosing-a-tool pages; `outputSchema` on
the top ten tools with the docs generator reading it; the conventions
section and its test. From the log: `live: true` on `clans_roster` (4.4);
a daily materialised level curve behind the two Pilot Score tools and a
p95-latency alarm (4.2); `ids` / `query` on `cards_catalog` (4.3);
calls-since-ship per feedback item in the census (4.5); the polling-cost
paragraph on the agents page (4.1).

**Staged as its own piece of work (Part 5).** Full request and response
capture with timing breakdown, the call record page in the console, the
admin census views, retention and privacy text. Jamie has asked for this;
it is sequenced first among the additive items because most of the others
are then measured rather than argued.

**At 1.0 (breaking, batch them).** `elixir_track_*` replacing `elixir_add_*`;
`collection` replacing `slug`; `created_at` on events; nested `segment` on
the segment tools; retire `summary`, `include_curve`, `make_primary` and the
fifteen note keys.

**Product calls for Jamie.** Feedback under `cr:read` at the MCP door; how
far the stable prose moves from the wire into docs; whether the war-day nudge
list should be names or tags in compact form.

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
