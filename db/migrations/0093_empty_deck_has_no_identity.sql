-- An empty cards array is not a deck.
--
-- The 0091 census found 1,976 participants carrying a deck_hash with no
-- deck row: every one a June 2026 `trail` (event challenge) battle whose
-- payload listed cards: [] - the API does not disclose the deck for some
-- event formats - and every one hashed to the same identity, the hash of
-- nothing ("|0"). Identity requires cards; ingest now stamps null for an
-- empty list (deck-cards.mjs / battles.mjs participantDeck), and these
-- rows get the same answer. The JSON stays as captured.

update battle_participant
   set deck_hash = null
 where deck_hash = 'ef12efbd765f9ad308460dc13dd2d5d06784bbe91adb0bf5fa752eddf10a38eb'
   and jsonb_array_length(coalesce(deck->'cards', '[]'::jsonb)) = 0;
