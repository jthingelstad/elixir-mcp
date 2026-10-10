# 2026-10-10 — The agent switcher follows a remove, restore or rename

The Codex review of #441 found that Remove, Restore, Suspend/Resume and
Rename refetched only the Agents list (`["me", "principals"]`), while the
rail's console switcher reads the session (`["me"]`). After removing an
agent from its own console, the switcher still offered it once you left,
until a reload; a restored or renamed agent showed its old state the same
way. Those writes now invalidate `["me"]`, which refetches the session
and everything under it. The account journey test pins it: it fails
without the change.

MCP 11.7.2 and JSON API 3.1.0 unchanged; no migration.
