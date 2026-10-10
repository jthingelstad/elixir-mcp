# Clan request timing separates storage and lock waits

Clan request diagnostics now include private-state operation counts and timing, plus time waiting for the clan lock. This helps explain slow Actions without recording SQL, state keys or message content. Contracts unchanged.
