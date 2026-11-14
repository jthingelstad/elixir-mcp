-- 0266: Drop five columns nothing reads or writes.
--
-- Jamie approved the drop on 2026-11-14. Each was checked with
-- `git grep -w` over apps, packages, services, infra, acceptance, e2e and
-- the scripts (applied migrations aside): no reader, no writer, no
-- view, index, constraint or trigger names one.
--
--   claim.share_battles_with_clan (0006): the battle-sharing consent
--     toggle, retired 2026-09-03 (Jamie: being in a clan is sharing your
--     battles with it; battlelogs are public in-game and via the API).
--     Its route, UI and entitlement lane went in d5378093; unread since.
--   gateway.iam_user_name (0034): the per-collector IAM user from the
--     old local provisioning script, retired with it (b01fc4bb,
--     2026-09-25).
--   poll_state.heat_updated_at (0004): the heat model's decay anchor;
--     the scheduler went yield-only on 2026-09-05 (b55db497).
--   account_clan_declined.declined_at (0205): a default-stamped time
--     nothing ever read; the row itself (a clan the person stopped
--     following) stays and is still read.
--   gateway.fetch_points (0013): fetch points retired 2026-10-12
--     (DECISIONS "Running a collector earns the Family tier, and nothing
--     else"); ingest's last write went in be38aa13.
--
-- Expand and contract: the build serving while this commits already
-- neither reads nor writes any of them, and the three NOT NULL columns
-- carry defaults, so its inserts never named them. A drop is
-- catalog-only (the space comes back as rows are rewritten); each takes
-- an ACCESS EXCLUSIVE lock for an instant, so fail fast rather than
-- queue ingest or sign-ins behind a long read, and let the deploy be
-- retried.

set local lock_timeout = '5s';

alter table claim drop column share_battles_with_clan;
alter table gateway drop column iam_user_name;
alter table gateway drop column fetch_points;
alter table poll_state drop column heat_updated_at;
alter table account_clan_declined drop column declined_at;
