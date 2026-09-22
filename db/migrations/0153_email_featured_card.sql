-- 0153: which card each Card of the Week issue featured, so a card is
-- not featured twice in a year (docs/EMAIL.md, the Friday kind).
--
-- One row per ISSUE, keyed by its period: an issue features one card,
-- and an operator override replaces the week's pick rather than adding
-- a second. `candidates` keeps the ten the selector drew from, with
-- their usage, so the choice is auditable a year later without
-- re-reading a season that has since moved.
--
-- sent_at is the whole point of the table being separate from the
-- ledger: a card is CONSUMED by a send, not by a selection. An issue
-- that failed its verifier, or a dry run, leaves sent_at null and the
-- card returns to the pool next week. The exclusion therefore reads
-- sent_at, never chosen_at.

create table email_featured_card (
  period_key  text primary key,
  card_id     integer not null references card (card_id),
  score       numeric(6, 4),
  reason      text not null check (reason in ('usage', 'override')),
  candidates  jsonb not null default '[]'::jsonb,
  chosen_at   timestamptz not null default now(),
  sent_at     timestamptz
);

comment on table email_featured_card is
  'The card each Card of the Week issue featured, and the ten it was drawn from. sent_at null means the card was never actually mailed and is still eligible.';
comment on column email_featured_card.sent_at is
  'When an issue featuring this card actually sent. Null for a dry run or a failed issue: those do not consume the card.';
comment on column email_featured_card.candidates is
  'The eligible top ten at selection, each {card_id, name, battles, usage_share}, in the order drawn from.';

-- The exclusion query: has this card been SENT inside the last year.
create index email_featured_card_recent on email_featured_card (card_id, sent_at desc)
  where sent_at is not null;
