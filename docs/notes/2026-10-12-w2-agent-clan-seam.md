# 2026-10-12 — Agents: a person's agent reads their own Clan view; the seam, designed (#535)

A design note, for Jamie to rule on. Nothing is built: no tool, route,
scope, migration or behaviour change. MCP 11.11.2 and JSON API 3.2.0
are unchanged. Line numbers are from `origin/main` at 81694e8c.

## Intent

Jamie, on #535: "Yes, what I can see." A person's agent reads, from
Elixir Clan, exactly what that person sees there: the Actions waiting
for them, their own standing line, and the policy summary. It never
sees another member's clock or any removal, and it never decides. The
read goes through the closed reader with the person's own credential,
so private Clan state still never enters the public game tools.

The ledger and the briefs already say this, ratified 2026-10-12:

- `docs/DECISIONS.md:161`, "Clan reads Elixir through a closed
  in-process reader": "... private Clan state never enters public game
  tools, and a person's own connection reads exactly what that person
  sees in Clan (the Actions waiting for them, their own standing line,
  the policy), never another member's clock or a removal, and never
  decides. [Jamie, 2026-10-02, 2026-10-04, 2026-10-12; open #535]"
- `docs/product/agents.md:46-50`, principle 6: "**A person's agent sees
  what the person sees.** In Clan too: the Actions waiting for them,
  their own standing, the policy; never another member's clock, and it
  never decides. A clan agent sees the clan's attested facts and war
  intent, as today."
- `docs/product/clan.md:27-33`: "Today an agent gets one narrow read of
  the clan's war intent with an explicit grant [Jamie, 2026-10-04]; the
  direction is that a person's agent reads exactly what that person sees
  in Clan (the Actions waiting for them, their own standing line, the
  policy), and nothing more: never another member's clock or removal,
  and it never decides an Action."

## 1. The seam today, verified

- **The closed reader goes the other way.** It is how Clan reads
  Elixir, not how anything reads Clan: `packages/clan/src/recorded-client.mjs:1-13`
  is a fixed set of eight record reads (`elixir_my_players`,
  `clans_participation`, `clans_roster`, `players_names`,
  `players_profile`, `battles_query`, `elixir_coverage`, `live_fetch`),
  and its credential is "an opaque request-local object supplied after
  Elixir authenticates a person, never a browser token, OAuth grant or
  integration key" (:1-3; the same rule in `packages/clan/AGENTS.md:27-32`
  and `docs/ENGINEERING.md:465-468`). Nothing in it can carry Clan
  state out.
- **The boundary test.** `services/web-api/test/clan-boundary.test.mjs:41-66`
  walks `services/mcp/src` and `packages/tools/src` and fails on the
  text `clan_state` (:46), on any import of `@elixir-mcp/clan` or
  `@elixir-mcp/clan-state` (:57-61), and on an import of
  `@elixir-mcp/auth/clan-context` from any file but
  `packages/tools/src/tools/clan-context.mjs` (:48-55). So an agent read
  of Clan state can only go through `@elixir-mcp/auth/clan-context`,
  imported by that one tool file.
- **How war intent already crosses.** `packages/auth/src/clan-context.mjs`
  is the approved seam (:1-3). `readAgentPolicyContext` (:62-134)
  answers only an agent on a service credential with `cr:read`
  (:63-69), and in one SQL snapshot (:72-103) checks an explicit row in
  `agent_policy_context_grant` bound to agent, actual owner, primary
  clan and service token, the owner's verified primary or alt claim
  and open membership in that clan; then it projects eight fields from
  the `policy#` pointer and version rows (:94-100, :120-133). It reads
  `clan_state` by SQL inside `packages/auth` and imports no Clan
  package. The grant is made only by the IAM-only operator op
  `{clan_context}` (`services/migrate/src/ops-clan-context.mjs:1-5`,
  insert at :57-61) into migration 0202's table
  (`db/migrations/0202_agent_policy_context_grant.sql:8-21`); its
  triggers revoke it when ownership, credential or assignment change.
  The tool is `clans_context`
  (`packages/tools/src/tools/clan-context.mjs:5-33`), agent-only:
  `packages/contracts/src/principals.ts:41-48` and :57-61, pinned by
  `services/mcp/test/principal-surface.test.mjs:43`, :63, :76.
