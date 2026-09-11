# Run Elixir MCP — 2026-09-11

- 09:43Z production read: admissions fresh at one second, no email DLQ, 424 battles/hour, and a 482/3,600 hourly budget; public health remained false because the ledger held 11 dead jobs.
- RDS events record recovery from 09:31:08Z to 09:35:28Z. Scheduler and collector-door logs show database connection timeouts/refusals in that interval; after recovery all three capture-series collectors admitted normally.
- Added the IAM-only `ledger` migrate operation: `dead` inspects durable dead-job receipts; `requeue` accepts only explicit ids, refuses queued twins, preserves job ids, and resets attempts. Focused migration test and full `npm run verify` pass before deployment.
- Discord preview is live and correctly connected as its agent principal at contract 1.5.0; 49 tools are published, `clan-feed` cursor is 963, and monthly routine spend is $0.813356 of $40 with no configured daily cap.
