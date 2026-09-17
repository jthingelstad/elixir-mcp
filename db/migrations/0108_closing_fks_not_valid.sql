-- 0108: the closing foreign keys, NOT VALID (schema review 1.3, plan
-- step 7). Instant: NOT VALID takes the lock for milliseconds and scans
-- nothing; the scans run under SHARE UPDATE EXCLUSIVE in 0112/0113 on
-- the next deploy, so no read or write waits on them. Every writer
-- already satisfies these (deck before participant in one transaction,
-- a stub card before any player_card, war_week upserted first in the
-- race projector), and the 09-16 clone showed 0 orphans on each.
alter table battle_participant
  add constraint battle_participant_deck_fk
  foreign key (deck_hash) references deck (deck_hash) not valid;
alter table player_card
  add constraint player_card_card_fk
  foreign key (card_id) references card (card_id) not valid;
alter table war_participation
  add constraint war_participation_week_fk
  foreign key (clan_tag, season_id, section_index) references war_week not valid;
alter table war_attendance_day
  add constraint war_attendance_day_week_fk
  foreign key (clan_tag, season_id, section_index) references war_week not valid;
alter table war_week_clan
  add constraint war_week_clan_week_fk
  foreign key (clan_tag, season_id, section_index) references war_week not valid;
-- NOT added, by decision: war_week.season_id -> season (war_season_id).
-- The war tables' integer key is the API's own for that surface, and
-- the season row's number is DERIVED from the month and verified against
-- each log entry (0104). A foreign key would turn a mismatch into a
-- refused riverracelog admission - the API's fact rejected because our
-- derivation disagreed - where the settled rule is an alarm and never a
-- relabel. The check runs in the projector; the alarm rides the metric.

-- Declined, with the reason on the column so the question is not
-- re-asked (review 1.3): the participant's clan is a filter for OUR
-- clans' timelines, never a join, and 176,881 rows name 100,628 clans
-- the record does not keep; a board entry's clan is a label.
comment on column battle_participant.clan_tag is
  'The API''s clan tag for this participant at battle time; a filter, not a reference (no FK by decision, review 2026-09-16 1.3: opponents'' clans are not recorded).';
comment on column ranking_entry.clan_tag is
  'The API''s clan tag on the board entry; a label, not a reference (no FK by decision, review 2026-09-16 1.3).';
