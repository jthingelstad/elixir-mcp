-- Schema hygiene from the 2026-09-15 audit (Jamie): retire what nothing
-- reads, and constrain the internal enums that were open text.
--
-- Dropped (no reader anywhere in the services; payload provenance stays
-- in the S3 archive, so any of these can be re-projected if a tool ever
-- wants one):
--   battle_observation   not written since 2026-09-12 (receipts + the
--                        high-water mark replaced it); its FK to
--                        api_receipt was the one thing keeping receipts
--                        from ever being pruned
--   clan_daily_metrics   never written, never read (0001 design residue;
--                        the same-named table in backfill-replay-backups
--                        is elixir-bot's SQLite, not this one)
--   gateway_lease        never used; leasing lives on job.leased_by (0040)
--   player_current_deck  written on every profile poll, never read;
--                        currentDeck is client-synced and useless for
--                        Verify (docs/NOTES 2026-09-12)
--   game_tournament      raw tournament payloads written by the rankings
--                        projector, never read
--
-- Constrained: mcp_call_audit.principal_kind (person | agent | integration,
-- null before 0063) and mcp_call_audit.surface (mcp | rest | web | svc:<name>).
-- Left open on purpose: clan_membership.role and battle.type are the
-- API's enums (ingest never fails on a value the game adds); account_event
-- .kind grows with the product and a migration per kind is the wrong tax.

drop table battle_observation;
drop table clan_daily_metrics;
drop table gateway_lease;
drop table player_current_deck;
drop table game_tournament;

alter table mcp_call_audit
  add constraint mcp_call_audit_principal_kind_check
  check (principal_kind is null or principal_kind in ('person', 'agent', 'integration'));

alter table mcp_call_audit
  add constraint mcp_call_audit_surface_check
  check (surface in ('mcp', 'rest', 'web') or surface like 'svc:_%');
