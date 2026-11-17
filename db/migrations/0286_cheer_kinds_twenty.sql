-- 0286: the cheers grow from six to twenty.
--
-- Jamie, 2026-11-17, after seeing the one-tap control: "Reactions should
-- not need words next to them. And give more options." and "Give 6
-- reactions to the user and even more on a tap for more options." The six
-- of 0243 keep their ids and come first; fourteen more, all celebrating or
-- playful (players are often kids), join the check
-- (docs/notes/2026-11-17-reactions.md; the names and glyphs are the web
-- app's, apps/web/src/home/cheer-set.js).
--
-- Replacing a CHECK is a drop and an add NOT VALID in one file (migration
-- skill, shapes.md; 0284 the same). The new list holds every old value,
-- so nothing stored can violate it, and the VALIDATE is left for a later
-- file. The code serving while this commits still accepts only the six,
-- so nothing writes a new kind until the deploy flips.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table timeline_cheer
  drop constraint timeline_cheer_cheer_check,
  add constraint timeline_cheer_cheer_check
    check (cheer in ('well_played', 'on_fire', 'royal', 'wow', 'ha', 'grind',
                     'love_it', 'good_game', 'congrats', 'clutch',
                     'high_five', 'champion', 'nailed_it', 'climbing',
                     'big_brain', 'ice_cold', 'close_one', 'lucky',
                     'fun_to_watch', 'getting_better')) not valid;

comment on column timeline_cheer.cheer is
  '0243, widened by 0286: one of the twenty cheers: well_played, on_fire, royal, wow, ha, grind (the six of 0243), love_it, good_game, congrats, clutch, high_five, champion, nailed_it, climbing, big_brain, ice_cold, close_one, lucky, fun_to_watch, getting_better.';
