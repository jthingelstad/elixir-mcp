# In Elixir Clan, leaders land on Actions when Actions are waiting

When the leader or a co-leader comes to their clan with Actions waiting
for them, Elixir Clan now opens on Actions rather than the roster: from
the clan's address, from Clans, from the clan switcher and when coming
back from sign-in. With nothing waiting, they open on the roster, as
elders and members always do.

The roster has an address of its own, `/clan/<tag>/roster`. The rail's
Roster and a member page's way back go there, and an address that names
a page always opens that page.

MCP 11.13.1 and JSON API 3.2.0, unchanged.
