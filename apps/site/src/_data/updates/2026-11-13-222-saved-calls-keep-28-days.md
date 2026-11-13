# Saved calls keep 28 days

A tool call's saved request and response now go after 28 days, with the
call itself. They used to stay 90 days, but the call log only keeps 28,
and without its call a saved body could not be opened. Settings and
[Limits](/docs/limits#retention-windows) say 28 days now.

The raw game data Elixir archives as it records now keeps a year too,
like the rest of the record.

MCP 13.0.1 and JSON API 5.0.0, unchanged.
