# Event duels count their decks

A battle played as three games on three decks, like an event's
multi-deck mode, now counts in your deck and card stats. Each game is
one game on its own deck, won or lost on its own crowns.

These games stay with the event. They never mix into your Clan Wars or
Trophy Road numbers. Before, those battles counted as having no deck,
so your stats left their games out.

MCP 13.1.0: `battles_decks`, `battles_performance` and `battles_cards`
know these battles as duels; `duel_decks` rows name their mode. JSON API
unchanged.
