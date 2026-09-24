# The console account switcher: you and your agents — design, 2026-09-23

**Ask (Jamie):** an agent is an account the person owns, so in effect every
person has sub-accounts. Today an agent's settings sit on its own page under
Connections, and seeing its timeline means Connections → Agents → the agent.
The alternative: switch the console *into* the agent, and see every page
scoped to it — timeline, usage, feedback, activity. "I think it could make it
simpler, but I'm not sure." Explore it; do not implement it.

**Method.** Read the principal model as ratified on 2026-09-08
(`docs/notes/2026-W36-W37.md`, "PRINCIPALS: USERS / AGENTS / INTEGRATIONS"),
`packages/contracts/src/principals.ts`, `packages/claims/src/principals.mjs`,
the 43 `/api/me` routes and what each one scopes to, the agent page
(`apps/web/src/views/account/Agents.jsx`), the rail, and the public model in
`apps/site/src/docs/roles.md`. Design only; nothing applied.

---

## 0. Summary

Build it. An agent's console is a **place with its own address**, not a mode:
`/agent/<public_id>/<page>` is the agent, `/account/<page>` is you, and the
**rail header** — where "Console · owner" sits today — is the selector that
moves between them. The rail reshapes to what an agent is: the pages that
make sense for it stay, the person-only pages drop out. Every scoped view is
the same view you already use, fed by one server seam that checks ownership
once.

The switch is simpler than today, not just prettier: today's person pages
disagree about whether they include your agents (§1), an agent's call log
and feedback cannot be read anywhere, and an agent cannot be configured at
all past its creation. The agent console fixes all three by construction,
and it gives agent configuration (Jamie's point 1, §4) a home.

## 1. What exists

The published model already says the thing a switcher would make visible:
an agent "has its own identity, its own key and its own event feed, so what
it does never lands in your history" (`roles.md`). The console only half
keeps that promise:

| Your page | Includes your agents? |
|---|---|
| Usage | Yes, merged, with agents broken out. Correct: agents spend your budget. |
| Connections | Yes, merged: clients connected *as* an agent are listed as yours. |
| Activity → MCP requests | No: `where a.account_id = $1`. |
| Feedback | No: `feedback where account_id = $1`. The Discord preview files a lot of it; its owner never sees it unless they are an admin. |
| Timeline | No; each agent's is a separate hand-built table on its page (no filters, no pager, no read state), a second implementation that has already drifted from the Timeline view. |

Gaps that follow: an agent's **call log** has no list anywhere (its page
shows a 7-day count; a call record opens only if you already have the id),
its **feedback** is invisible to a non-admin owner, and its **configuration**
is frozen at creation — the clan is chosen once
(`createPrincipal` requires a clan the owner already added), there is no
route to add a second clan or any player, and `elixir_track_player` /
`elixir_track_clan` are `PERSON_ONLY_TOOLS`, so the agent cannot add one
either. A family agent that acts for several clans cannot be configured.

## 2. The model

**Where the scope lives: the URL.** `/agent/<public_id>/timeline` is the
agent's timeline; `/account/timeline` is yours. Switching is navigation, so
two tabs can show two principals, Back works, a link is honest about whose
page it opens, and nothing ambient can make a write land on the wrong
account — the failure the 2026-09-08 notes worried about for MCP connectors.
Not `/a/*`: the edge sends that prefix to the MCP door (`infra/template.yaml`,
the `/a/*` behavior), which is where `/a/<id>/mcp` lives.

**Where the selector lives: the rail header.** The kit's `Rail` head takes a
`title` ("Console") and an `aside` (the role). It becomes the account:

```
Jamie ▾                    owner
POAP KINGS ▾        agent · leader
```

- The menu lists you first, then each agent (name, clan, tier), then
  "Manage agents…". Nobody with no agents sees a chevron; the header reads
  as it does today.
