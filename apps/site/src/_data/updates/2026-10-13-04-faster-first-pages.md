# Faster first pages

Elixir's Console, Ladder and Clan now begin with a page rendered by the server,
including your sign-in state. The sign-in form is ready as the page arrives,
and a returning visit no longer waits for a separate session check before the
account bar can appear. Your existing sign-in continues to work; email links,
codes and connections to your assistants keep their addresses.

Elixir's HTTP services now run on AWS Lambda Web Functions. Public corpus
statistics come from an hourly snapshot, with its timestamp, so opening a page
does not need to recount the entire history. MCP 11.13.0; JSON API 3.2.0 unchanged.
