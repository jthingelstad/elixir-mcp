import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.7.1",
  date: "2026-09-25",
  summary: md(
    '`battles_deck_upgrades`: each option now says which decks of the set it lifts (`lifts`: the decks whose value it raises, before and after), so an agent can say "Miner lifts your Mortar deck" without comparing sets. Read back through a clan\'s agent, 9.7.0 left that to `set_after`, and the agent named the card but not the deck. `decks_affected` is described as what it is: candidate decks holding the card, not decks it improves.',
  ),
} satisfies ChangelogEntry;
