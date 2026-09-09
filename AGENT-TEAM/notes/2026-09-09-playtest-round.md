# Playtest round, 2026-09-09 (agent-in-the-loop, five strangers)

Method: `docs/NOTES.md` line 158. Five fresh-context subagents, no
implementation knowledge, no repo access, bounded at ~12 tool calls and one
`live_fetch` each, returning structured feedback. Contract at test time
**0.39.2** (the brief said 0.38.x; the roster was already current, including
the 0.39.0 tools, so no reconnect was needed).

Personas: casual player ("how am I doing"), deck tinkerer, clan leader (war day
+ quiet-member check, POAP KINGS connection), data-honesty nerd (cross-tool
reconciliation, both connections), adversarial edge-poker.

Game state during the window: season 136, week 1, `day_kind: "training"`,
`war_day: null`. The clan leader therefore ran a war day that was not one -
which turned out to be the most productive accident of the round.

## Round-level caveat: the harness load-tested the service

Five agents running concurrently drove far more traffic than the "handful of
requests a minute" `infra/template.yaml:404-409` cites as measured load. The
result was a cascade of bare 500s and Cloudflare 502s that cost roughly 14 of
the round's ~60 calls and blocked most of the adversary's intended probes.

This is a real finding, not just harness noise - five concurrent users is not an
unreasonable load for a public service - but it means:

- Two personas inferred **wrong root causes** from the failure pattern (see the
  rejected lane). Their friction reports are still valid; their diagnoses are not.
- The adversary's edge-case grades describe the message a user receives today,
  not the validation logic behind it. **Those probes need a re-run on a quiet
  service** before the error surface can be judged.

Not done: the method asks for objective `mcp_call_audit` error/truncation rates
across the test window. RDS sits in a private VPC and is unreachable from this
session, so the rates below are counted from agent transcripts instead.

## Lane 1 - fix now (each verified against handler source)

### F1. A bare 500 escapes the error envelope: `db.connect()` sits outside the try
`services/mcp/src/handler.mjs:151-152` (same shape at `:88-90`).
`new pg.Client(...)` and `await db.connect()` are **above** the `try {` at
`:153` whose `finally` calls `db.end()`. A connect failure escapes the handler
entirely, so the caller gets `{"message":"Internal Server Error"}` with no
`error.code`, no `hint`, no `request_id`, no `contract_version` - while every
success carries a full `meta`. All five personas hit it. The adversary graded 8
of 11 probes unusable and could not distinguish "my input is malformed" from
"the service is down", which is the most expensive property an error surface
can have.

Why it fires: one `pg.Client` per invocation against `db.t4g.micro`, 20
reserved concurrent executions, 25s timeout (`infra/template.yaml:440-448`).
The template comment at `:404-409` predicts this exactly - "unbounded Lambda
concurrency makes the DATABASE the thing that fails first."

Fix: wrap acquisition in try/catch and render the contract envelope
(`live_unavailable` is the closest existing code) with `request_id` and a
retry hint; guard `db.end()` for the never-connected case.

Regression sketch: stub a client whose `connect()` rejects; assert the response
body parses as `{error:{code,message}, meta:{request_id}}` and that no
unhandled rejection escapes the handler.

### F2. The 429 body bypasses the error envelope
`services/mcp/src/handler.mjs:299-302` returns
`JSON.stringify({ error: "rate_limited" })` - `error` as a bare string, no
`meta`, no `request_id`, no `Retry-After`. Every other refusal in the service
uses `{code, message, hint}`.

Fix: render the contract envelope with `quota_exceeded` and add `Retry-After`.

Regression sketch: drive `checkRateLimit` past `HOURLY_RATE_LIMIT` (300,
`services/mcp/src/quota.mjs:20`); assert the 429 body parses as the contract
error envelope with `error.code === "quota_exceeded"`.

### F3. `three_crown_rate` mixes duel and head-to-head crown units
`services/mcp/src/tools/battles.mjs:535` counts
`count(*) filter (where crowns = 3)` with **no `type_class` filter**, while
`decided_wins`/`decided_losses` six lines above (`:529-530`) carefully filter to
`type_class = 'pvp'`. The same tool's `card_legend` (`:436`) states that duel
rows "collapse up to three games: crowns SUM across rounds (up to 9, never
comparable with a 0-3 head-to-head row)."

So a duel that scored 1+1+1 across three rounds - possibly a **loss** - is
counted as a three-crown victory, identically to a genuine 3-0 sweep. The
denominator (`:552`, `row.battles`) additionally includes draws, boat and duel
rows. The service documents this exact unit-mixing hazard for
`crowns_for`/`crowns_against` and then commits it in `three_crown_rate`.

