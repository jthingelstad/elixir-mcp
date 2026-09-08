-- Who a tracked player is TO YOU, and who is talking to an agent.
--
-- RELATIONSHIP replaces a boolean that could only say "me / not me".
-- Watching a player is a deliberate act, so the reason is worth recording:
-- an ALT is you under another tag, a FRIEND is someone you follow, WATCHING is
-- everyone else. "How am I playing" across a primary and its alts is a
-- different question from the same query across four unrelated players, and
-- until now the server could not tell those apart.
--
--   primary   you. Exactly one, and required once you track anyone at all.
--   alt       also you, under another tag.
--   friend    someone you follow deliberately.
--   watching  everyone else you have added.
--
-- Slots are unchanged: the four labels share the role's player allowance.
--
-- EXPAND, NOT REPLACE. is_primary stays and keeps being written for one
-- release so anything still reading it is correct; a later migration contracts
-- it away once nothing does.

alter table claim add column relationship text not null default 'watching'
  check (relationship in ('primary', 'alt', 'friend', 'watching'));

update claim set relationship = 'primary' where is_primary;

-- The invariant the boolean's partial index used to carry, moved to the column
-- that now owns the concept. Both exist during the expand window; they cannot
-- disagree because every writer sets the pair together.
create unique index claim_one_primary_relationship
  on claim (account_id) where relationship = 'primary';

comment on column claim.relationship is
  'primary | alt | friend | watching. Exactly one primary per account; the rest share the role player allowance.';

-- WHO IS TALKING TO AN AGENT.
--
-- An agent serves many humans through one connection, and MCP carries no
-- per-request end-user identity. The connecting agent supplies whatever id its
-- own surface has -- discord:1234, signal:..., telegram:..., anything -- and
-- the id is OPAQUE to us on purpose: the point is that any transport works.
--
-- THIS GRANTS NOTHING. Recorded reads are universal, so a mapping only picks a
-- default tag. A wrong one produces a wrong answer that the human notices
-- immediately, not an escalation -- which is exactly why it needs no
-- verification and can be as cheap as an agent asking once.
--
-- Scoped per account, so two clans' agents never see each other's mappings.
-- No expiry: a Clash Royale tag is permanent, and somebody who joins under a
-- new tag is a new person, not the same one renamed.
create table agent_identity (
  account_id   uuid not null references account on delete cascade,
  external_id  text not null check (length(external_id) between 1 and 200),
  player_tag   text not null references player,
  created_at   timestamptz not null default now(),
  primary key (account_id, external_id)
);
create index agent_identity_by_player on agent_identity (account_id, player_tag);

comment on table agent_identity is
  'Agent-scoped map from a caller-supplied end-user id to a player tag. Convenience only: it selects a default subject and confers no access.';
