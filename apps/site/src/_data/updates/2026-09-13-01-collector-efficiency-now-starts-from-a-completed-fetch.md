# Collector efficiency now starts from a completed fetch

The Admin collector table counted both requests every completed fetch must make — its lease and its submitted result — but compared that pair with one fetch. A perfectly efficient collector therefore appeared to make two calls per fetch. Calls/fetch now starts at that required pair, so 1.0 means no extra check-ins; the fleet's scheduling, pacing and shared Clash Royale API budget are unchanged.
