-- The battle log names the player who chose each set of C.H.A.O.S. modifiers.
-- Older receipts without choices leave the set unknown.
set local lock_timeout = '5s';
alter table battle_participant add column chaos_modifiers text[];
