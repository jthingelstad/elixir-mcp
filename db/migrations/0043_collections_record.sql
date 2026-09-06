-- Collections cause recording, and depth becomes one idea (Jamie, 2026-09-06).
--
-- Two changes that belong together.
--
-- 1. Adding a tag to a collection used to be pure curation: it wrote a
--    collection_member row and nothing else, so a curator had to ALSO
--    add the subject to their account to get any data. A tag named in a
--    collection is now a REASON TO RECORD, alongside an account's claim
--    and a deliberate ops recording.
--
-- 2. `clan_scope` asked a question that is not clan-specific: do we go
--    and collect the battles, or only the surface? For a clan,
--    'activity' is the clan itself (roster, war, standings) and
--    'comprehensive' adds every member's battles and profile. For a
--    player the same words mean profile-only versus profile and every
--    battle. One column, one vocabulary, both kinds.
alter table recording rename column clan_scope to scope;
alter table recording drop constraint recording_scope_shape;
-- Player recordings predate the column and were always fully captured.
update recording set scope = 'comprehensive' where scope is null;
alter table recording alter column scope set default 'comprehensive';
alter table recording alter column scope set not null;

comment on column recording.scope is
  'How deeply this subject is recorded. activity = the surface only (a clan''s roster/war/standings; a player''s profile). comprehensive = battles too (every member''s for a clan, the player''s own for a player).';

alter table recording drop constraint if exists recording_origin_check;
alter table recording
  add constraint recording_origin_check
  check (origin in ('claim', 'ops', 'collection'));

comment on column recording.origin is
  'Which reason created this recording: claim (an account added the subject), collection (a collection named it), ops (deliberately recorded with no subscribers). ops is never auto-stopped; the others end when no claim AND no collection membership remains.';

-- A collection carries the depth it wants for everything it names.
-- Comprehensive by default: a collection is usually assembled to study
-- the play, not to hold a list of names.
alter table collection add column scope text not null default 'comprehensive'
  check (scope in ('activity', 'comprehensive'));

comment on column collection.scope is
  'How deeply to record everything in this collection. Applied when a subject is added, and deepened on an existing recording, but never used to take capture away from a subject somebody else is recording.';

-- 500 characters is about three sentences. A collection is a curated
-- thing whose description is the point of it, so give it room.
alter table collection drop constraint if exists collection_description_check;
alter table collection
  add constraint collection_description_check
  check (description is null or length(description) <= 2000);

-- Record everything already sitting in a collection, as if it had just
-- been added. Idempotent per subject: only where nothing active exists.
insert into player (player_tag)
select distinct m.subject_tag from collection_member m
join collection c on c.collection_id = m.collection_id
where c.kind = 'player'
on conflict do nothing;

insert into recording (subject_type, subject_tag, requested_by, origin, scope)
select distinct on (c.kind, m.subject_tag)
       c.kind, m.subject_tag, c.owner_account, 'collection', c.scope
from collection_member m
join collection c on c.collection_id = m.collection_id
where not exists (
  select 1 from recording r
  where r.subject_type = c.kind and r.subject_tag = m.subject_tag
    and r.status = 'active'
)
-- Two collections can name the same subject at different depths: the
-- deeper one wins.
order by c.kind, m.subject_tag, (c.scope = 'comprehensive') desc;

-- And deepen an existing shallow recording a collection wants more of.
-- Upgrade only; nothing is ever downgraded out from under a subscriber.
update recording r set scope = 'comprehensive'
where r.status = 'active' and r.scope = 'activity'
  and exists (
    select 1 from collection_member m
    join collection c on c.collection_id = m.collection_id
    where m.subject_tag = r.subject_tag and c.kind = r.subject_type
      and c.scope = 'comprehensive'
  );
