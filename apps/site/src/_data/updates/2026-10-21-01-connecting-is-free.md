# Connecting no longer spends your hour

Your MCP hourly limit now counts calls only: tool calls, and reading a
docs page or a prompt. Connecting does not count. When a client starts
up it says hello, lists the tools, resources and prompts, and sends a
notification; none of that spends your 300 an hour any more, so a client
that reconnects often keeps its whole hour for questions. Every message
still needs your credential.

MCP 11.13.3 (a correction) and JSON API 3.2.0, unchanged.
