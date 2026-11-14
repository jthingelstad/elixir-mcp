---
slug: protocol
title: "Protocol reference"
description: "The wire contract for the MCP door: transport, error codes, the response cap, versioning and the tools/list cache-buster, cursors, and the meta envelope."
section: protocol
order: 2
navTitle: "Protocol"
icon: network
lede: "The MCP surface: transport, sessions, errors and versioning."
---

# Protocol reference

Everything a client author needs to connect without reading the source. The
tool surface itself is on [Tools](/docs/tools) (generated from the registry);
quotas and rate limits are on [Limits](/docs/limits); the response envelope is
on [Reading a response](/docs/responses).

## Principals and what each sees

`initialize` returns the same shape for every door; `kind` decides the tool
list.

| Kind | Door | Hidden tools | Tools listed |
|---|---|---|---|
| `person` | `/mcp` | `elixir_my_identities` | {{ tools.personCount }} |
| `agent` | `/a/<public_id>/mcp` | `elixir_my_players`, `clans_my_view` | {{ tools.agentCount }} |

The counts are generated from the registry at build time. Hiding is
enforced: calling a hidden tool answers JSON-RPC `-32601` with `data.kind`
and a hint. Do not rely on a cached `tools/list` from another kind of
connection.

Tools are declared in group order, then by title, so a client that keeps
server order shows the domains: {% for group in tools.groups %}**{{ group.group }}**{% if not loop.last %}, {% endif %}{% endfor %}.
The group rides each tool's title
(`Players · Player profile`); names never carry it, so regrouping breaks
nothing. One page per group is under [Tools](/docs/tools).

## `initialize`

```json
{ "protocolVersion": "2025-06-18",
  "capabilities": { "tools": { "listChanged": true },
                    "resources": { "subscribe": false, "listChanged": false },
                    "prompts": { "listChanged": false } },
  "serverInfo": { "name": "elixir-mcp", "title": "Elixir",
                  "version": "{{ tools.contractVersion }}+tools.3f1c9a2b7d4e", "websiteUrl": "https://elixir.poapkings.com/" },
  "instructions": "…",
  "_meta": { "elixir.poapkings.com/principal": { "kind": "person",
             "subject": { "type": "player", "tag": "#0GVJ9V", "name": "Birch Lantern" },
             "clan": { "tag": "#0G9J08", "name": "Tidewater" } } } }
```