- **The views to reuse**, in `packages/clan/src/manage/service.mjs`:
  - `memberView` (:968-1074, served as `GET /api/clan/clans/<tag>/me`,
    `packages/clan/src/handler.mjs:614-615`): the person's own weekly
    numbers (`you`), the policy's reading of them (`clan`, :1006-1036),
    the count of Actions open to them (:1038-1042), their own hold
    (:1069-1071) and their awards (:1043-1057). It already shows "only
    the viewer's own lines: no one else's, no notes about them, no
    removal action about them" (:965-966), and folds the engine's
    `recommended` removal state into `at_risk` (:1027-1029). It
    evaluates live from two recorded reads and writes the clan's size
    to the ledger (`noteSize`, :971).
  - `actionsView` (:1147-1194, `handler.mjs:661-672`): the open Actions
    this person may take and the last 30 days' closed ones, filtered by
    the engine's `canAct` (:1162; `packages/clan-engine/src/actions.mjs:95-100`).
    It may evaluate the clan (`evaluateClan`, :1158; that function,
    :537-950, writes cards, log entries and the verdict snapshot) and
    numbers Actions (:1161), so it is not a read.
  - `policySummary` (:1240-1260, in `/api/clan/me` through
    `handler.mjs:176-179`): whether a policy is set and active, its
    version, the noted size, and the switches (`ranks_elder`,
    `removal`, `away`, `members_see_standing`). A ledger read only.
  - Also relevant: `policyContext` (:1264-1293), the person-session
    twin of the war-intent read, "no evaluation, roster read or durable
    write" (:1264), and the verdict snapshot the morning run saves
    (`verdicts#<clan>`, :938-947), which keeps every member's verdict.
    Every helper that shapes the standing line is a pure clan-engine
    export: `participationPhrase` (`render.mjs:85`), `standingForMembers`
    (:322), `nextSteps` (:368), `countedCategories` (`policy.mjs:734`),
    `declaredGoals` (`goals.mjs:204`).

## 2. The question that decides the design: which principal?

Elixir has two principals a person's "agent" could be
(`docs/DECISIONS.md:133`, "Principals: users, agents, integrations"),
and each conflicts with a written rule.

**(a) The person's own `/mcp` connection** (an OAuth grant,
`credentialType: "oauth"`, `packages/auth/src/oauth.mjs:589`).

- For it: `agents.md:14-16`, "**A person, as themselves.** Connecting
  Claude to `/mcp` connects as you: the tools know your primary, alts,
  friends and clan, and omitting a tag means you." Principle 6
  (:46-50) separates "a person's agent" from "a clan agent", which
  "sees the clan's attested facts and war intent, as today". And
  `DECISIONS.md:161` names it: "a person's own connection reads exactly
  what that person sees in Clan".
- Against it: the reader rule. `recorded-client.mjs:1-3`, "never a
  browser token, OAuth grant or integration key"; `packages/clan/AGENTS.md:28-30`,
  "a request-local credential made after Elixir authenticates the
  person, never a browser token, OAuth grant or integration key";
  `docs/ENGINEERING.md:465-468`, "no OAuth grant or integration key is
  fabricated". A connection is a long-lived grant held by a third-party
  client, and no private Clan state has ever been reachable by one.
- How the tension resolves: the rule governs the credential Clan uses
  to read Elixir's record, and it stays as written. This seam runs the
  other way, from MCP to a projection of Clan's ledger, through
  `auth/clan-context`, never through the recorded client. The OAuth
  grant authenticates the person; a separate explicit grant authorizes
  the Clan read, as war intent has.

**(b) An agent the person owns** (`kind: "agent"`, a service key,
`oauth.mjs:794`).

- For it: the war-intent machinery already serves agents (grant table,
  eligibility checks, revocation triggers), so this would be a wider
  projection on the same grant.
