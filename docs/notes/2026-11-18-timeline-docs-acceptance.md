# 2026-11-18 - Conditional Timeline attester acceptance

The Timeline docs correctly describe `facts.attested_by` on attested
items. `factItems` reads only authorized facts in the requested window;
`readFactItems` emits the app, player tag, name and role. Clan's own
computed fact has null actor fields. A natural acceptance window can
contain no visible attested item, leaving the generic docs audit without
that field even though the canonical source and per-kind contract support it.

The ship triage rule for a real conditional field applies. One
`elixir_timeline` entry in `acceptance/catalogue-allow.json` names the
condition and repository guards. It changes no generic checker and grants
no allowance to other tools or to other absent tokens. The local harness
regression reproduces the exact missing-field error before that entry,
then accepts the quiet window while rejecting an invented field and
another tool's use of `attested_by`.

The canonical reader's scratch fixture proves actor and app-only attester
shapes, the required-field contract and absence for an unauthorized reader
or a quiet window. A synthetic fixture is not a captured bite, and none is
labelled as live evidence. No production event is created for acceptance.

Catalogue notes/docs cases consume phase-1 responses and shared field
evidence across tools. Running only a phase-2 docs case makes no door
calls. The handbook now describes this dependency, so a narrowed subset
does not become false proof or a reason for extra allowances.

This is harness-only triage. MCP 13.13.0 and JSON API 5.1.0 remain
unchanged; no runtime, legal wording or user-facing promise changes, and
no deployment is required. Production closure is a full catalogue/gate
read from the merged, green main, owned by the release coordinator.
