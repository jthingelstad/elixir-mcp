# The tool changelog is gone; What's new tells what changed

For people who run an agent on Elixir. The `elixir_changelog` tool and the `elixir://changelog` resource are gone, and so are the numbered versions on this page and in the feeds. What's new, here and through `elixir_updates`, is where a change is told, tools included. Not every small change gets an entry: the ones worth knowing about do.

The version your agent sees when it connects is now a fingerprint of the tools, a short code like `tools.3f1c9a2b7d4e`. Every answer carries the same code. It changes whenever a tool, an argument or a description changes, and at no other time. When it differs from the one your agent remembers, have it read the tool list again. It is not a number, so a bigger one does not mean newer.

A change that breaks how an agent calls Elixir stays rare, and it is told here.
