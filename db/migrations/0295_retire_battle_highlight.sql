-- 0295: retire the frozen copy of battle posts after the 0292 deployment.
-- Jamie, 2026-11-17 (#1119). account_post now owns edits and removals.
-- Refuse to drop a copy whose canonical post is missing or misattributed.
set local lock_timeout = '5s';
set local statement_timeout = '5s';
lock table account_post, battle_highlight in access exclusive mode;

do $$
begin
  if exists (
    select 1 from battle_highlight h
    where not exists (
      select 1 from account_post p
       where p.item_id = 'tl_' || substr(encode(sha256(convert_to(
         'battle_highlight|' || h.highlight_id::text, 'UTF8')), 'hex'), 1, 20)
         and p.account_id = h.account_id and p.player_tag = h.player_tag
         and p.battle_id = h.battle_id
    )
  ) then
    raise exception 'Frozen highlight has no matching canonical battle post';
  end if;
end $$;

drop trigger account_post_battle_gone on account_post;
drop function account_post_battle_gone();
drop trigger battle_highlight_moved on battle_highlight;
drop function battle_highlight_moved();
drop table battle_highlight;
