# Worked examples now describe both of their answer shapes

Elixir's worked-examples tool can return either its index or one complete example. Both responses already carried the right information, but the published schema incorrectly said every response had the index. It now describes the two forms correctly, so a client that checks responses strictly no longer reports an error. Contract 9.17.1.
