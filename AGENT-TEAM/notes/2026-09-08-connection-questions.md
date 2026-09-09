# Questions after connecting

Jamie approved the connection-screen starter questions. The implementation uses
curated templates selected from recorded history, shared with the overview.

- Account → Connections has “Try asking…” cards with full-prompt previews and
  copy buttons. Clipboard refusal offers a selectable textarea.
- Questions follow available profile/battle/deck/week evidence. An account-added
  clan gets a war question only when it has a recorded war week; the primary
  qualifying clan is preferred. No extra MCP invocation or AI generation.
- New accounts get an Overview link; pending captures get waiting/refresh copy;
  readiness failures retain connection controls and offer retry.
- `npm run verify`: 535 tests (468 Node, 67 UI), formatting, lint, Knip and both
  site builds pass. The real-API scratch journey now includes a fixture OAuth
  connection, the connection page, copying a profile question, and zero MCP
  audit calls resulting from that copy. New coverage checks template selection,
  clan membership/record readiness, manual copy, empty/waiting states and retry.
- Local browser fixtures verified the desktop connection screen and successful
  copy confirmation with no app console errors. A true 390×844 viewport verified
  single-column cards and copying; DOM client/scroll widths both 390. Temporary
  tabs, viewport override and fixture server were cleaned up.
- Public guide and What's-new entry ship with the feature. No migration,
  collector release or MCP contract bump is needed.
