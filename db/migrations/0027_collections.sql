-- Collections (Jamie, 2026-09-05): owned, curated groupings of players
-- or clans - "pro", "creator", clan families. NOT tags: a collection is
-- an editorial object with an owner, never a global fact about the
-- entity; governance collapses into ownership. v1: creation is
-- owner-only (ops path / admin); reads are universal like all game data.
create table collection (
  collection_id bigint generated always as identity primary key,
  slug          text not null unique
                check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}$'),
  title         text not null check (length(title) between 1 and 80),
  kind          text not null check (kind in ('player', 'clan')),
  description   text check (description is null or length(description) <= 500),
  visibility    text not null default 'public'
                check (visibility in ('public', 'private')),
  owner_account uuid not null references account,
  created_at    timestamptz not null default now()
);

create table collection_member (
  collection_id bigint not null references collection on delete cascade,
  subject_tag   text not null,
  note          text check (note is null or length(note) <= 200),
  added_at      timestamptz not null default now(),
  primary key (collection_id, subject_tag)
);
