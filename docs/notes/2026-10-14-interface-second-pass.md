# 2026-10-14 — Controls and records on the secondary pages

Jamie asked to repeat the review, concept, implementation and release process
after the first interface cleanup. This pass deepens the existing Interface
decisions; the shell and product behavior stay the same.

## Product questions and the briefs' answers

- Console's switches are explicit. Email shows each kind, its actual local
  schedule, applicability and switch, with the master switch and sent records.
  Calendar empty days add no decision. Existing seven kinds and schedules stay.
- Clan's channel posts, while people choose its settings. Channel, categories
  and voice show current state before their editors. Failed delivery, missing
  policy, refused model keys, unattended posting and costs stay visible where
  the relevant choice is made. No model preview or test post runs on opening.
- Recruit serves a member copying the clan's words. Its selected editable copy
  comes first; facts, freshness, problems and the leader's pitch stay reachable.
  Each format keeps its unsaved edits while switching. No pitch saves itself.
- Activity is evidence, never a verdict. The window, unknown capture, partial
  weeks and withheld attribution remain visible. Generic method explanations
  can expand beside the corresponding data. Away and Scout keep their primary
  forms visible. Explore is deliberately not polished (Console principle 5).

## Design inventory and fidelity

Fresh concept screenshots: Discord `exec-0238f597`, email `exec-6ba72340`,
Recruit `exec-08dc44cb` in the task's generated-image artifacts. The first
phone generation was rejected: it invented mail kinds and drew a desktop.
The corrected phone concept is `exec-26fbb976`; the responsive implementation
follows its rows and existing mobile shell.

Keep existing tokens (#100d20 canvas, #141025 rail, #30283f rules), self-hosted
Inter, 28/24px titles, existing Elixir art, exact rail labels and kit icons.
The generated concepts' altered marks/navigation are intentionally rejected;
only the content layouts guide this pass. No new raster assets ship.

Allowed content: current title, one short task sentence, API mail names and
local schedules, master/individual switches, last-send links; Discord's three
state rows/Manage controls, warnings and delivery history; Recruit's facts
strip, format select, one copy editor/Copy/Reset, pitch and facts disclosures.
Native drawers retain Escape, focus restoration and discard on close. Pending
operations stay observed by the parent across reopening, including previews.

MCP 11.13.0 and JSON API 3.2.0 stay unchanged. No tool/schema/infrastructure
change; tool acceptance is not needed. Full verify, built-app journeys and
read-only authenticated production checks precede completion. Browser plugin
is absent; the repository's Playwright suite and in-app browser supply QA.

## Review and validation ledger

The consistency reviewer found that a refetch of one generated recruiting
format could clear the other draft. Independent source updates and a refetch
regression preserve the existing semantics. The carried-forward posting badge
also claimed posting with no policy or enabled category; the summary now says
why that connected channel is not posting. Native editor dismissal, pending
save/refused-response races, pending previews and local-only copying are guarded.

Visual comparison checks: existing shell/marks and icons retained intentionally;
matched violet palette, plain row container model, typography hierarchy, concise
copy, selected-format ordering and mobile switch alignment. Generated conceptual
navigation and oversized headings never replace the established shell. Fresh
browser screenshots at 390, 820 and 1280 show the implementation. No app errors,
accessibility violations, blank render or overflow is accepted. Production checks
read only; real webhooks, model previews, switches and clan decisions are not
changed for verification.
