# A failed read is tried again in minutes

When a read of the game failed, the recorder used to wait for that subject's next turn: a day for a profile, and for a leaderboard or the events calendar that failed just after the 10:00 UTC reset, the whole day. It now tries again 15 minutes later, then 30, then 60, inside the same shared budget, so a short Clash Royale outage costs minutes. The battle-log schedule also keeps its promise exactly: the small per-player offset that spreads reads out can no longer stretch a wait past two hours. No change to the tools.
