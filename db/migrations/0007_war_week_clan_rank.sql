-- 0007: final placement on standings (riverracelog carries rank and
-- trophyChange per clan per finished week — the headline war stat).
alter table war_week_clan add column rank integer;
alter table war_week_clan add column trophy_change integer;
