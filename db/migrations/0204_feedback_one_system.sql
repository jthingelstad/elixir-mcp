-- 0204: feedback becomes one system for all of Elixir.
-- Jamie, 2026-10-08, a beta gate: "one general feedback system that can
-- work for all of the types of feedback that we want to collect in
-- Elixir". Elixir Clan kept its own copy in clan_state (empty when it was
-- retired: {clan_maintenance} lane feedback read total 0 that day) and
-- Ladder had none. Every door now files here: MCP, the JSON API, the
-- Console, Ladder, Elixir Clan, the docs and the email footer.
--   area: the part of Elixir an item is about (where it was written),
--     filled for existing rows from surface, send_id and the docs context.
--   surface gains 'api' (POST /api/v1/feedback); category gains
--     'judgment' (Elixir judged someone wrongly: Clan's category).
--   via: who filed it through what (principal kind, client, the filing
--     call's own request id, an agent's on_behalf_of).
--   follows_id: a reply to an answer opens a linked item.
--   response_mailed_at: the answer last mailed to the filer (the
--     feedback_answer email); set for every existing answer, so no
--     history is mailed.
--   feedback_ref: what an item points at, by kind. Call and email ids are
--     copied in from request_id, context.request_ids and send_id; those
--     stay written for one release and a later migration drops them.
-- feedback is 371 rows (0.6 MB, {tables} 2026-10-08), so the fills run
-- here. Locks: feedback (small) for an instant; fail fast behind a reader.
set local lock_timeout = '5s';

alter table feedback drop constraint feedback_category_check;
alter table feedback add constraint feedback_category_check
  check (category in ('general', 'bug', 'data_quality', 'feature', 'praise', 'judgment', 'other'));
alter table feedback drop constraint feedback_surface_check;
alter table feedback add constraint feedback_surface_check
  check (surface in ('web', 'mcp', 'api', 'recorder'));

alter table feedback
  add column area text not null default 'console'
    check (area in ('mcp', 'api', 'console', 'ladder', 'clan', 'mail', 'docs', 'recorder')),
  add column via jsonb,
  add column follows_id bigint references feedback on delete set null,
  add column response_mailed_at timestamptz;

update feedback set area = case
    when surface = 'mcp' then 'mcp'
    when surface = 'recorder' then 'recorder'
    when send_id is not null then 'mail'
    when context ->> 'context' like 'Docs:%' then 'docs'
    else 'console'
  end;
update feedback set response_mailed_at = responded_at where responded_at is not null;

create index feedback_area_status on feedback (area, status, feedback_id desc);

comment on column feedback.area is
  'The part of Elixir the item is about, set by the door it was written from (0204): mcp, api, console, ladder, clan, mail, docs, recorder.';
comment on column feedback.surface is
  'The door it came through: web (a signed-in page), mcp, api (/api/v1), recorder (Elixir filing on itself). 0204 added api.';
comment on column feedback.via is
  'Who filed it through what (0204): principal_kind, client_name, request_id (the filing call itself), on_behalf_of (an agent relaying for one of its people). Null before 0204.';
comment on column feedback.follows_id is
  'The item this one replies to, when the filer answered an answer (0204).';
comment on column feedback.response_mailed_at is
  'The responded_at whose answer the feedback_answer email has handled (sent or skipped); behind responded_at means an answer is owed a mail (0204).';

create table feedback_ref (
  feedback_id bigint not null references feedback on delete cascade,
  kind        text not null
              check (kind in ('call', 'email', 'player', 'clan', 'clan_action', 'award', 'policy')),
  ref         text not null check (length(ref) between 1 and 120),
  primary key (feedback_id, kind, ref)
);
create index feedback_ref_target on feedback_ref (kind, ref);
comment on table feedback_ref is
  'What a feedback item points at (0204). call is a request_id and email a send_id, both checked against the filer when written; player, clan, clan_action, award and policy are pointers for the maintainer, never shown back as the filer''s.';

insert into feedback_ref (feedback_id, kind, ref)
select feedback_id, 'call', request_id::text from feedback where request_id is not null
union
select f.feedback_id, 'call', lower(r.id)
  from feedback f,
       jsonb_array_elements_text(
         case when jsonb_typeof(f.context -> 'request_ids') = 'array'
              then f.context -> 'request_ids' else '[]'::jsonb end) as r(id)
 where r.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
union
select feedback_id, 'email', send_id::text from feedback where send_id is not null
on conflict do nothing;
