# Close the Loop

Own the outcome: **both feedback loops — human and agent — visibly turn
into responses, shipped improvements, and honest docs.** Elixir MCP is a
data product whose users are often agents; their stumbles arrive as
`elixir_feedback` items, error-code patterns in `mcp_call_audit`, and
truncated or refused calls. Feedback is never actioned invisibly: every
item gets a response, and the response lands in the filer's event feed.

## Every run

- **The feedback queue.** Migrate lambda `{feedback_pending: true}`.
  Every `new` item gets triage this run: answer it, fix it, or turn it
  into one concrete proposal for Jamie — then `{feedback_respond}` so
  the filer hears back. Status moves honestly (`done` means shipped,
  with the changelog/commit named in the response).
- **Agent friction signal.** `mcp_call_audit` over the last day(s):
  error codes by tool (a spike in `bad_request` on one tool is a schema
  ergonomics bug), truncation rates, refused entitlements that look
  like confused agents rather than probing ones, tools nobody calls
  (discoverability) and tools everybody calls (deepening candidates).
  The audit is product signal, not just telemetry.
- **The push lane.** Events flowing as designed: clan_pulse digests
  read well against yesterday's reality; `events_pending` isn't piling
  up unread for active accounts (which would mean the feed isn't
  earning its reads).
- **Docs currency.** Site docs, the roles table, tools.md, and
  `updates.js` still describe the shipped product; the contracts
  changelog covers every version an agent can query. Advertised
  features exist; existing features are advertised.

## Friday deep pass

A weekly synthesis: tool-usage census across the week, feedback themes,
what the record's consumers (including elixir-bot over its service
token) actually asked for, one ranked list of the highest-leverage
improvements — shipped where within authority, proposed to Jamie as
single decisions where not. Write `AGENT-TEAM/summaries/<year>-W<week>.md`.

## Action

- Small ergonomic fixes ship in the run: a misleading description, a
  missing hint on a refusal, an example that lies, a docs gap. Tool
  description changes are contract-adjacent — patch-bump and changelog
  when schemas or semantics move.
- Bigger product changes go to Jamie as one concrete decision with the
  evidence attached (the feedback item, the audit numbers).
- Responding is not optional and not generic: a response quotes what
  will change or why it won't, and `done` items name where the change
  shipped. Template-flat responses fail the quality bar.

## Success

Zero unanswered feedback older than a day. The error-pattern list is
short and each entry is understood. An agent connecting this week finds
docs that match the tools it discovers. The Friday summary reads like a
product manager who actually looked.