- Against it: `agents.md:58-60`, "What it never does: ... show an agent
  its owner's private account data"; `agents.md:17-21`, an agent's
  "'me' is the clan", so "the Actions waiting for them" has no "them";
  principle 6's last sentence keeps a clan agent to "the clan's attested
  facts and war intent, as today"; and `services/mcp/test/principal-surface.test.mjs:4-10`
  records why: an agent answering with its owner's personal data "is
  how a clan bot came to be able to recite personal tags into a public
  channel". A person's standing line and their Actions are the owner's
  private data, read by a principal that posts to a clan.

**Default in force: (a), the person's own connection**, through
`@elixir-mcp/auth/clan-context`, with an explicit grant as war intent
has. Inferred from "Yes, what I can see", and from DECISIONS:161's
"a person's own connection". A clan agent stays as today (attested
facts and `clans_context`). If Jamie rules (b), the design below still
holds except the grant binds an agent and its owner (0202's shape),
and the "never show an agent its owner's private account data" line
in `agents.md` changes.

**The grant under (a)** [engineering]. Off by default, made by the
person for one connection on the console's connection list (the
connection a person can already see and revoke, `GET /api/me/connections`,
`services/web-api/src/routes/account.mjs:408`), bound to account,
connection (`oauth_family`) and clan, revoked with the connection, and
rechecked on every read (verified claim, open membership). It is a row
in a new table shaped like 0202, so the build carries one additive
migration. Not a scope: a non-standard scope "is granted only when the
client names it" (`packages/contracts/src/tool-groups.ts:41-43`) and
cannot be added to a connection afterwards (`account.mjs:549-565`), so
Claude's connector would never hold it; a standard scope would be a
default grant, which `DECISIONS.md:162` rules out for the war-intent
read. An operator-made grant (as war intent's is) is not the default:
this is the person's own view, and "Yes, what I can see" needs no one
else's approval.

## 3. What the agent would see

Exactly the person's own lines, for one clan: with no clan given, the
primary's current clan, else `no_subject` (`agents.md:32-36`); a named
clan only where one of the person's verified claims (primary or alt)
is a current member. When two of their verified players are in that
clan, the read acts as the one Clan acts as: the highest acting role,
then the higher in-game role (`clansOf`, `packages/clan/src/gate.mjs:66-73`),
since the role decides which Actions `canAct` lets them see.

**A second question for Jamie: an unverified claim.** Clan admits a
person whose only claim in the clan is unverified, as a member: "an
unverified player is taken at its word, and Elixir lets several
accounts claim one tag that way, so it acts here as a member"
(`packages/clan/src/gate.mjs:16-19`), and `clan.md:35-36` says "until
then they read as a member". Parity would give that person's agent the
member-level view too. But the standing line is that player's private
Clan state, and an unverified claim proves no ownership of the player:
several accounts can hold it, so parity would hand one player's line to
the connections of everyone who claims the tag. Default in force: an
unverified claim is refused, as the war-intent read
(`auth/clan-context.mjs:87-92`) and `/policy/context`
(`handler.mjs:637-641`) refuse it; narrower than Clan's page, never
wider. Inferred from "never another member's clock": an unverified
claimant may be another member.

| Group | Fields | Source |
| --- | --- | --- |
| Who | `player_tag`, `role` (the person's own) | the verified claim and `clan_membership.role`, as `auth/clan-context.mjs:87-92` |
| Policy summary | `set`, `active`, `version`, `members`, `min_members`, `ranks_elder`, `removal`, `away`, `members_see_standing` | `policySummary`, service.mjs:1245-1259 |
| Standing line (when active) | `policy_version`, `goals`, `counted`, `ranks_elder`, `status` (a group, never a score), `evidence`, `next`, `minimums` {`set`, `met`, `passes`, `unknown`, `rule`, `window_weeks`}, `tenure_min_days`, and `inactivity` {`state` (`recommended` folded into `at_risk`), `days_idle`, `at_risk_days`, `judgment`, `activity_evidence`} when removal is on | `memberView`'s `clan`, service.mjs:1006-1036 |
| Actions waiting for them | per open Action of a shown type: `number` (null for an Action raised before numbering), `type`, `label`, `subject_name`, `raised_at`, `url` (the Action in Clan); `count` is the length of that list, never Clan's rail count | `actionsView`'s `open`, :1164-1166, :1186-1188, filtered by `canAct` |
| Freshness | `evaluated_at` of the snapshot read, `read_at` | `verdicts#<clan>`, :938-947 |

**Excluded.**

- **Another member's clock or line**: every other member's verdict,
  standing row, score or percentile
  (`packages/clan-engine/src/evaluate.mjs:402-415`; Clan shows
  other rows only under `members_see_standing` or to a leader,
  service.mjs:2178-2179), holds, notes and away.
- **Beyond the three things named**: `clan.md:27-33` says the Actions
  waiting, their own standing line and the policy, "and nothing more".
  So the person's own hold and away (`memberView`, :1069-1071) and
  their awards (:1043-1057) are left out, though Clan's page shows
  them. Awards already reach a member's agent as attested facts, by the
  type's rule (`clan.md:91-96`, principle 9); adding the hold would be
  Jamie's call.
- **Any removal**: no Action of type `removal`, for anyone, including
  a leader who would decide it, no `removal_safety`, and no count that
  includes one: Clan's rail count (`openActionCount`, service.mjs:1131-1138)
  counts a leader's removal Actions, so set beside the list it would
  say how many are hidden. A leader's answer always carries the same
  note that some Actions are shown only in Clan. The engine's
  `recommended` state reaches the agent only as `at_risk`, as Clan's own
  page shows it.
- **Any deciding or acting**: no Action evidence, log, comments, words
  to send or drafts; no `can_complete`, `can_draft`; no write of any
  kind. The agent can say what is waiting and link to it; the person
  decides in Clan.
- **The record's own numbers** (`memberView`'s `you`, :1066): those are
  Elixir facts the agent already reads with `clans_participation` and
  the player tools, not private Clan state.
- **Everything else private**: other policy values, the clan's model
  key, Discord connections, recruiting, sealed items.

**A removal Action whose subject is the person.** Not shown. Clan never
shows it to them: `removal` is a leaders' Action
(`packages/clan-engine/src/actions.mjs:35-39`), so `canAct` is false for
its subject, and `memberView` keeps "no removal action about them"
(service.mjs:966). The policy's own wording is the rule: "Nobody below
co-leader ever sees a removal action or who is on a clock"
(`packages/clan-engine/src/policy.mjs:713`, and `clan.md:73-74`). What
the person does see is their own inactivity line (`at_risk`, days idle)
and, when the policy allows it, the "Going to be away?" Action, which is
a member's own (`actions.mjs:50`); the agent sees the same. Default:
"never a removal".

**Actions as a summary line, not the whole Action** [engineering]. For
a leader, a promotion, demotion or departure carries another member's
evidence. The default shows the line Clan's list shows (number, label,
whom it is about, when it was raised) and links to the Action; the
evidence and the words stay in Clan, where the decision is made. If
Jamie wants the agent to read the whole Action as the person does, the
evidence must first be cut of another member's clock (days idle, last
battle time, activity evidence), which is a second projection to keep
in step.

