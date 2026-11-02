# Paid alarm retirement

Retire the manually invoked migrate-duration warning and the redundant web-api latency-at-504-deadline / collector ingest-error alarms. Native HTTP 5xx and handled-failure outcomes remain, as do scheduler heartbeat, dead letters, database capacity, record integrity, actual capacity refusals and the other latency checks. Remove the two custom metric filters that existed only behind retired alarms and their dashboard references. No tool, contract, schema, grant or retention changes; acceptance scope is infrastructure read-back, not synthetic tool traffic.

Authorized by Jamie on November 1, 2026: keep essential safety checks and retire redundant or non-actionable paid alarms. Restore the previous template by reverting this change. Diagnostics remaining in logs or standard metrics are not automatically healthy; missing samples do not prove success.
