-- 0124: the two event ledgers' payloads become typed columns (schema
-- review 1.8, Appendix D; plan step 15). Additive and nullable; the
-- fills touch 14k and 12k rows inside this transaction. PostgreSQL
-- stores a null in the row's bitmap, so an event carries only its kind's
-- values. The JSON stays until the readers have moved (the emitter
-- writes both) and drops later.
--
-- What buys more than "right": card, battle and arena become keys
-- instead of copied names, so a card_leveled row cannot name a card the
-- catalog lacks and the "Lava Hound unlocked Lava Hound" class of bug
-- (contract 3.9.0) is structurally impossible; the crossing battle that
-- was copied in as promoted_by / crossed_by (a shape the battle row
-- already holds) is its id, rendered at read time; a rival list that was
-- copied in is war_week_clan; a member's name is the player's. The
-- arena columns take no key yet: the arena catalog is battle-fed and
-- lacks Training Camp (review 3.5, plan step 17 seeds it and adds the
-- keys).
alter table player_event
  add column card_id integer references card (card_id),
  add column badge_name text,
  add column level integer,
  add column prior_level integer,
  add column max_level integer,
  add column arena_from integer,
  add column arena_to integer,
  add column arena_to_name text,
  add column league_from integer,
  add column league_to integer,
  add column value_before integer,
  add column value_after integer,
  add column step integer,
  add column battle_id text references battle (battle_id),
  add column floor integer;

update player_event set
  card_id = case when event_type in ('card_leveled', 'card_unlocked')
                  and exists (select 1 from card c where c.card_id = (payload->>'card_id')::int)
                 then (payload->>'card_id')::int end,
  badge_name = case when event_type in ('badge_earned', 'legendary_badge_earned') then payload->>'name' end,
  level = case when event_type in ('badge_earned', 'card_leveled', 'collection_level_step') then (payload->>'level')::int end,
  prior_level = case when event_type in ('badge_earned', 'card_leveled') then (payload->>'prior_level')::int end,
  max_level = case when event_type = 'badge_earned' then (payload->>'max_level')::int end,
  arena_from = case when event_type = 'arena_changed' then (payload->>'from')::int end,
  arena_to = case when event_type = 'arena_changed' then (payload->>'to')::int end,
  arena_to_name = case when event_type = 'arena_changed' then payload->>'to_name' end,
  league_from = case when event_type = 'ranked_promotion' then (payload->>'from')::int end,
  league_to = case when event_type = 'ranked_promotion' then (payload->>'to')::int end,
  value_before = case when event_type = 'donation_reset' then (payload->>'donations_before')::int end,
  value_after = case event_type
                  when 'donation_reset' then (payload->>'donations_after')::int
                  when 'best_trophies_band' then (payload->>'best')::int
                  when 'career_wins_step' then (payload->>'wins')::int end,
  step = case event_type
           when 'best_trophies_band' then (payload->>'band')::int
           when 'career_wins_step' then (payload->>'step')::int
           when 'collection_level_step' then (payload->>'step')::int end,
  battle_id = case when exists (select 1 from battle b
                                 where b.battle_id = coalesce(payload->'promoted_by'->>'battle_id', payload->'crossed_by'->>'battle_id'))
                   then coalesce(payload->'promoted_by'->>'battle_id', payload->'crossed_by'->>'battle_id') end,
  floor = (coalesce(payload->'promoted_by', payload->'crossed_by')->>'arena_floor')::int;

alter table clan_event
  add column player_tag text references player (player_tag),
  add column role_before text,
  add column role_after text,
  add column joined_observed_at timestamptz,
  add column roster_size_before integer,
  add column roster_size_after integer,
  add column war_season_id integer,
  add column section_index integer,
  add column fame integer,
  add column rank integer,
  add column trophy_change integer,
  add column finish_time timestamptz;

update clan_event set
  player_tag = case when event_type in ('member_joined', 'member_left', 'role_changed')
                     and exists (select 1 from player p where p.player_tag = payload->>'player_tag')
                    then payload->>'player_tag' end,
  role_before = case event_type
                  when 'member_left' then payload->>'role_at_departure'
                  when 'role_changed' then payload->>'role_before' end,
  role_after = case event_type
                 when 'member_joined' then payload->>'role'
                 when 'role_changed' then payload->>'role_after' end,
  joined_observed_at = case when event_type = 'member_left' then (payload->>'joined_observed_at')::timestamptz end,
  roster_size_before = (payload->>'roster_size_before')::int,
  roster_size_after = (payload->>'roster_size_after')::int,
  war_season_id = (payload->>'season_id')::int,
  section_index = (payload->>'section_index')::int,
  fame = (payload->>'fame')::int,
  rank = (payload->>'rank')::int,
  trophy_change = (payload->>'trophy_change')::int,
  finish_time = (payload->>'finish_time')::timestamptz;
