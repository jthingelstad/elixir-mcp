-- 0288: badge art, the image the game shows for a badge at a level.
--
-- The owner, 2026-11-17: "Yes use badge art. For sure." A profile's badges
-- each carry iconUrls.large, which ingest dropped until now. The icon is
-- one image per badge and tier (cr-agent-api-docs, models/players.md:
-- 251 name and level pairs across 5,811 captured profiles, 251 distinct
-- URLs), so the row is per (name, level); a badge with no tiers is level
-- 0. The URL is Supercell's; the mirror (infra/scripts/mirror-card-art.mjs)
-- keeps a byte-identical copy on Elixir's origin, never altered, and the
-- surfaces draw that copy (docs/notes/2026-11-17-badge-art.md).
--
-- Rows are written as profiles are read: art for a badge level arrives
-- with the first read of a profile that holds it, and a moment from
-- before has none (absence over a guess).
--
-- A new table only: nothing existing is locked or rewritten.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table badge_art (
  name           text not null check (length(name) between 1 and 100),
  level          int not null check (level >= 0),
  icon_url       text not null check (icon_url ~ '^https://' and length(icon_url) <= 300),
  first_seen_at  timestamptz not null,
  observed_at    timestamptz not null,
  primary key (name, level)
);

comment on table badge_art is
  'A badge''s icon at one level, as profiles carry it (iconUrls.large); level 0 is a badge with no tiers. Written by profile ingest (0288); the mirror copies each icon to /assets/badges/ unaltered.';
