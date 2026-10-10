# Deck meta carries less JSON through its aggregation

Deck meta now keeps only a participant key for each deck's latest qualifying observation during its aggregation, then reads the full deck only for the returned rows. It no longer sorts and collects every full deck JSON before applying the result limit. Counts, rates, shrinkage and the latest-observation example are unchanged, and the query budget still bounds slow calls.
