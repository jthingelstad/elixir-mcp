-- 0256: the card-arrays contract, and the storage nothing reads any more.
--
-- 0255 put a participant's, a duel round's and a deck's cards on their
-- own rows as arrays; production filled history with {card_arrays}, the
-- census matched the rows, and every reader moved to the arrays (PR
-- #924). Ingest now writes only the arrays, in the statement that writes
-- the row. Jamie, 2026-11-13: "the same way that you own the code base,
-- you own the database"; of the leftovers: "Agree with your
-- recommendations. I think you can make these calls through this pivot."
--
-- Dropped tables (no deployed reader or writer after this build):
--   battle_participant_card (547 MB) and deck_card (332 MB): 0091's card
--     rows, now the arrays on battle_participant, battle_participant_round
--     and deck. Canonical tables stay lossless: every field moved.
--   series_backfill_state: the cursor of {series_backfill}, retired.
--   email_milestone, email_milestone_look: the milestone mail retired
--     (2026-11-13); only account removal still deleted from them.
--   agent_policy_context_grant, its three revocation triggers and their
--     function: the grant behind clans_context, which retired in 12.0.0;
--     its {clan_context} op goes with this build (DECISIONS "`clans_context`
--     retires").
--
-- Dropped indexes, each with no plan left to serve (the change note,
-- docs/notes/2026-11-13-card-arrays-contract.md, has the evidence):
--   battle_participant_window, _player, _deck, _global_rank, _deck_time on
--   battle_participant; deck_archetype_version on deck.
-- (battle_metadata_cover went in 0249.)
--
-- api_receipt_entity (endpoint, entity_key, receipt_id desc) and
-- api_receipt_entity_time (entity_key, fetched_at desc) become one index
-- on (endpoint, entity_key, fetched_at desc): every entity reader pins
-- the endpoint, and the latest-receipt readers order by fetched_at.
--
-- Kept: clan_state_import. The Clan family client's retirement op
-- ({family_clients: {retire_app}}) still checks its import digest there.
--
-- Deploy: a previous-build ingest that runs after this commits fails on
-- the dropped card tables and its job retries on the new build (beta,
-- 2026-11-13). The index is built first, under a SHARE lock on
-- api_receipt (reads go on, receipt inserts wait for the build); the
-- drops come last so battle_participant, deck, account and service_token
-- are locked only for the instant before the commit. Fail fast behind a
-- long read rather than queue ingest.
set local lock_timeout = '5s';

create index api_receipt_entity_fetched
  on api_receipt (endpoint, entity_key, fetched_at desc);
comment on index api_receipt_entity_fetched is
  '0256: an entity''s receipts by endpoint, newest fetch first; replaces api_receipt_entity and api_receipt_entity_time. Readers order by fetched_at desc, receipt_id desc.';
drop index api_receipt_entity;
drop index api_receipt_entity_time;

drop table battle_participant_card;
drop table deck_card;
drop table series_backfill_state;
drop table email_milestone_look;
drop table email_milestone;

drop trigger agent_policy_context_owner_change on account;
drop trigger agent_policy_context_assignment_change on account_clan;
drop trigger agent_policy_context_credential_change on service_token;
drop function revoke_agent_policy_context_binding();
drop table agent_policy_context_grant;

drop index battle_participant_window;
drop index battle_participant_player;
drop index battle_participant_deck;
drop index battle_participant_global_rank;
drop index battle_participant_deck_time;
drop index deck_archetype_version;

comment on column battle_participant.cards is
  '0255: the card ids this participant played (round 0), indexed by slot: cards[i] is slot i as the API listed them (1-8 in a normal deck). A NULL element is a slot with no card; ''{}'' means a tower troop alone. Null for a duel (its rounds hold the decks). Replaced battle_participant_card (0256).';
comment on column battle_participant.tower_troop_id is
  '0255: the tower troop played (supportCards); null when none.';
comment on column battle_participant_round.cards is
  '0255: this round''s card ids, indexed by slot as battle_participant.cards is, with card_forms, card_levels, card_stars and cards_used beside them.';
comment on column deck.card_ids is
  '0255: the deck''s cards (not the tower troop), in canonical (card_id, form) order; card_forms beside them. Replaced deck_card (0256).';