- The aside carries the selected principal's tier. An agent's is capped at
  its owner's (`AGENT_MAX_ROLE = "leader"`), so switching visibly shows that
  an admin's agent is not an admin.
- Switched, the header row is tinted: the whole cue, no separate banner.
- Switching keeps your place: from Timeline you land on the agent's
  Timeline; a page agents do not have (Verify) lands on the agent's Overview.
- Narrow: the rail collapses to a disclosure whose closed row names the
  section. The selector must stay in that closed row, or a phone could be
  acting as an agent without showing it.
- The identity block at the rail's foot is unchanged: the header says whose
  console this is, the foot says who is signed in (always you).

The selector is a kit addition (`packages/ui`), not a console local: Elixir
Clan's rail aside is a clan tag, and a leader of several clans is the same
shape of problem.

## 3. The two rails

**The agent's console** — the current rail, reshaped:

| Group | Item | As the agent |
|---|---|---|
| — | Overview | health: key issued and first used, last successful call, refusals, its clans, capabilities in brief |
| — | Timeline | its timeline: the Timeline view, newest first, never moving its pointer |
| — | Explore | unchanged: the corpus does not care who you are (Jamie) |
| Record | Tracking | its clans and players, notify switches, scope (§4) |
| Record | Activity | its MCP requests (with call records), its feedback threads, its account events |
| Record | Usage | its calls and live fetches, stated as a share of *your* budget ("812 of Jamie's 5,000 today") |
| Access | Connections | clients connected as it (OAuth-into-agent grants) |
| Access | Settings | name, key (rotate, revoke, suspend), capabilities, identities — what the agent page holds today |
| Access | Feedback | its threads; replying on one replies as the agent (new feedback is filed as you) |
| Service | Status | unchanged |

Gone for an agent: Verify (a claim asserts "this player is me"), Collections
(curation starts at family and an agent's tier is capped at leader, so an
agent can never curate; it reads collections like everyone),
Profile (Settings replaces it), Admin (an agent is never admin). Email and
Devices were Profile's.

**Your console after:** your pages show you. Two aggregates stay at the
person because they really are yours: **Usage** (the one budget, with each
agent as a row that opens its console) and **Agents** under Access (create,
list, open). Clients connected as an agent move to that agent's Connections
(Jamie: "yes for sure"). Feedback keeps one voice rule: replying on an
agent's own thread replies as the agent, but new feedback typed in the
console is always filed as you, in either scope, carrying the agent it was
about when you were in its console.

## 4. Configuring an agent (Jamie's point 1)

"Right now there is no way to add a randomly tracked account to an agent but
there should be. Or a clan agent may be asked to track a competitive clan. A
clan family agent I don't think even has a way to be configured." Confirmed
on all three (§1). The agent console's Tracking page is where this lives, and
it needs three model decisions:

- **Subjects.** An agent tracks clans and players, like a person, minus the
  person-only meaning: no claim, no primary/alt/friend (those say "me"). One
  clan is the agent's **primary** — what "omit `clan_tag`" means for it, the
  way a person's primary player is — and the rest are family clans or
  rivals, each with notify and scope. A family agent is simply an agent with
  several clans.
- **Slots: pooled at the owner, counting distinct subjects.** The 2026-09-08
  model already says agent slots draw on the parent. The rule that keeps
  that honest: your slots count the distinct subjects recorded for you and
  your agents together, so a clan tracked by both counts once, and making
  agents never multiplies recording capacity. This replaces the creation
  gate's "a clan you have already added" with the same guarantee stated
  generally. **Decision needed** (§7a).