Material, not theoretical: King Thing shows `duel_battles: 34` of
`battles: 246` (14% of rows).

Fix: filter the numerator to `type_class = 'pvp'`, divide by `decided`, and
state the denominator in `denominators_note`.

Regression sketch: fixture with one 3-0 pvp win, one duel row carrying
`crowns = 3` across three rounds, one boat row. Assert `three_crown_rate`
counts only the pvp sweep over decided pvp battles.

### F4. `denominators_note` misstates the win_rate numerator; `decided_wins` is discarded
`services/mcp/src/tools/battles.mjs:713-714` says
"win_rate = wins / decided_battles". The implementation (`:548-549`) is
`decided_wins / decided`, which is **correct** - but the exposed `wins` field
includes boat wins, so the documented formula does not reproduce the returned
number whenever `boat_battles > 0`. `decided_wins`/`decided_losses` are computed
at `:529-530` and then destructured away at `:540`, so a caller cannot verify
the rate at all.

The data-honesty persona spent its deepest reconciliation here and could not
close it, concluding a possible 0.8-point swing. The number was right; the
documentation made it unverifiable.

Fix: correct the note to `decided_wins / decided_battles` and return both
fields.

Regression sketch: fixture containing a boat WIN; assert `wins > decided_wins`,
`win_rate === decided_wins / decided_battles`, and that both fields are present.

### F5. Deck responses drop the form discriminator that is part of deck identity
`packages/contracts/src/deck.ts` defines `deck_hash` over sorted
`cardId:evolutionLevel` pairs **plus the tower troop id**, and states outright
that "form discriminators are part of identity". But three renderers emit only
`{id, name}`:

- `battles_decks` - `services/mcp/src/tools/battles.mjs:882`
- `battles_meta_decks` - `:983-986`
- `battles_cards` - `:787-794` (silently merges forms into one card row)

`battles_meta_cards` (`:1135`) *does* expose `evolution`, so the corpus
disagrees with itself. The tinkerer hit two decks with visually identical cards
and different hashes (`ce06788a…` vs `d6fb5ddb…`), found no field explaining the
split, and nearly filed it as data corruption. It also spent the session
believing it ran a base-card deck when it runs Evo Witch and a Hero Mini P.E.K.K.A.

Fix: include `evolution` (when > 0) in all three renderers and surface the
tower troop on deck rows.

Regression sketch: two decks differing only in `evolutionLevel`; assert
distinct `deck_hash` **and** visibly distinct `cards[]` in `battles_decks` and
`battles_meta_decks`.

### F6. `war_history` documents a field that only exists under `player_tag`
`services/mcp/src/tools/war.mjs:499` describes `war_days_battled`
unconditionally, but the field is produced only at `:458`, inside the
`if (focus)` block opened at `:427`. `war_history({seasons: 2})` therefore
returns a note describing a field absent from every object in the response. The
leader went looking for it specifically because the note named it.

Fix: make the sentence conditional, or say "when player_tag is supplied".

Regression sketch: assert the no-`player_tag` response note omits
`war_days_battled`.

### F7. `war_current` on a training day is shaped exactly like a total no-show
`services/mcp/src/tools/war.mjs:353` spreads
`...(decksToday ? { decks_today: decksToday } : {})`, so on a non-war day the
key is simply absent - not `null`, no reason. Meanwhile the payload hands a
leader 44 rows of `points: 0, decks_used: 0, boat_attacks: 0` and five clans at
`fame: 0, rank: null`, with **no day-kind field at the top level**. The only
discriminator is `period.kind`, buried under a ~900-character
`as_observed_note`.

