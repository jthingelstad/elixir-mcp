# Faster empty polls, and a faster corpus count

The skip_empty check that lets an empty timeline poll answer at once was slow when the reader asked for quiet_crossed, the moment a member goes quiet: it looked at every recorded battle to find one. It now looks only at the battles of the players the reader follows, so an empty poll answers in milliseconds whichever kinds it asks for. elixir_data_insights also counts the stored daily snapshots in one pass instead of four. Both answers are unchanged. MCP 11.7.1; JSON API 3.1.0 unchanged.
