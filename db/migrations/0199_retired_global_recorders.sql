-- 0199: contract the retired global recorder after its reviewed purge.
-- Jamie's 2026-10-02 right-sizing decision removes boards, corpus meta,
-- named recording groups and editorial featured-card state. Deploy only
-- after the approved purge is independently verified and an earlier deploy
-- has removed their last reader, writer, census and purge operation.
-- No CASCADE, canonical game row rewrite or receipt/audit deletion.
-- Empty history/configuration is a precondition. Fresh ladders may retain
-- only bootstrap board configuration when no account exists.
-- Short catalog locks only; fail rather than queue behind a busy reader.
set local lock_timeout = '2s';
set local statement_timeout = '15s';

-- Hold the same locks DROP needs before checking emptiness, so a last
-- obsolete writer cannot insert between the precondition and the drop.
lock table clan_ranking_entry, ranking_entry, ranking_presence, ranking_snapshot,
  ranking_board, card_meta_season_band, deck_meta_season_band,
  meta_season_band_totals, card_meta_season, deck_meta_season, meta_season_totals,
  meta_season_pop_day, meta_season_pop, meta_season_state,
  integration_collection_grant, collection_member, collection,
  email_featured_card in access exclusive mode;

do $$
declare
  retired_table text;
  has_rows boolean;
begin
  foreach retired_table in array array[
    'clan_ranking_entry', 'ranking_entry', 'ranking_presence', 'ranking_snapshot',
    'card_meta_season_band', 'deck_meta_season_band', 'meta_season_band_totals',
    'card_meta_season', 'deck_meta_season', 'meta_season_totals',
    'meta_season_pop_day', 'meta_season_pop', 'meta_season_state',
    'integration_collection_grant', 'collection_member', 'collection',
    'email_featured_card'
  ] loop
    execute format('select exists(select 1 from %I)', retired_table) into has_rows;
    if has_rows then
      raise exception 'retired table % still holds rows; complete the approved purge first', retired_table;
    end if;
  end loop;
  if exists(select 1 from account) and exists(select 1 from ranking_board) then
    raise exception 'ranking_board still holds configuration; complete the approved purge first';
  end if;
end $$;

drop table clan_ranking_entry;
drop table ranking_entry;
drop table ranking_presence;
drop table ranking_snapshot;
drop table ranking_board;
drop table card_meta_season_band;
drop table deck_meta_season_band;
drop table meta_season_band_totals;
drop table card_meta_season;
drop table deck_meta_season;
drop table meta_season_totals;
drop table meta_season_pop_day;
drop table meta_season_pop;
drop table meta_season_state;
drop table integration_collection_grant;
drop table collection_member;
drop table collection;
drop table email_featured_card;