- **Who may add.** The owner, from the agent's Tracking page. And the agent
  itself over MCP — "a clan agent may be asked to track a competitive clan"
  — which means opening `elixir_track_player` / `elixir_track_clan` to
  agents with agent semantics (no relationship, no primary-player moves).
  That changes the reasoning recorded in `PERSON_ONLY_TOOLS` ("adding is the
  owner's act, performed as themselves") and is a minor contract bump.
  Every add or removal made in the agent's scope is an account event on the
  agent, with who did it, visible in its Activity. **Decision needed**
  (§7b).

## 5. Server: one seam

- `resolveAccount(db, event)` in `services/web-api/src/handler.mjs` is
  already the one session resolver, handed to ten route modules. Add its
  sibling `resolvePrincipal(db, event)`: the session person plus an optional
  scope, returning the agent only when `owned_by_account_id` is the person
  and `kind = 'agent'`, else a **404** (never confirm another owner's agent
  exists).
- The scope travels in the path, not a header: `/api/agent/<public_id>/…`
  mirrors the `/api/me/…` tail, so the access log and the call audit show
  it. Routes opt in; a route not on the scoped list refuses a scope.
- The 43 `/api/me` routes sort three ways. **Scoped:** timeline, requests
  and call records, activity events, feedback, usage (the slice), clans and
  tracking (new writes), connections and their scope/revoke, the
  principal-management routes (which become the agent's Settings).
  **Person only:** verify, email and sends, sessions, gateways,
  role-request, timezone, first-answer, collections, agent creation.
  **Person aggregate:** usage (budget), principals list.
- One test pins the seam: every scoped route answers for an owned agent,
  404s for another owner's, and every person-only route refuses a scope.
  Forgetting the check on one route is the whole security risk of this
  design, so it is enforced as a table, not as care.

## 6. Client

- A `PrincipalProvider` beside `ZoneProvider` in the Shell, set from the
  route; views read `usePrincipal()` and the API client prefixes their
  calls. Nothing else changes in a view that is already scoped.
- Query keys carry the scope: `["me", scope, …]`. Without it, a switch
  briefly paints your data under the agent's header. A test pins that no
  `["me", …]` key lacks it.
- Two rail tables, `RAIL_PERSON` and `RAIL_AGENT`; the existing rail tests
  (every destination routes, marks its item, has a docs-strip entry, no
  label collision) run over both.
- The agent page splits into the agent's Overview and Settings; its
  hand-built timeline table goes, replaced by the Timeline view.
- The clock stays the viewer's: an agent's console prints times in your
  timezone.
- Analytics report `/agent/timeline`, never which agent: the same hygiene
  the call and email records already get (privacy, bucket three).

## 7. Decisions

**Taken (Jamie, 2026-09-23):**

1. The console can switch into an agent; the selector is the rail header.
2. In an agent's scope you configure it: its tracked players and clans,
   notify switches, and replies on its feedback threads. New feedback is
   always filed as you.
3. Explore is the same for everyone and is not scoped.
4. Integrations stay out; they are being rethought with the public API.
5. Clients connected as an agent move from your Connections to the agent's.

**Open:**

- **a. Slots** — pooled at the owner, counting distinct subjects across you
  and your agents (recommended), or separate per agent.
- **b. The agent adding over MCP** — may the agent itself track a rival
  when asked (recommended; owner-visible in its Activity), or only the
  owner from the console?
- **c. Re-pointing** — can an agent's primary clan change, or only gain
  clans?

## 8. Phases

1. **The seam and a read-mostly agent console.** `resolvePrincipal`, the
   scoped routes that are reads, the selector, `RAIL_AGENT` with Overview,
   Timeline, Explore, Activity, Usage, Connections, Settings (today's agent
   page), Feedback, Status. Agent clients leave your Connections. No new
   write semantics.
2. **Configuring agents.** After §7a–c: the agent Tracking page, pooled
   slots, family agents, and (if §7b) the track tools opened to agents at a
   minor contract bump.
3. **Your console, cleaned.** Person pages show you plus the two
   aggregates; the docs' console map (`connections.md`), the agent
   paragraphs (`roles.md`, `agents.md`) and What's new.

Each phase ships on its own; phase 1 alone already closes the call-log and
feedback gaps.
