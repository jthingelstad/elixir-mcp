# Your agent follows, and reads the social layer

The names an agent or an app calls now say follow, as the app does:
`elixir_follow_player` and `elixir_follow_clan` follow a player or a clan,
and the day-by-day series are `players_series`, `clans_series` and
`clans_members_series`. The OAuth scope that adds them reads **Change who
you follow**.

Your own agent can now read the social layer for you, and never writes it:

- **`players_follows`**: who a player follows and who follows them, with
  their badges, as their player page shows it.
- **`players_highlights`**: the highlights a player posted, newest first.
- **`elixir_cheers`**: the cheers other people gave the items about your
  player, as counts by kind, never who.
- **`clans_directory`**: the clan directory, each clan's tile and the
  public part of its rules.

They read as you, for your own connection and the agents you own; an app's
integration key reads none of them. An agent still never cheers, posts a
highlight or follows anyone you did not ask it to.

Some tools fold or retire. `battles_trends` is now `battles_performance`
with a `segment`. `elixir_identify` is gone: connect Discord under
Settings › Connections & agents and your clan's agent knows you without
asking. `clans_context` gives way to `clans_directory`, and the service's
own numbers that `elixir_data_insights` read stay public at
`/api/public/stats` and on [Status and data](/data).

MCP 12.0.0, a major: refresh your tool list. The JSON API is 3.6.0, with
four new reads.
