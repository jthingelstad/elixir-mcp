-- 0186: the database checks, every ten seconds, that a running query's
-- client is still there.
--
-- Three incidents left a backend running after its caller was gone: on
-- 2026-09-15 an orphaned 0099 backend held ACCESS EXCLUSIVE until the
-- door ran out of connections (about 35 minutes down); the first live
-- nightly left one; on 2026-09-18 two `create temp table pop` backends
-- ran for 42 and 57 minutes after their Lambda was gone. PostgreSQL
-- notices a closed socket only when it next writes to it, which a long
-- statement does not do until it finishes. With this set, a statement
-- whose client has closed its socket is cancelled within about ten
-- seconds (review 2026-09-27 §3.1).
--
-- A best-effort layer, not the bound. A Lambda that times out is frozen
-- or discarded without always closing its socket cleanly, so the bound is
-- each function's statement_timeout and
-- idle_in_transaction_session_timeout (PGOPTIONS in infra/template.yaml),
-- and the invoker's per-call budget below them. The poll costs one
-- syscall per backend per interval. Like 0155, it takes effect on the
-- NEXT connection, and a session may still set its own. No lock is taken.
do $$
begin
  execute format('alter database %I set client_connection_check_interval to %L', current_database(), '10s');
end
$$;
