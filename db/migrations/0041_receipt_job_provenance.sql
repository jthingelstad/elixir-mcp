-- 0041: receipt provenance for the live lane (issue #3). A live wait must
-- complete only from the job it enqueued: a bulk collector's receipt for
-- the same subject (leased before the live request arrived) must never
-- serve straight into a user's live answer — the ratified channel
-- boundary (COLLECTOR-ZERO-TRUST.md). The collector door stamps job_id
-- server-side from the lease row. Plain bigint, no FK: receipts outlive
-- the weekly prune of done jobs.
alter table api_receipt add column job_id bigint;