**Snapshot, not live** [engineering]. The read projects the saved
verdict snapshot (the morning run's, or the last evaluation), never
evaluates and never writes, as `policyContext` (service.mjs:1264) and
the war-intent read do. It uses the snapshot only when its
`policy_version` is the current policy's and the clan is not below the
minimum, the test `actionsView` applies before reusing one
(service.mjs:1149-1155), and only when it holds the acting player's
verdict (a member who joined since the last evaluation has none). The
open Actions depend on the same evaluation: when the policy changes,
`actionsView` re-evaluates and `reconcileCards` withdraws and raises
Actions (service.mjs:613-654), so Actions read under an older snapshot
may no longer be waiting. Otherwise (a policy saved or revised since the
last evaluation, none yet, or no verdict for the player) both
`standing` and `actions` are null with `reason: "not_evaluated"`; the
policy summary is still given. An open Action raised before Actions
were numbered has no number until Clan's own Actions page numbers it
(`numberActions`, `packages/clan/src/manage/actions.mjs:111-122`, a
write); the read never numbers one, so such an Action carries
`number: null` and a `url` to Clan's Actions list. Clan's own `/me` evaluates live, so the agent's
standing line can be up to a day older than the page; it carries
`evaluated_at`. Both shape the line with the same pure engine
functions; the build moves `memberView`'s `clan` block (:1006-1036)
into one clan-engine function that both call, so "exactly what the
person sees" is one piece of code.

## 4. The contract shape

Two options, each a minor (`npm run contract:bump -- minor`):

- **Widen `clans_context`.** Rejected. It is agent-only by contract
  (`principals.ts:41-48`, :57-61; `principal-surface.test.mjs:43`, :63,
  :76), its public promise is "exactly eight fields"
  (`apps/site/src/docs/clan-policy.md`, Agent context;
  `packages/contracts/clan-policy-context.schema.json`), and its
  subject is "your assigned clan". Serving persons from it would make
  one tool answer from different subjects on different connections,
  the failure `principal-surface.test.mjs:4-10` exists to prevent.
- **A new person-only tool. Recommended.** It mirrors
  `elixir_my_players`, the one person-only tool
  (`principals.ts:31`): its subject is "you", it is hidden from agents
  and integrations, and `clans_context` keeps its meaning for clan
  agents untouched.

Name: **`clans_my_view`**, "your own view of your clan in Elixir
Clan". No arguments but an optional `clan_tag`. Sketch of the response
(not added to `packages/tools`; the output schema closes every object
with `additionalProperties: false`):

```json
{
  "view": {
    "schema_version": 1,
    "reason": null,
    "clan_tag": "#...",
    "you": { "player_tag": "#...", "role": "member" },
    "policy": {
      "set": true, "active": true, "version": 7, "members": 41,
      "min_members": 10, "ranks_elder": true, "removal": true,
      "away": true, "members_see_standing": true
    },
    "standing": {
      "policy_version": 7, "evaluated_at": "...", "goals": [],
      "counted": ["war"], "ranks_elder": true, "status": "rising",
      "evidence": "...", "next": [],
      "minimums": { "set": true, "met": true, "passes": 3,
                    "unknown": 0, "rule": "...", "window_weeks": 4 },
      "tenure_min_days": 14,
      "inactivity": { "state": "active", "days_idle": 1,
                      "at_risk_days": 7, "judgment": "ready",
                      "activity_evidence": {} }
    },
    "actions": {
      "count": 1,
      "waiting": [
        { "number": 37, "type": "away", "label": "Going to be away?",
          "subject_name": "...", "raised_at": "...", "url": "https://elixir.poapkings.com/clan/..." }
      ]
    },
    "read_at": "..."
  },
  "applied": { "clan_tag": "#..." },
  "notes": ["..."],
  "docs": "...",
  "meta": {}
}
```

`view.reason` is required and nullable: null when `standing` and
`actions` are given; otherwise one of `no_policy`, `too_few_members`
(no policy is active, so Clan has no standing and raises no Actions)
or `not_evaluated` (no snapshot matches the current policy or holds
the person's verdict), and then `standing` and `actions` are both null.
The policy summary is always given. The standing line's version is
published as `policy_version`, the name `clans_context` uses; Clan's
`/me` calls the same value `clan.version`, and the tool maps it at its
one boundary while the shaping stays shared. Every `url` is absolute
on Elixir's origin, as battle links are (`battleUrl`,
`packages/contracts/src/battle-link.ts:46`), so it opens from any
client: an Action's own page, or Clan's Actions list for an unnumbered
one. Refusals:
`not_entitled` (no grant, unverified, not a member), as `clans_context`
refuses today (`tools/clan-context.mjs:16-21`), and `no_subject` (no
clan given and no primary clan), as the person's other tools do. The JSON API gains nothing: programs
read the JSON API, agents read MCP (`agents.md:22-23`).

## 5. The boundary proof

- **`clan-boundary.test.mjs` stays green unchanged.** The tool is
  declared in `packages/tools/src/tools/clan-context.mjs`, the one file
  allowed to import `@elixir-mcp/auth/clan-context` (:48-55); the
  reader lives in `packages/auth/src/clan-context.mjs` beside
  `readAgentPolicyContext` and reads the ledger by SQL there, so no file
  under `packages/tools/src` or `services/mcp/src` names `clan_state`
  (:46) or imports a Clan package (:57-61). `packages/auth` gains one
  dependency, the pure `@elixir-mcp/clan-engine`, for the shared shaping.
- **The surface test gains the person-only rule.**
  `clans_my_view` joins `PERSON_ONLY_TOOLS`; `principal-surface.test.mjs`
  asserts an agent and an integration do not list it, and that calling
  it on either is refused.
- **A new test pins the owner-only read.** Beside the war-intent tests
  (`services/migrate/test/clan-context.test.mjs`, scratch Postgres), a
  clan of ten members (`MIN_MEMBERS`, `packages/clan-engine/src/policy.mjs:34`,
  so the active view is reached) with a current snapshot, where one
  other member is on a clock and the subject of an open removal Action,
  with a note and a hold on them; and a separate nine-member clan that
  must answer `too_few_members` with no standing or Actions.
  It asserts the reader returns nothing for: an agent (including the
  person's own agent holding a war-intent grant), an integration, a
  person without the grant, a person whose grant is on another
  connection, an unverified claim, a player who has left, and a clan
  the person is not in. For the granted person, the serialized answer
  contains none of the other member's tag, name, days idle, hold or
  note, nor the person's own hold or awards, no `removal` Action (also when the person is its subject), an
  Actions `count` equal to the items shown (a leader with an open
  removal gets the same count as without one), and no key outside the
  output schema. A person with two verified players in the clan reads
  as the one `clansOf` picks. A snapshot from an older policy version,
  or one without the person's verdict, gives `standing: null`,
  `actions: null`, `reason: "not_evaluated"`, even with an open Action
  from the older version in the ledger; an unnumbered Action gives
  `number: null`. Authorization and projection share one database
  snapshot, as `readAgentPolicyContext` does in one statement
  (`packages/auth/src/clan-context.mjs:70-103`): either one statement,
  or a transaction begun `isolation level repeatable read, read only`,
  since read-committed takes a new snapshot per statement and a grant
  or membership revoked between the check and the ledger read would
  still leak. The test revokes the grant between the two reads of a
  repeatable-read transaction and asserts the answer is the refusal or
  the pre-revocation view, never a mix; and the read can never write.

## 6. Effort, risk, and what it waits on

- **Effort: L**, in one pull request or two. The grant (one additive
  migration, a console switch on the connection list, a route) is M;
  the reader, the shared engine function, the tool, its output schema,
  the contract minor and the public docs (`clan-policy.md`'s Agent
  context section, `bring-your-clan.md`, `your-account.md`) are M; the
  tests are M.
- **Risk: medium.** It is the first time private Clan state reaches a
  connection held by a third-party client. The guards are the explicit
  per-connection grant, the person-only surface, the read-only snapshot
  projection, and the closed output schema.
- **Waits on:** Jamie's rulings on section 2 (the principal) and on the
  unverified claim (section 3), and nothing else. No tier
  check belongs on the grant (`clans_context` has none), so #530 and
  #539 do not gate it. The migration keeps it out of any wave with a
  no-migration rule.

## Defaults taken

- [Jamie, 2026-10-12] "Yes, what I can see": the person's own view,
  never another member's clock or a removal, never deciding
  (DECISIONS:161, unchanged).
- [engineering] The principal is the person's own connection
  (section 2, default (a)).
- [engineering] The grant is per connection, made by the person, off by
  default; a table row, not a scope.
- [engineering] An unverified claim is refused (Jamie's second
  question); no clan given means the
  primary's current clan; two verified players in one clan read as the
  one Clan acts as (`clansOf`).
- [engineering] No `removal` Action is ever shown, including one whose
  subject is the person.
- [engineering] Actions are summary lines with a link, not the whole
  Action.
- [engineering] Only the three named things: no hold, away or awards.
- [engineering] The read projects the saved snapshot only when its
  policy version is current and it holds the person's verdict, for both
  the standing line and the Actions; it never evaluates, numbers or
  writes.
- [engineering] A new person-only tool, `clans_my_view`, not a wider
  `clans_context`.
