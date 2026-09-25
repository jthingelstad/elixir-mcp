-- 0178: attested facts, and the clans:attest capability.
--
-- Jamie, 2026-09-25 (the doors plan's door 3): the family's apps tell
-- Elixir what a person did in a clan (a departure a leader classified as
-- a kick or a leave, a promotion made, an award granted, a member away, a
-- message sent to the clan) and what a family app's own game produced for
-- a player (a personal record in Elixir Drop). Elixir had no place for
-- them: the record is what collectors saw, and elixir-bot, the old home of
-- community facts, is being retired. They live here, APART from the game
-- record (player_event and clan_event stay collector-only), each labelled
-- with the app, the attesting person, their player and role, and when.
--
-- A new table is catalog-only. The grant shape constraints (0047, 0082)
-- enumerate the canonical scope order, so clans:attest is appended there:
-- dropped and re-added NOT VALID here (every existing grant still
-- matches), validated in 0179. Both tables are small (one row per
-- connection); lock_timeout bounds the brief ACCESS EXCLUSIVE.

set local lock_timeout = '5s';

create table attested_fact (
  fact_id             bigint generated always as identity primary key,
  subject_kind        text not null check (subject_kind in ('clan', 'player')),
  clan_tag            text,
  player_tag          text,
  fact_type           text not null check (fact_type in (
    'departure_classified', 'role_change_made', 'award_granted',
    'member_away', 'clan_message', 'personal_record')),
  detail              jsonb not null,
  visibility          text not null check (visibility in ('clan', 'leaders', 'player')),
  source              text not null,
  source_ref          text not null check (length(source_ref) between 1 and 128),
  attester_account_id uuid references account on delete set null,
  attester_tag        text,
  attester_role       text,
  occurred_at         timestamptz not null,
  recorded_at         timestamptz not null default now(),
  check ((subject_kind = 'clan') = (clan_tag is not null)),
  check (subject_kind = 'clan' or player_tag is not null),
  unique (source, source_ref)
);

create index attested_fact_clan on attested_fact (clan_tag, recorded_at)
  where clan_tag is not null;
create index attested_fact_player on attested_fact (player_tag, recorded_at)
  where subject_kind = 'player';

comment on table attested_fact is
  'What a person did in a clan through a family app, or what a family app''s own game produced for a player (0178). Never game observations: those enter only through collectors. One row per (source, source_ref); a later write with the same ref is the attester''s newer word.';
comment on column attested_fact.visibility is
  'clan: anyone whose verified player is in the clan; leaders: a person whose verified player leads it (never an agent or mail); player: whoever has the player on their timeline. From the type (@elixir-mcp/contracts ATTESTED_FACT_TYPES).';
comment on column attested_fact.source is
  'The family app that wrote it: the first-party client''s origin host (clan.poapkings.com) or the integration''s name (elixir-drop).';
comment on column attested_fact.source_ref is
  'The app''s own id for the fact (Elixir Clan''s action id), so a retry is the same fact and a correction replaces it.';

alter table oauth_code drop constraint oauth_code_scope_shape;
alter table oauth_code add constraint oauth_code_scope_shape check (
  scope ~ '^cr:read( recordings:write)?( collections:write)?( account:write)?( feedback:write)?( account:email)?( clans:attest)?$'
) not valid;
alter table oauth_family drop constraint oauth_family_scope_shape;
alter table oauth_family add constraint oauth_family_scope_shape check (
  scope ~ '^cr:read( recordings:write)?( collections:write)?( account:write)?( feedback:write)?( account:email)?( clans:attest)?$'
) not valid;

comment on column oauth_family.scope is
  'Canonical space-separated OAuth grant, in OAUTH_SCOPE_DETAILS order. account:email (0082) and clans:attest (0178) are granted only to a family app that asked for them by name.';