`instructions` is prose tuned for the model and changes without notice;
never parse it. It is written to arrive whole in 2,048 characters, the most
some clients (Claude Code) hand the model, and in order of value: who you
are (your primary and your clan, or the clan an agent acts for; the other
players and clans you follow by name while they fit, otherwise counted, with
`elixir_my_players` for the list), the one-line rules that change an answer,
where to start, how to file feedback, and a pointer to the
[argument conventions](#argument-conventions) below, which it does not
restate. The same facts ride in `_meta` as data; see
[Reading a response](/docs/responses#knowing-who-you-are-connected-as).

Resources and prompts are declared beside tools because a
stateless server cannot push `notifications/tools/list_changed` and clients
list resources lazily at read time, so the documentation stays reachable when
a cached `tools/list` is stale:

| Method | Returns |
|---|---|
| `resources/list` | `elixir://docs` (the index), `elixir://docs/<slug>` for every page, `elixir://examples`, `elixir://examples/<slug>`, `elixir://changelog`, `elixir://updates`, `elixir://cards` |
| `resources/templates/list` | `elixir://docs/{slug}`, `elixir://docs/{slug}#{section}` (one H2 section), `elixir://examples/{slug}` |
| `resources/read` | Markdown for pages, sections and examples; JSON for the indexes, the changelog, the updates and the card catalog. An unknown URI is JSON-RPC `-32002` |
| `prompts/list`, `prompts/get` | the ten [examples](/examples/play) as prompts, each a user message carrying the example's question and the tools it uses |

Reading a resource spends no daily quota; the hourly rate limit still applies.

## Versioning and the cache-buster

`serverInfo.version` is `<contract_version>+tools.<fingerprint>`, where the
fingerprint is the first 12 hex characters of the SHA-256 of the declarations
your kind of connection receives. The server is stateless and never sends
`notifications/tools/list_changed` even though it declares `listChanged`;
compare `serverInfo.version` on every `initialize` and re-read `tools/list`
when it differs. `elixir_changelog({ since: "0.35.0" })` lists what moved,
newest first, with `tools_added` and `breaking` where relevant. Pages contain
up to 20 releases. Pass `next_offset` as `offset`, keeping `since` unchanged,
until `next_offset` is `null`; `total` counts all releases matching `since`.
Omit `since` to page through the complete history, or read the complete JSON
resource at `elixir://changelog`.

The MCP contract is versioned over what an agent reasons from, not the code.
A new capability (a tool, an argument, a field) is a minor. A correction is a
patch, including one that removes a field that proved unreliable: an agent
reads the current declaration, output schema and notes, so a missing field
simply withdraws a claim. A major marks a shift in the domain model, one that
changes what a task means. There is no deprecation window; a renamed or
removed field goes in the release that replaces it. Every response carries
`meta.contract_version`. `/api/v1`, Sign in with Elixir's one request, keeps
ordinary semver of its own ([Sign in with Elixir](/docs/sign-in-with-elixir#get-api-v1-me)).

## Errors

Three layers, each with a closed set.

**HTTP**: 401, 403, 405 and 429 as on [Connecting](/docs/connecting); 400 for malformed JSON, a batch or an
unsupported `MCP-Protocol-Version`; 500
never carries internals.

**JSON-RPC** (`error.code`):

| Code | When | HTTP |
|---|---|---|
| `-32600` | not a JSON-RPC 2.0 object, a batch, or an unsupported `MCP-Protocol-Version` | 400 |
| `-32601` | unknown method, or a tool hidden from this principal kind | 200 |
| `-32602` | unknown tool name, or unknown prompt | 200 |
| `-32002` | unknown resource URI | 200 |
| `-32029` | daily tool-call quota reached; message names the cap and "It resets at midnight UTC." | 200 |
| `-32003` | insufficient scope | 403 |

**Tool result**: a failed call is a normal `tools/call` result with
`isError: true` whose `content[0].text` is JSON, and no `structuredContent`
(which is held to the tool's `outputSchema`; an error envelope is not that
shape):

```json
{ "error": { "code": "not_recorded", "class": "subject", "message": "…", "hint": "…" },
  "meta": { "as_of": "…", "request_id": "…", "disclaimer": "…", "contract_version": "{{ tools.contractVersion }}" } }
```

| Code | Class | Meaning |
|---|---|---|
| `invalid_tag` | `input` | input failed tag normalisation; hint states the rule |
| `not_entitled` | `subject` | the caller lacks entitlement to the subject (clan tools, slots, identity binding) |
| `not_recorded` | `subject` | the subject is valid but nothing has been recorded for it; on a person's door with no `clan_tag`, also the primary player's clan when it is not recorded (the default never slides to an alt's clan; the hint names the clan and the following call) |
| `not_found` | `subject` | unknown to the record and to the live API; an unknown docs page, example |
| `no_subject` | `subject` | nothing to answer about: no primary player on the account, a primary player in no clan when `clan_tag` is omitted, an `on_behalf_of` nobody has linked, an agent with no recorded clan. The hint names what fixes it (`elixir_follow_player`, the person connecting Discord in their Settings, or pass the tag). With `display_name` beside an unknown `on_behalf_of`, `error.candidates[]` lists the clan members whose whole name matches (`player_tag`, `name`, `clan_tag`, `role`; case and spacing ignored, never a partial match), so one candidate is that `player_tag` on the next call and zero or several is a question |
| `quota_exceeded` | `budget` | a per-account slot or live-fetch cap; the daily call quota uses `-32029` instead |
| `live_unavailable` | `server` | the live lane is not configured, or the fresh payload was refused at admission |
| `live_pending` | `retry` | `live: true` found no read inside the API's cache window and queued one (or, with the shared budget spent until the next tick, queued nothing and charged nothing); nothing is recorded for the subject yet, so there is no answer to give now. `error.retry_after_s` (an integer, seconds) says when to call again |
| `bad_request` | `input` | structurally invalid input other than tags: unknown enum, inverted window, over-max limit, bad cursor, unknown timezone |
| `result_too_large` | `input` | the request was fine and the result exceeded the delivery cap; the hint names the narrowing arguments. Also what `live_fetch` answers for a battle-log path, before spending the lane |
| `query_timeout` | `retry` | an analytical read exceeded its cancellable query budget; no analytical result is returned. Retry the named call after a few seconds or narrow its `from`/`to` window; report `meta.request_id` if it persists. |
| `internal` | `server` | the arguments were accepted and the server failed. Retrying the same call once is reasonable; if it fails again, report `meta.request_id` with `elixir_send_feedback` |

Every code is one branch: the message is for a person, the hint names one
executable next step (a tool and its arguments), and an agent should never
have to read the message to know which case it is in. Check the error body,
not only the transport flag; `meta.request_id` identifies the call for a
report.

**`class`** is the one word a consumer branches on without
knowing the code list: `retry` is not a failure of the call (call again:
`live_pending` after `retry_after_s`, `query_timeout` after a few seconds or
with a narrower window); `input` means the call is wrong as sent; `subject`
means the call is fine and there is nothing to answer about; `server` means
the server failed and `meta.request_id` is what to report; `budget` is a
quota. Every code has exactly one class (`ERROR_CLASS` in the contracts
package), so `live_pending` is never a failed call. Transport-level refusals (the rate limit, a
database that will not connect) carry the same envelope and class.

The heavy MCP reads `clans_standings` and
`war_history` each have a query budget of **at most 18 seconds per call**,
shortened if Lambda has less time remaining. It covers the whole aggregation,
not a fresh allowance for each query. PostgreSQL cancels the work before the
25-second Lambda ceiling so the tool can return `query_timeout`, a retry hint
and `meta.request_id`, and audit the failed call. This is not a latency promise:
a long history read can still exhaust the budget under load. Smaller
`limit` values trim output, not the population scanned; narrow `from`/`to` to
reduce work.

## The response cap

A result over **48,000 characters** of compact JSON is not delivered sliced.
The body is replaced by a `result_too_large` error, "Result is N
characters; the cap is 48000.", with a hint naming the tool's narrowing
arguments and, where the tool has it and the call was not already compact,
`verbosity: "compact"` (or, for a tool without any, asking
you to report the `request_id`). The original `request_id` is preserved and
`isError` is set. The size of a page depends on what its rows hold (a full
`battles_query` page carries both sides' decks), so it cannot be predicted
up front; when the call had a `limit`, the hint also says how large the page
was and **which `limit` would have fit** the same arguments, so one retry
replaces a guessing loop. `battles_query` refuses `limit` above 25 unless
`verbosity: "compact"` for this reason, and `live_fetch` refuses a
`/players/{tag}/battlelog` path with the same code before spending a live
fetch, pointing at `battles_query({ live: true })`.

## Argument conventions

The same conventions hold on every tool; the `initialize` instructions state
them once and the per-argument descriptions are one line each. The shorter
version, with the tool map, is [Choosing a tool](/docs/choosing-a-tool).

**What omitting a subject argument means** depends on the tool's family, and
the first sentence of every description says which. Every read names a
player or a clan: no tool reads the whole record.

| Family | Subject argument | Omission rule |
|---|---|---|
| Player tools (`players_*`, `battles_query`, `battles_performance`, `battles_decks`, `battles_cards`, `battles_opponents`, `elixir_coverage`) | `player_tag` | the caller: a person's primary player, or whoever `on_behalf_of` maps to on an agent connection |
| Clan tools (`clans_*`, `war_current`, `war_history`, `war_rivals`) | `clan_tag` | a person's primary player's current clan (refused `not_recorded` when that clan is not recorded, `no_subject` when the primary is in no clan; never an alt's, a friend's or another followed clan), an agent's clan |
| `game_clock`, `cards_catalog`, the Help tools | none | no subject at all |

No default is ever looked up first, and there is no "no default" guess: a
player tool with nothing to answer about is `no_subject` with the fixing call
in its hint.

- **Tags.** `#` plus 3 to 12 characters from `0289PYLQGRJCUV`. Input is
  trimmed and upper-cased, a missing `#` is added, and the letter O folds to
  zero. Anything else is `invalid_tag`. `*_tag` is one tag, `*_tags` an
  array.
- **`on_behalf_of`** (≤200 chars, opaque) selects the end user on an agent
  connection; ignored on a personal one, where the caller is always the
  primary player. A personal connection's `tools/list` leaves it and
  `display_name` out, and drops either if a client still sends it. On an agent, `discord:<id>` resolves through the person's Discord link; `elixir_my_identities`, which lists an agent's older mappings, is agent-only. An empty `player_tag` is refused as
  a caller bug, never treated as "default". See [Agents](/docs/agents).
- **Validation is strict**: arguments are checked against the
  published `inputSchema` before the handler runs. An unknown enum value, an
  inverted date window, or a `limit` above the declared maximum is
  `bad_request`, never clamped or emptied.
- **Windows** are `from` and `to` on every windowed tool: an ISO instant,
  or `YYYY-MM-DD` resolved in the account's timezone, where a date-only `to`
  covers that whole day. The battle and aggregate reads take `from`
  inclusive and `to` exclusive; the daily series count whole game days, both
  ends included (an instant is floored to its game day, and the response
  says so); `elixir_timeline` selects over (`from`, `to`] (below). `days` and
  `weeks` (and `seasons` on `war_history`) are sugar for `from`, and
  `season` bounds one season on every windowed tool. The per-tool defaults
  are on [Time and clocks](/docs/clocks#windows-and-timezones).
- **`timezone`** on any windowed tool is an IANA zone for that call alone:
  it resolves the date-only bounds and every local label
  (`battle_time_local` is ISO 8601 with its offset). Default: the account's
  timezone. An unknown zone is `bad_request`.
- **`applied`** is the one echo block, on every response except six
  (`elixir_my_players`, `elixir_my_identities`, `elixir_coverage`,
  `elixir_collectors`, `elixir_examples` without an
  `example`, and `elixir_docs` without a `page`): `window` (`from`,
  `to`, `source` of `argument` | `default` | `unbounded` | `season` |
  `fixed` (and `pointer` on `elixir_timeline`), `timezone`, and on the season-grained tools `season`,
  `crosses` and `season_age_days`), `limit`, `sort`, `mode`,
  `min_battles`, `verbosity`, as used. There are no `filters_applied`, `window_*` or
  `limit_applied` keys.
- **`verbosity: full | compact`** is the one size control, accepted on
  every tool. Where `compact` changes the answer the description says what
  it drops; a tool with one size says so in a note and answers in full.
  There is no other flag for size.
- **`notes[]` and `docs`** ride every response: one-sentence caveats to
  repeat, and a `page#section` pointer into this documentation
  (`elixir_docs({ page, section })` or `elixir://docs/<page>#<section>`).
  Formulas live in the docs, never in a note.
- **Timestamps** in responses are ISO 8601 UTC with a trailing `Z`;
  `meta.timezone_applied` names the display zone when local labels were used.
  Timeline items carry `at`.
- **Null is unknown, never zero**: a source never polled has `observed_at:
  null` and `freshness_seconds: null`; a member with no race row has `null`
  war decks, not `0`; a destroyed tower is `0` and unreported tower data is
  `null`.
- **Cursors.** `battles_query` returns `next_cursor` (`null` means the end).
  Treat it as opaque: pass it back unchanged, never parse or construct one; a
  forged or stale cursor is `bad_request`. `elixir_timeline` uses instants:
  `from`/`to`, and `next_cursor` is the window end you just read.
- **`live: true`** on `players_profile`, `clans_roster`, `war_current`,
  `battles_query` asks for a read no older than the
  API's cache. Asynchronous: fresh if in hand, otherwise queued
  and answered now from the record with `live_status: { state:
  "pending", retry_after_s }`; call again after that. A new live read
  spends one request of the fleet's one global budget; when that budget is
  spent until the next scheduler tick nothing is queued or charged,
  `live_status` stays `pending` with `retry_after_s` the seconds to that
  tick, and the note says the budget had no room. A `war_current` read in
  the minute or two after a season roll, before the new race is matched,
  answers `live_status: { state: "matchmaking", fetched_at, retry_after_s }`:
  no race yet, never an error. The tools are annotated `openWorldHint`.
  `elixir_timeline` windows work differently: over (from, to] at the
  millisecond it serves, by when an item happened (`occurred`) or when the
  record learned it (`observed`), so a cut instant passed as `to` reaches the
  item at the cut.

## Identifiers the record uses

- **`deck_hash`**: SHA-256 hex of `sort(cards.map(c => id + ":" + (evolutionLevel ?? 0))).join(",") + "|" + (towerTroopId ?? 0)`.
  Card form (`evolutionLevel` 1 = Evolution, 2 = Hero, absent or 0 = base)
  is part of identity; card levels and star levels are not.
- **`battle_id`**: SHA-256 of the canonical battle time, the sorted
  participant tags, and the battle class; the same battle seen from two
  logs is one row.
- **`request_id`**: a UUID minted before the tool runs and stamped into
  `meta`; the same id appears under Settings › Usage and limits › Requests.

## Feedback and the changelog, over the wire

Feedback is one record for all of Elixir: an item filed here, from
Settings, Stats, Clan,
the docs or an email's footer lands in the same queue, is answered there,
and is listed by `elixir_my_feedback` wherever it was filed.

- `elixir_send_feedback({ message, category?, context?, request_id?, request_ids?, refs?, follows_id? })`: `message`
  1 to 8000 chars; `category` one of `general` (default), `bug`,
  `data_quality`, `feature`, `praise`, `judgment` (Elixir judged someone
  wrongly), `other`. `request_id` is the
  `meta.request_id` of the call the feedback is about. Every response
  carries one, and passing it attaches that exact request, its arguments and
  its answer to the report, so the maintainer sees what you saw.
  `request_ids` (up to 20) carries every call a turn made when there were
  several; the first becomes `request_id` when that was omitted. `refs`
  (up to 20, with the calls) points at anything else it is about:
  `{ kind, ref }` with kind `email` (a send id from a mail's footer),
  `feedback` (one of your own `feedback_id`s this item belongs with, such
  as another facet of one review; it is a link, not a reply), `player` or
  `clan` (a tag), or `clan_action`, `award`, `policy` (Clan's
  ids). Only your own calls, emails and items attach; a pointer that is
  malformed or not yours is dropped and named in `notes`, and the report
  is kept. `follows_id` names one of your own items this one follows, so
  the thread reads as one: a reply to an answer, the answer to a
  `needs_info` question, or a correction to something you filed (a
  filed item is not withdrawn; a correction that follows it says what was
  wrong, and the answer covers both). `context` stays free text for
  naming a tool or a question. Filing counts as one call against the
  daily quota, like any tool call.
- Agent connections only: an agent relaying a person's feedback also
  passes `on_behalf_of` (the person on its surface, e.g. `discord:1234`);
  it is kept with the report, and the answer still comes to the agent. A
  personal connection is its person's own, so its schema has no
  `on_behalf_of`: what it files is already that person's.
- `elixir_my_feedback({ feedback_id?, limit?, offset?, status?, since?, area?, verbosity? })`:
  `status` one of `new`, `seen`, `planned`, `needs_info`, `done`,
  `declined`; `area` one of `mcp`, `api`, `console` (the website, Stats and
  Clan aside), `ladder` (Stats), `clan`, `mail`, `docs`, `recorder` (where it
  was filed). Returns each item's
  `area`, `refs` and `follows_id` when it has them, `response`,
  `responded_at`, `shipped_in`, `related_tools`. Pages are bounded by
  delivered size as well as `limit`, so follow `next_offset` with the same
  filters until it is `null`; `total` counts the filtered ledger. Only
  replies delivered on that page are marked seen, and
  `meta.feedback_responses_pending` stays raised while another response
  remains unread. `verbosity: "compact"` is the listing: each item's
  `feedback_id`, `created_at`, `area`, `category`, `title` (the
  message's first line), `status`, `follows_id`, `related_ids`,
  `has_response`, `responded_at` and `shipped_in`, with no bodies, so a
  50-item page fits and nothing is marked seen. `feedback_id` reads one
  item whole, with `followed_by` (your items that reply to it) and
  `related_by` (your items that name it as related), and marks its answer
  seen. `needs_info` means the answer is a question for you: reply with
  `follows_id`, and the reply is answered in its turn.
- `elixir_changelog({ since?, limit?, offset? })`: entries `{ version, date,
  summary, tools_added?, breaking? }`, newest first. `limit` is 1 to 20
  (default 20); `offset` defaults to zero. Follow `next_offset` with the
  same `since` to reach every entry; `null` means the end. `total` is the
  number matching the exclusive `since` filter.

## Machine-readable surfaces

Over the connection itself, three read-only Help tools serve this
documentation from the same sources the site renders: `elixir_docs` (the
index; one page by slug; one H2 section with `page` + `section`; or a word
search with `query`), `elixir_examples` (the ten worked examples with the
tools each calls) and `elixir_updates` (What's new, newest first, `since` a
date). The same text is reachable as resources at `elixir://docs`,
`elixir://docs/<slug>`, `elixir://docs/<slug>#<section>`, `elixir://examples`,
`elixir://examples/<slug>`, `elixir://changelog`, `elixir://updates` and
`elixir://cards`, and the examples as prompts. Over plain HTTPS:

| URL | Contents |
|---|---|
| `/llms.txt` | this site in one page: docs index, tool list, endpoint |
| `/llms-full.txt` | every documentation page and the full tool reference in one fetch |
| `/tools.json` | the registry as JSON: name, group, description, arguments, required scope |
| `/docs/integration-api.json` | the OpenAPI 3.1 document for `GET /api/v1/me` ([Sign in with Elixir](/docs/sign-in-with-elixir#get-api-v1-me)) |
| `/updates` | every shipped change, contract versions included - the same list `elixir_changelog` returns, with the releases around it |
| `/feed.xml` | RSS 2.0 of What's new: the newest 50 updates and contract versions, each item's id its own `/updates/<slug>` page |
| `/feed.json` | the same items as JSON Feed 1.1 |
| `/api/public/stats`, `/api/public/status` | live counts of what the recorder holds and recording health, no authentication, cached at the edge for the time each states in `Cache-Control`; they name no player or clan, except that each collector is credited to its operator's primary player |
