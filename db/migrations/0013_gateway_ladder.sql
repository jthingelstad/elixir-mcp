-- 0013: the gateway ladder (Jamie, 2026-09-04) — a point per admitted
-- API call, cumulative forever. Pure fun with honest bookkeeping: the
-- counter is maintained at admission (same update as last_success_at)
-- and seeded here from the receipts each gateway already earned.
alter table gateway add column fetch_points bigint not null default 0;

update gateway g
set fetch_points = (
  select count(*) from api_receipt r where r.gateway_id = g.gateway_id
);
