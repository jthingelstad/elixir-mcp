# Card meta finishes, and zero means zero

Four card-meta reads arriving together exhausted the MCP door's 25-second limit: player, clan and collection windows were filtering time after the battle join instead of using the participant-time index built for exactly that access path, and the card query scanned its denominator twice. Both are fixed. The two pending counters in every response now say 0 when their queues are empty instead of disappearing, so a scheduled agent does not re-read its feedback ledger just to discover nothing changed. Contract 1.7.1.
