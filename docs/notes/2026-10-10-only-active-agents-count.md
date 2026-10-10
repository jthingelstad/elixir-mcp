# 2026-10-10 — Only active agents count against slots

Jamie, 2026-10-10: "Only active ones should count against usage slots."
A person's recording slots were pooled across them and every agent they
own, suspended or not.

The pool (`packages/claims/src/pool.mjs`) is now the person and their
active agents. Because recording ran on any account's tracking, freeing
the slots alone would have let an owner fill an agent, suspend it, make
another and record without limit (the agent limit counts only active
agents). So, Jamie's choice the same day, a suspended agent's tracking is
also no reason to record: `reconcileRecording` leaves it out. A subject
someone else tracks keeps recording, at the widest scope still asked for;
game data is never deleted.

Suspend and resume are now the claims package's `setAgentStatus`, which
settles the agent's subjects in the same transaction (account, owner,
then subjects in tag order). Resuming is refused, `409 quota_exceeded`
with a message naming how many to free, when it would take the pool past
a ceiling it is not already past. The op `{agent_recordings}` (dry run by
default) settles the agents suspended before this shipped; it runs once
after the deploy.

MCP 11.7.2 and JSON API 3.1.0 unchanged; no migration.
