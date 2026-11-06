---
slug: ladder-cards
title: "Ladder cards"
description: "The Cards tab in Ladder: the cards recorded in your season and how they went."
section: ladder
order: 5
navTitle: "Cards"
icon: square-stack
lede: "The cards you played this season, and how each one went."
guide: ladder
---

# Cards

## Cards

**Cards**, at `/ladder/cards`, is one mode's season card by card, with
the same chips as every tab. An evolution or a hero is a
different card from its base form, so each keeps its own row, as the tools
keep it. Each card's name opens its public page, which holds the card's
catalog facts: rarity, elixir cost and forms.

- **Your cards**: from [battles_cards](/docs/tools/battles#battles_cards)
  with `perspective: mine`: for each card and form, the battles where your
  deck held it, your record in them and the share you won. A card in more
  than one deck carries all of their battles, so the rows overlap and
  never add up. The tool leaves out cards played in fewer than three
  battles, and the page says so.
- **Across the table from you**: the same tool with
  `perspective: opponent`: each card your opponents played, how many
  battles you faced it in, your record in those battles, and the level
  gap: your deck's average card level minus your opponent's in those
  battles, on the game's level scale, or a dash where the record has no
  levels. The longest lists show twelve rows until you ask for all.
- **Opponents**: from
  [battles_opponents](/docs/tools/battles#battles_opponents): how many
  different players you met in the mode this season, and each one you met
  more than once, with your record against them and the level gap where
  the record has it.
- **Order what you faced**: the cards across the table and the opponents
  you met again read most battles first. **Most losses** is a choice you
  make, never the page's default: it asks the same tools for
  `sort: "losses"`, the most battles you lost first and, at equal losses,
  the most battles. A card is listed only from three battles and a player
  from two meetings, and the page says so beside the choice, so a single
  loss does not lead the list. The order is part of the address
  (`/ladder/cards?order=losses`), and the chips and the Season list
  keep it. It puts no label on any row: the record, in the order you
  asked for.
