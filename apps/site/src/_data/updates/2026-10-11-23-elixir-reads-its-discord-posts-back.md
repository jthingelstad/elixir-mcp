# Elixir reads its Discord posts back once

About a day after Elixir posts a message to a Discord channel (a timeline's cross-post, a clan's Actions or its activity channel), it now reads that message back once, the next time it delivers to the same channel: whether it is still there, how many of each reaction it has (counts only, never who reacted), and whether a thread was started from it. It reads only its own messages, and a read never delays or repeats a post. The [privacy page](/docs/privacy) says so. Nothing changes in what is posted. MCP and JSON API unchanged.
