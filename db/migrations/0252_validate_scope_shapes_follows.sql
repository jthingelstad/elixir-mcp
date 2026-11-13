-- 0252: validate the grant shape constraints 0251 re-added NOT VALID.
--
-- Lock shapes take separate migrations (DECISIONS, Schema and
-- migrations): this scans under SHARE UPDATE EXCLUSIVE, so no read or
-- write of a grant waits. Both tables hold one row per connection.

set local lock_timeout = '5s';

alter table oauth_code validate constraint oauth_code_scope_shape;
alter table oauth_family validate constraint oauth_family_scope_shape;