The leader persona said this reads as "the entire clan no-showed war day" and
avoided that conclusion only because it happened to call `game_clock` in the
same batch. `attendance_by_war_day: []` carries the same ambiguity ("no war days
yet" vs "not captured"). The tool description promising `decks_today` as "the
nudge list for clan management" makes the silent absence worse.

Fix: add `day_kind` and `war_day` (and `next_war_day_opens_at`) as siblings of
`season_id`, mirroring `game_clock`; emit `decks_today: null` with a `reason` on
non-war days.

Regression sketch: fixture on a training period; assert top-level
`day_kind === "training"`, `war_day === null`, and `decks_today === null` with a
reason.

### F8. The connection instructions name a clan that is not the primary player's
`services/mcp/src/identity.mjs:123-126` builds "Your clan is X" from
`identity.clans?.[0]`, where the list is ordered by `account_clan.is_primary
desc, clan_tag` (`:73-77`). For an account with players in two clans, the block
said **ALT KINGS #GRG2LVQJ** while `players_summary` with no args returned
**POAP KINGS #J2RGCRVG** for the primary player.

Three of five personas flagged this independently and two changed behaviour:
one passed `clan_tag` explicitly on every call, one avoided clan-scoped tools
entirely because it could not tell what an omitted `clan_tag` meant. The
instruction also says "OMIT player_tag and clan_tag to mean these", and
`resolveEntitledClan` (`services/mcp/src/entitlements.mjs:277`) returns the same
`ent.clans[0]` - so the sentence and the default agree with each other while
both disagree with the primary player's actual clan.

Fix: derive the sentence from the primary player's current clan, or name all of
them explicitly.

Regression sketch: account whose primary player is in clan A and whose alt is in
clan B where B sorts first; assert the instruction names A and that an omitted
`clan_tag` resolves to A.

### F9. `to`, `compare_from` and `compare_to` carry no description
`services/mcp/src/tools/battles.mjs:458, 462-463`. `from` (`:454-456`)
documents "ISO instant or YYYY-MM-DD (your timezone)"; `to` is a bare
`{type: "string"}`. The inclusive-end behaviour (`to: "2026-09-09"` resolving to
`2026-09-10T05:00:00Z`) is undocumented - the nerd derived it from
`filters_applied` after the fact.

Fix: mirror `from`'s description and state that a date-only `to` covers the
whole named local day.

Regression sketch: registry-wide lint asserting every window argument has a
non-empty description.

### F10. `elixir_coverage` does not report the span it actually measured
`services/mcp/src/coverage.mjs:23` selects intervals with
`observed_to > now() - interval '7 days'`. In the test window
`completeness_last_7_days.average_ratio: "1.000"` came from `measured_intervals: 3`
spanning 2.56 days. The note at `:71` honestly discloses the mechanism
("intervals ending in the last seven days; an interval can begin earlier"), but
nothing states how much of the week was observed, so `1.000` reads as a fully
captured week - and the casual player cited it as licence to trust every number
it had.

Fix (additive, no contract break): return `measured_span: {from, to}` beside
`measured_intervals`.

Regression sketch: fixture with intervals covering 2 of 7 days; assert
`measured_span` reflects 2 days while `average_ratio` stays 1.0.

## Lane 2 - feature wishlist for Jamie

1. **Per-member war attendance in one call** - `war_history(all_members: true)`
   returning decks used / points / days missed per member per week. The leader's
   #1 ask; costs 49 calls today, so it simply went unanswered. `clans_pilot_scores`
   already proves the clan-wide-aggregate move is wanted.
2. **Deck-vs-deck comparison restricted to a common mode and window.**
   `battles_compare` takes only `player_tags`. The tinkerer's entire mission died
   here: its two candidate decks differ by one card but live in disjoint modes
   (139 ladder vs 16 war), making the swap unidentifiable. It wants two
   `deck_hash`es in, and an explicit "the overlap is empty" out.
3. **Card-swap counterfactual** - "hold these 7 cards fixed, what does the
   corpus say about slot 8". The actual deck-tinkerer question.
4. **A peer baseline in `players_summary`.** "Is 48.6% good at 12,561
   trophies?" was the casual player's biggest interpretive gap - every win rate
   arrived bare. `battles_levels`' Pilot Score is built for this but is not
   surfaced where the question gets asked.
5. **Tenure that survives the recording horizon.** `first_observed_in_clan`
   collapses to the recorder start date for 46 of 49 members
   (`clans.mjs:329`). The leader declined to recommend kicking anyone without
   it. Even a `tenure_known: false` flag would help.
6. **Roster/race reconciliation on `war_current`** - `participants_count`,
   `member_count`, and `members_not_in_race[]` with a reason code. 44 of 49
   appeared, silently, and the five omissions were concentrated on the least
   active members. See the open question below.
7. **`boat_wins`/`boat_losses` and `duel_wins`/`duel_losses`** (complements F4).
8. **`net_trophies` in `group_by: "mode"`**, to let a caller verify the "war
   modes carry no trophies" claim behind an exact `net_trophies: 0`.
9. **Server-computed `days_since_last_battle`** on the roster - 49 hand
   date-deltas is arithmetic the service should do once.
10. **Deck staleness**: a `recent_vs_lifetime` delta on `battles_decks`. The
    casual player's real insight ("this deck's last six weeks are ten points
    below its first four") had to be eyeballed across ten weekly rows.
11. **A cheap read-only verification lane separate from `live_fetch`.** The
    leader found a data anomaly, wanted to check it against source, and
    rationally declined because verification competes with a tightly quota'd
    freshness budget. Data-correctness questions currently go uninvestigated by
    design.
12. **A usable `quota` block** - populate `max`/`remaining`, or stop emitting a
    `used` counter that cannot be budgeted against.

## Open question (needs a live check, not a code fix)

`war_current.participants` returned 44 rows against `member_count: 49`. The
leader disproved both obvious explanations from the data: a member who joined
two days *after* race start **is** present, and a member who last battled
*before* race start **is** present. `participants` is served straight from
`war_participation` (`war.mjs:352`), i.e. the race roster as the CR API reported
it, so this may be faithful. Resolving it needs one `live_fetch` of
`/clans/#J2RGCRVG/currentriverrace` against the recorded rows - and, if the API
does omit members, a note pushed to `cr-agent-api-docs` per golden rule 8.

## Lane 3 - rejected, with reason

- **"Corpus scope is broken"** (tinkerer, from six 500s on corpus-scoped calls).
  Wrong. My own `battles_meta_decks{mode:"ladder", sort:"shrunk_win_rate",
  limit:8}` (segment `corpus`) and `battles_levels{}` both returned 200 during
  the same window. Random concurrency failures misread as a scope pattern.
- **"The tag-to-name / identity resolution layer is the broken dependency"**
  (adversary, from a clean-looking working/failing split). Same cause; the split
  was coincidence. `battles_meta_cards` survived because it happened to be
  called when load had dropped.
- **"`win_rate`'s numerator contains boat wins"** (nerd). The implementation
  filters to `type_class = 'pvp'` at `:529`. The real defect is the note and the
  discarded fields - kept as F4.
- **"Quota charges for failures" / "quota counts internal work"** (adversary,
  nerd - both from `calls.used` jumping in irregular increments). It is one
  shared per-account daily counter (`quota.mjs:89-93`) and five agents were
  incrementing it concurrently. Not per-agent, not internal work. The
  *uninterpretability* is real and moved to wishlist 12.
- **Rename `completeness_last_7_days`** (nerd). A contract break for a name that
  the note already qualifies; F10's additive `measured_span` is the cheaper fix.
- **Remove `incomplete_days`** (nerd). Deprecated, always null, and
  self-documented as such at `coverage.mjs:71`. A contract break for no gain.
- **`median_win_rate` 0.526 should be 0.527** (nerd). Sub-0.001 rounding; the
  tools state that rates are computed unrounded and rounded independently.
- **Reversed windows, unknown enums, oversized limits, unknown properties**
  (adversary wishlist). All already handled: `requireOrderedWindow` and
  `requireEnum` (`shared.mjs:216-236`), full inputSchema enforcement
  (`validate.mjs`, shipped in 0.39.2 the same day), and all 44 tool schemas
  declare `additionalProperties: false`. The adversary could not observe any of
  it because of F1. **Re-run these probes on a quiet service** - this is the
  round's main unfinished business, not a fix.

## Protect these (converging delights)

Named independently by three or more personas, and worth pinning against future
edits:

- **`game_clock`** - the leader called it "the hero of this session"; it is the
  single call that prevented the worst available misread. Its `notes` array
  pre-empts the Colosseum and 10:00-UTC-rollover mistakes unprompted.
- **`battles_performance` `group_by: "mode"`** - stopped both the casual player
  and the tinkerer from shipping a wrong conclusion, by exposing that ladder and
  war records are disjoint pools. The `mode_note` ("rows are keyed by the PAIR
  (game_mode, type)"; `unknown` "is the API's own value... not corruption")
  pre-empted a bug report.
- **`deck_hash` as a portable handle** - lifted out of one tool and passed into
  another with no translation step, by two personas independently.
- **`war_current.period.as_observed_note`** - volunteers that the 10:00 UTC grid
  is a service-imposed simplification, states the consequence, names which
  fields to cite, and hands over `observed_offset_minutes` so a caller can
  correct it. Admits the model is lossy and shows the residual.
- **The empty/small-sample refusals** - `insufficient_sample: true` with a
  stated `insufficient_sample_floor`, `segment_win_rate: null`, an echoed
  resolved window, and `below_floor` as an explicit array rather than silently
  dropped rows. The adversary called the empty-window response "the standard the
  rest should be held to"; a 4-battle 100% win rate came back marked rather than
  laundered.
- **Cross-tool arithmetic reconciles to the battle.** Where tools agreed, they
  agreed exactly - three independent paths to King Thing's 90/54/36. That is
  what made the audit persona trust the corpus enough to find F3 and F4.

## Feedback filing: BLOCKED, items staged below

The round's surprising items were **not** filed through `elixir_feedback`.
Both connections refused, for different reasons:

- **Clan connection (POAP KINGS)** - `Insufficient scope: required "cr:read
  feedback:write"`. This connection carries only `cr:read`, the documented
  first-connection default.
- **Personal connection (`elixir-mcp`, King Thing)** - reported as
  `MCP server "elixir-mcp" requires re-authorization (token expired)`.

**That second message is misleading, and the round originally recorded it at
face value.** Re-checked after re-authorization: `game_clock` and
`elixir_my_feedback` both return 200, while `elixir_feedback` still fails with
the same "token expired" text. The token is demonstrably valid; the write is
refused for lack of `feedback:write`, exactly like the clan connection.

The server behaves correctly. `services/mcp/src/handler.mjs:306-334` answers
HTTP 403 with `WWW-Authenticate: Bearer error="insufficient_scope"`, a
JSON-RPC `-32003`, and a `data.hint` that names the fix precisely:
"Reconnect this client and grant '<scope>' on the consent page (the first
connection grants only cr:read)."

The MCP CLIENT collapses that into "token expired". The cost is a wrong
next action: a user is told to refresh a credential that is working, when
what they need is to grant a capability at consent. Nothing the server can
fix - 403 + `insufficient_scope` is the correct RFC 6750/9728 shape - but
worth knowing, because the server's best refusal message is invisible to
the person who needs it.

**Jamie, to unblock:** reconnect `/mcp` and tick `feedback:write` on the
consent page. Not a token refresh.

Worth noting as a finding in itself: the service asks agents to file feedback
on their own judgment before the session ends, and an agent that hits real
friction can find that neither of its credentials carries the capability to
report it. Nothing in any successful response's `meta` says which capabilities
the connection actually holds, so an agent cannot know it is unable to file
until it tries - after the work of writing the report.

---

### Staged item 1 - category `data_quality`, context `battles_performance three_crown_rate`

> **UPDATED 2026-09-09, after the fixes shipped.** Two corrections to the text
> below, which is kept for the record but should NOT be filed verbatim:
>
> 1. **The suggested fix is wrong.** "Filter the numerator to
>    `type_class = 'pvp'`" does not fix this. Ingest sets `type_class = 'boat'`
>    only for types starting `boatBattle`, so every duel is `'pvp'`; that
>    filter drops boat rows and leaves the duel bug untouched. The duel TYPES
>    have to be named. Discovered while implementing it.
> 2. **Both halves are fixed and pushed**: `dc63e45` + `65a4f09`
>    (three_crown_rate) and `665ac10` (win_rate note + decided_wins /
>    decided_losses returned).
>
> Also worth filing: this slipped through the 0.39.0 pass that fixed both its
> neighbours - feedback #22 documented duel crown summing, #23 moved boat
> battles out of win_rate's denominator - and the maintainer response to #23
> states `win_rate = wins / decided_battles`, the same wrong formula that was
> in denominators_note. The error is in the record twice.

three_crown_rate mixes duel and head-to-head crown units, which the same tool warns against elsewhere.

The three-crown counter has no type_class filter, while decided_wins/decided_losses in the same aggregate carefully filter to type_class = 'pvp'. But battles_query's own card_legend states that duel rows collapse up to three games and that crowns SUM across rounds (up to 9, "never comparable with a 0-3 head-to-head row").

So a duel row scoring 1+1+1 across three rounds is counted as a three-crown victory, identically to a genuine 3-0 sweep - and that duel may have been a LOSS. The denominator is every recorded battle including draws, boat and duel rows, so neither half of the ratio is head-to-head.

Material, not theoretical: #20JJJ2CCRU shows duel_battles 34 of battles 246, so ~14% of rows carry summed-round crowns. denominators_note already discloses that crowns_for/crowns_against "mix units when duels are present" - three_crown_rate has the same defect and no such warning.

Suggested: filter the numerator to pvp, divide by decided_battles, and state the denominator in denominators_note.

Related, same tool: denominators_note says "win_rate = wins / decided_battles". The implementation is decided_wins / decided_battles, which is correct - but the exposed `wins` field includes boat wins, so the documented formula does not reproduce the returned number when boat_battles > 0, and decided_wins/decided_losses are computed and then dropped from the response. The rate is right and unverifiable. Please return both fields and fix the note.

---

### Staged item 2 - category `bug`, context `error surface under concurrent load`

Under concurrent load the MCP door returns a bare {"message":"Internal Server Error"} with no error envelope at all - no error.code, no hint, no request_id, no contract_version - while every successful response carries a full meta block.

Five agents running concurrently on one account lost roughly 14 of ~60 calls this way (plus some Cloudflare 502 origin_bad_gateway). Calls that failed succeeded verbatim on later retry, so these are load, not arguments.

Two consequences, both worse than the outage itself:

1. Bad input and server outage are indistinguishable. An adversarial-probe persona graded 8 of 11 edge-case probes unusable - it could not tell whether #IBOS1234 (invalid tag alphabet), a reversed from/to window, or badges_holders {} were being refused correctly or were casualties of the outage. The validation is in fact good; none of it was observable.
2. Nothing is reportable. With no request_id on the failure path, a user has literally nothing to paste into a bug report. Two personas asked for exactly this unprompted.

It also caused two personas to infer confident but wrong root causes ("corpus scope is broken", "the name-resolution layer is down") from which tools happened to fail - a random failure pattern read as a structural one.

Separately: the 429 rate-limit body is {"error":"rate_limited"} - error as a bare string, no meta, no request_id, no Retry-After - where every other refusal uses {code, message, hint}.

Suggested: every failure, including infrastructure ones, should carry the same envelope as a success, at minimum request_id and contract_version, and should visibly distinguish "your input is wrong" from "we are degraded".

---

### Staged item 3 - category `bug`, context `deck_hash card rendering and connection identity`

Two places where the service knows something about identity and does not show it.

1. deck_hash includes evolutionLevel and the tower troop id, and the contract states outright that form discriminators are part of deck identity. But battles_decks, battles_meta_decks and battles_cards render cards as {id, name} only. A deck tinkerer got two rows with visually identical eight-card lists and different deck_hash values, found no field anywhere explaining the split, and nearly reported it as data corruption. battles_meta_cards DOES return an `evolution` field, so the corpus disagrees with itself - and the same persona spent a whole session believing it played base cards when it actually runs an Evo Witch and a Hero Mini P.E.K.K.A. Please render `evolution` in all three, and surface the tower troop on deck rows.

2. The connection instruction block said "Your clan is ALT KINGS #GRG2LVQJ. OMIT player_tag and clan_tag to mean these", while players_summary with no arguments returned clan POAP KINGS #J2RGCRVG for the same connection's primary player. Three of five fresh agents flagged this independently, and two changed behaviour: one passed clan_tag explicitly on every call, one avoided clan-scoped tools entirely because it could not tell what an omitted clan_tag would mean. For an account with players in two clans, the sentence appears to take the first clan row rather than the primary player's current clan. Please derive it from the primary player, or name all of them.

---

### Staged item 4 - category `feature`, context `war_current on a training day`

war_current on a training day is shaped exactly like a catastrophe.

A fresh clan-leader agent called war_current {} on a training day and got 44 participants at points 0, decks_used 0, boat_attacks 0, plus all five clans at fame 0, rank null. Its words: this "looks exactly like the entire clan no-showed war day." It avoided that conclusion only because it happened to call game_clock in the same batch.

Three things would have prevented it:

1. No day-kind at the top level. season_id, section_index, is_colosseum, standings and participants are all siblings, but the only thing saying today is training is period.kind, below a ~900-character as_observed_note. Please add day_kind and war_day (and next_war_day_opens_at) next to season_id, mirroring game_clock.
2. decks_today simply vanishes on non-war days - the key is absent, not null, with no reason - while the tool description promises it as "the nudge list for clan management". Please return decks_today: null with a reason like "training_day" so the absence is an answer.
3. attendance_by_war_day: [] carries the same ambiguity: no war days yet, or not captured?

Related, cheap: war_history's note describes war_days_battled unconditionally, but that field only exists inside member_weeks, which is only returned when player_tag is supplied. An agent that called war_history({seasons: 2}) went looking for a field the note had named and that was never going to be there.

Strong praise attached to the same session: game_clock was called "the hero of this session" and is the single call that prevented the worst available misread. Its notes array pre-empted the Colosseum and 10:00-UTC-rollover mistakes unprompted. war_current's description should route a new leader there first.
