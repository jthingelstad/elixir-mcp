# 2026-11-18 — Keep slow cache builds serialized

Every Timeline, bell and clan-card rebuild holds its per-account advisory
lock. A caller that had to wait checks the stored row again and can reuse
a row that meets its existing freshness and audience checks. If the holder
is still building after twelve seconds and no usable row exists, the reader
reports temporary unavailability. Background callers can retry through their
existing job lane. Previously the waiter started another build without the
lock. The regression exercises contention, the timeout and release on failure
using independent PostgreSQL connections. This is an internal cache change.
