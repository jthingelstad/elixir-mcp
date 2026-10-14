# 2026-10-13 — A quieter application interface

Jamie approved the roster, timeline, Action, settings and mobile Standing
concepts and asked to implement the direction throughout Elixir. The
product tabs, left rail, existing routes and access boundaries stay.

## Product questions and the briefs' answers

- What comes first? Console: orientation and the person's record; Clan:
  the roster, standing and human decisions; Ladder: one mode's record.
  Data and controls lead; repeated explanations become contextual help.
- Can completed setup disappear? Console requires recording truth and a
  clear next step. Only healthy recording collapses; incomplete, failed,
  partial or unknown capture stays visible.
- Can settings become simpler? The person's and clan's switches remain
  explicit. Current state stays in rows; the full editor opens in a
  drawer, with existing save, confirmation and permission checks.
- Can an Action be shortened? Clan requires the evidence, saved policy,
  words to send and human decision. Evidence and message sit beside the
  decision; history expands below. No decision is automated.
- Can Ladder combine facts? No: its brief keeps modes separate. Mode
  controls and counts stay; introductory record semantics expand on demand.

## Implementation

Shared violet surfaces and Inter titles replace bright framing and
repeated boxed panels across the app and content site. The roster uses
its available width; recent changes and recruiting expand below it.
Timeline becomes an event list, with sharing in a drawer. Settings show
current state before opening the existing editors. Standing leads with
the person's own status and groups. Overview leads with activity, folds
healthy setup and invitations, and links to the person's record.
Connections initially show active agents, with inactive agents available
on demand; permissions expand before editing. Table headings use sentence
case, and Discord previews render safe Markdown.

Engineering defaults: a native dialog provides modal focus and Escape;
native details provide expandable help. Existing routes, server roles,
API calls, grants, data meanings and mutation safeguards stay intact.
These are implementation choices under the approved interface direction.
[engineering, 2026-10-13]

## Validation and release

The targeted UI suites exercise new disclosures while preserving the
existing decision, mail, access and recording tests. Full validation and
built-app browser journeys are required before release. Browser plugin
is not available; repository Playwright journeys and the in-app browser
provide rendered verification.

MCP 11.13.0 and JSON API 3.2.0 are unchanged. No tool response, database
schema or infrastructure changes; tool acceptance is not required for
this interface-only release. No sibling runtime needs a change.
