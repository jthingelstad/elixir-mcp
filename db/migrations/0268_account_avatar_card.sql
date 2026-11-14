-- 0268: An account's profile image, a Clash Royale card, two columns on
-- account (2026-11-14).
--
-- Jamie, 2026-11-14: "Elixir Drop has a great method to allow players to
-- have profile images using circular crops from clash Royale cards. I
-- want to wholesale move that into Elixir." Asked who sees it:
-- "Wverywhere your player appears. Including alts I guess?" One image per
-- account, a card from the catalog (never a tower troop), drawn from the
-- card's base art with a fixed crop per card (@elixir-mcp/ui
-- avatar-crops) [engineering, 2026-11-14]. It shows on every player the
-- account has verified; an unverified, followed or watched player shows
-- initials as before.
--
-- account.avatar_card_id: the chosen card's id (card.card_id, kind
-- 'card'). Null means no image: initials. No foreign key: the catalog is
-- the API's, and the write route checks the card when it is chosen.
-- account.avatar_set_at: when the person last chose or cleared it. Null
-- means never. No backfill here: Drop's images arrive by a one-time op.
--
-- Nullable columns with no default are catalog-only. Each takes an
-- ACCESS EXCLUSIVE lock on account for an instant: fail fast rather than
-- queue sign-ins behind a long read, and let the deploy be retried.

set local lock_timeout = '5s';

alter table account add column avatar_card_id integer;
alter table account add column avatar_set_at timestamptz;

comment on column account.avatar_card_id is
  '0268: the profile image, a catalog card id (kind card, never a tower troop), drawn from its base art with a fixed crop. Shown on the account''s verified players. Null means initials.';
comment on column account.avatar_set_at is
  '0268: when the profile image was last chosen or cleared. Null means never.';
