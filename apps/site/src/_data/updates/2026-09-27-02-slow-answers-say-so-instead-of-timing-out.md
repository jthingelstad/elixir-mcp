# Slow answers say so instead of timing out

A read that runs long, or waits behind maintenance, now answers with a retry hint wherever you ask, in Explore and through the JSON API as well as through your agent, instead of the page or request timing out. The deck-set planners also stop at a time limit and hand back the best sets they found. Contract 9.12.2; JSON API 2.6.2.
