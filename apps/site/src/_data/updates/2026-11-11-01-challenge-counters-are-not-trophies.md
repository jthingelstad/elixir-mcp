# A challenge's win counter is not trophies

In a Classic Challenge, a 20-Win Challenge and other event runs, the game
reports the run's win counter where a ladder battle reports trophies. A
standout sitting's `best_win` now rates only wins whose trophies are a
real standing (Trophy Road, Path of Legends, the seasonal Trophy Road),
so its opponent's `starting_trophies` is always trophies, and a sitting's
`trophy_net_by_mode` no longer counts a challenge's +1 a win
([Timeline](/docs/timeline)).

MCP 11.18.7 (a correction). JSON API unchanged.
