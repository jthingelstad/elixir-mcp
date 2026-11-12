# 2026-11-12 — Resuming an agent prices its restored clan first

Codex on #774 found that `setAgentStatus` checked the pool's slots before
it restored the resumed agent's recordings. A clan only that agent records
in full therefore looked stopped, and every member the agent follows was
charged a slot (#760 makes them free while the clan is recorded). A
resume that fits could be refused with `quota_exceeded`.

The agent's recordings are now settled first and the pool priced after,
inside the same transaction; a refusal still rolls everything back. The
claims test "resuming an agent prices its restored clan first" pins it.
