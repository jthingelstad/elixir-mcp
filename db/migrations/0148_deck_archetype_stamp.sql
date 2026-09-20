-- The archetype stamped on every deck (design phase 2, §7). A cache of
-- the pure function in packages/contracts archetypes.ts over the deck's
-- cards, the catalog's costs and the vocabulary in force, kept so the
-- meta readers can group a season by archetype and filter the whole
-- population by name without classifying thousands of decks per call.
-- The version it was stamped under (grammar + roles, as one string)
-- rides beside it: the nightly re-stamps every row whose version is not
-- current, so a rule change or a vocabulary import reaches history by
-- the next morning. Written at deck insert (deck-cards.mjs) so a new
-- deck is never unstamped for long; null only before the first stamp.
alter table deck
  add column archetype_family         text check (archetype_family in ('beatdown','control','cycle','bait','bridge_spam','siege','unclassified')),
  add column archetype_label          text,
  add column archetype_win_conditions integer[],
  add column archetype_version        text;
create index deck_archetype_family on deck (archetype_family);
create index deck_archetype_label on deck (archetype_label);
create index deck_archetype_version on deck (archetype_version);
comment on column deck.archetype_version is
  'grammar_version|roles_version the stamp was computed under; the nightly re-stamps rows behind the current pair.';
