-- Deck archetypes (docs/reviews/2026-09-20-DECK-ARCHETYPES-DESIGN.md).
--
-- Grammar in code, vocabulary in data. The classifier (packages/contracts
-- archetypes.ts) composes "<win condition(s)> <family>" from a deck's
-- cards; WHICH cards are win conditions, bait units and bridge partners
-- is community fact, kept in cr-agent-api-docs data/card-roles.json and
-- data/deck-aliases.json with a public source per entry, and imported
-- here by infra/scripts/import-card-roles.mjs at deploy (the Lambdas
-- have no internet; the operator's checkout has the sibling repo). The
-- file's commit is the vocabulary's version and rides every archetype
-- object beside the grammar's own.
--
-- Not bound to the season: a role is a property of the card, not of the
-- month it was learned in, and history is relabelled on purpose when the
-- vocabulary improves. The file's git history is the ledger.

create table card_role (
  card_id        integer primary key references card,
  name           text not null,
  tier           numeric(4,1),                 -- win-condition priority; null for a bait win condition
  family         text check (family in ('beatdown','control','cycle','bait','bridge_spam','siege')),
  at_cycle_cost  text check (at_cycle_cost in ('beatdown','control','cycle','bait','bridge_spam','siege')),
  needs_partner  boolean not null default false,
  pairs_with     jsonb,                        -- [{id, family?}]
  bait_tiers     jsonb,                        -- {"2": 6.5, "1": 8, "0": 9.9}
  bait_unit      boolean not null default false,
  bridge_partner boolean not null default false,
  source         text not null,
  attested_at    date,
  roles_version  text not null                 -- the vocabulary file's commit date-time
);
comment on table card_role is
  'Which cards anchor a deck''s archetype name and how (cr-agent-api-docs data/card-roles.json, imported at deploy). A card absent here is not a win condition.';

create table deck_alias (
  alias          text primary key,             -- as written; matched after normalisation
  alias_key      text not null unique,         -- lower-case, letters and digits, single spaces
  cards          integer[] not null,
  family         text check (family in ('beatdown','control','cycle','bait','bridge_spam','siege')),
  source         text not null,
  attested_at    date,
  roles_version  text not null
);
comment on table deck_alias is
  'Community deck names the grammar does not produce, and what each resolves to (data/deck-aliases.json). Read when a person names a deck; never used to label one.';

-- The vocabulary in force: one row.
create table card_role_version (
  singleton      boolean primary key default true check (singleton),
  roles_version  text not null,
  source_commit  text not null,
  imported_at    timestamptz not null default now(),
  roles          integer not null,
  aliases        integer not null
);
comment on table card_role_version is
  'Which commit of cr-agent-api-docs the card roles and deck aliases were imported from, and when.';
