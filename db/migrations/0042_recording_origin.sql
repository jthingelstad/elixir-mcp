-- Why a shared recording outlived its last subscriber (issue #9).
--
-- Removing a player stopped its recording only when the REMOVING account
-- was the one that originally created it. With two subscribers, if the
-- original requester left first, the second one's removal could never
-- stop it: no claims remained, but requested_by pointed at somebody
-- else. The recording stayed active forever, consuming collection
-- capacity for a player nobody was watching.
--
-- The ownership check could not simply be dropped, because some
-- recordings have no subscribers BY DESIGN - pros and clan fan-out are
-- created by ops and must survive having zero claims. requested_by was
-- carrying two meanings at once: who asked, and why it exists. This
-- splits out the second one.
alter table recording
  add column origin text not null default 'claim'
    check (origin in ('claim', 'ops'));

comment on column recording.origin is
  'claim = created because an account added this subject, so it ends with the last claim. ops = deliberately recorded without subscribers (pros, clan fan-out); claim removal must never stop it.';

-- Backfill conservatively: only mark a recording claim-origin when we
-- have positive evidence a claim created it. Everything else becomes
-- 'ops', which preserves it - the safe direction, since wrongly marking
-- a pro recording as claim-origin would silently stop collecting it.
--
-- The evidence is the account_event the add path writes whenever a
-- claim starts a recording. It survives the claim being deleted, which
-- is exactly what makes it usable here.
update recording r set origin = 'ops';
update recording r set origin = 'claim'
where r.subject_type = 'player'
  and exists (
    select 1 from account_event e
    where e.kind = 'recording_started'
      and e.detail ->> 'player_tag' = r.subject_tag
  );
