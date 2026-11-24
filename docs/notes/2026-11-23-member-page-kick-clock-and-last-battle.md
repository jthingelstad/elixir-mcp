# The member page's kick clock and last battle

Two fixes from the review of #1230, the Run Members page and the member page:

- **The kick clock counts the member's own day.** The engine adds a
  member's contribution grace to their removal day (`removal.removal_day`);
  the page showed the policy's base day, so a member with grace read
  "day 15 of 14" when their kick was not due until day 17. The member's
  own day comes first now, the policy's day only when the engine gave none.
- **The last battle comes from the recorded battle.** Quiet days
  (`facts.days_idle`) also count a join and a battle-count rise, so a
  member who joined today with no battle on record read "Last battle:
  Today". The list and the member page now read `facts.last_battle_time`
  and say "No battle on record" or "None on record" when there is none.
