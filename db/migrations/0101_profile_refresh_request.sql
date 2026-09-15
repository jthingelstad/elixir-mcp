-- 0101: a profile refresh the battle stream asks for. Additive, nullable;
-- NULL means "nothing asked" and the planner behaves exactly as before.
--
-- Every profile-derived moment (arena, best-trophies band, badges,
-- collection level, card unlocks) surfaces only when the profile is
-- polled, and an active player's profile is polled every eight hours by
-- design (2026-09-09: profiles were 70% of poll spend for a projection
-- that is a daily snapshot). x.x.hari.x.x reached Royal Crypt at 06:52Z
-- on 2026-09-15 and the timeline said so at 14:27Z; the battle log, polled
-- many times in between, carried the new arena on every entry.
--
-- The battle log cannot be the fact: a battle's arena is the HIGHER
-- side's arena, so a player 30 trophies under a gate sees the next arena
-- on their own log whenever they meet someone standing on it (checked
-- live against three such pairs). It can be the trigger. When an observer
-- wins or ties on trophies against their opponent, the battle's arena is
-- theirs; if that differs from their last snapshot, ingest stamps this
-- column and the planner pulls the profile at its next tick, roster gate
-- or not. Admission after the stamp satisfies it; nothing clears it.
alter table poll_state add column refresh_requested_at timestamptz;

comment on column poll_state.refresh_requested_at is
  'When ingest last saw evidence this profile is stale (an arena on the player''s own battles that the snapshot does not carry). Served once last_admitted_at passes it; NULL = nothing asked.';
