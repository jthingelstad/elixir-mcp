-- 0080: Verify - the deck-slot challenge (2026-09-12).
--
-- A claim has said "this player is me" on trust since 0001; claim.status
-- and claim.verified_method were declared then and nothing ever wrote
-- them. Products about to gate leader-only views on a verified claim need
-- the fact to exist. The CR API offers one player-settable, API-visible
-- field: currentDeck. The wizard asks the player to put eight named cards
-- in a deck slot and select it; a profile read that shows exactly that
-- set of card ids, taken after the brief was issued, is the proof.
--
-- 0008's favourite-card challenge never had a reader (currentFavouriteCard
-- turned out not to be player-settable); it goes, and the challenge row
-- is redeclared for decks. The current deck itself becomes a projection
-- (player_current_deck), because tools and routes never read api_payload.

alter table claim add column verified_at timestamptz;
comment on column claim.verified_at is
  'When the claim was proven (deck-slot challenge, 0080). Null while unverified.';

drop table verification_challenge;

create table claim_challenge (
  challenge_id      uuid primary key default gen_random_uuid(),
  account_id        uuid not null,
  player_tag        text not null,
  method            text not null default 'deck_slot'
                    check (method in ('deck_slot')),
  target_card_ids   integer[] not null,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  completed_at      timestamptz,
  outcome           text not null default 'open'
                    check (outcome in ('open', 'verified', 'expired')),
  -- The live reads this challenge asked for: charged to nobody's quota,
  -- and auditable through api_receipt.job_id (0041).
  live_job_id       bigint,
  live_requested_at timestamptz,
  live_reads        integer not null default 0,
  foreign key (account_id, player_tag)
    references claim (account_id, player_tag) on delete cascade
);
create unique index claim_challenge_one_open
  on claim_challenge (account_id, player_tag) where outcome = 'open';
create index claim_challenge_by_claim
  on claim_challenge (account_id, player_tag, created_at desc);

-- The player's active battle deck as the API last showed it: written only
-- when the deck hash moves, so observed_at is when THIS deck was first
-- seen. cards is the API's own {id, level, evolutionLevel} per slot.
create table player_current_deck (
  player_tag   text primary key references player,
  cards        jsonb not null,
  deck_hash    text not null,
  observed_at  timestamptz not null,
  receipt_id   bigint
);
