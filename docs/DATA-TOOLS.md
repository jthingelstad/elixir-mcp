# Data tools for Elixir MCP — design for review

Jamie's prompt (2026-09-04): raw payloads have proven their worth
repeatedly; they're disk-shaped, not database-shaped. Store them in S3,
consider S3-side query tooling, and step back: what data tools should
Elixir MCP be using? This doc is the design + evaluation. NOTHING HERE
IS BUILT — review first.

## 1. Payload tiering: Postgres hot set, S3 archive

**Shape.** Two tiers with one seam:

- **Postgres keeps the hot set**: the latest payload per (endpoint,
  entity) — exactly what `get_collection` and `get_card_catalog` serve,
  and what admission dedup compares against (payload_hash). Everything
  else about api_payload's role is unchanged; the table just stops
  accumulating history. Expected size: a few thousand rows, tens of MB
  (vs 391MB and growing today).
- **S3 keeps everything, forever-ish**: at admission, ingest writes the
  gzipped payload to
  `s3://elixir-mcp-archive/payloads/endpoint=X/entity=TAG/dt=YYYY-MM-DD/fetchedat-hash.json.gz`.
  Content-addressing carries over (hash in the key); the Hive-style
  `endpoint=/dt=` partitioning is what makes every query tool below
  work without a catalog crawl. Lifecycle: Standard -> Standard-IA at
  30d. At current volume (~40MB/day gzipped) that's roughly
  **$0.15-0.30/month growing ~$2/year** — noise.

**Write path.** Ingest already holds the gzipped bytes (the SQS message
body) — the S3 put is one extra call per admitted payload, before the
DB transaction (an S3 object with no DB row is harmless; the reverse
is not). Failure posture: S3 put failure fails the message ->
SQS retry — the archive is part of admission, not best-effort.
Superseded-payload cleanup in Postgres becomes a small weekly sweep
(delete all but latest per entity where a same-hash S3 object exists).

**Migration.** One-time export of the existing 391MB via the migrate
lambda (batched SELECT -> S3 put; ~15k objects), then the sweep turns
on. The elixir-bot archive replay corpus can also land there for
completeness (its raw_api_payloads, exported once).

**What this preserves.** Every rescue this week — the level backfill,
the 0012 repair, the archive replay — read raw payloads. The S3 tier
keeps that capability unbounded while Postgres returns to being the
serving layer.

## 2. Query tooling over the S3 corpus — evaluation

| Option | What it is | Fit here |
| --- | --- | --- |
| **Athena** | Serverless SQL over S3; pay per TB scanned ($5/TB) | **Recommended.** Zero standing cost, zero infrastructure; one Glue table DDL over the partitioned layout and every "which payloads where X" question is SQL. Our whole corpus is <1GB — a full scan costs ~half a cent. JSON SerDe handles the payload bodies directly. |
| **S3 Tables (Iceberg)** | Managed Iceberg tables in S3 | Overkill: designed for high-churn analytic tables with compaction management (and a small always-on cost). Our objects are immutable write-once blobs; plain partitioned objects lose nothing. Revisit only if we ever build derived analytic tables at real volume. |
| **DuckDB local** | `read_json('s3://...')` from any machine | **Keep as the second tool, free.** For ad-hoc archaeology (the kind of session work we did against elixir-bot's SQLite), DuckDB against the same partitioned layout needs no AWS-side setup at all. Nothing to build — it works on the layout by construction. |
| **S3 Select** | Per-object SQL | Deprecated-ish and per-object only; skip. |
| **S3 Metadata / Bedrock-adjacent "AI on S3"** | Managed metadata tables; natural-language query layers | The honest read: S3 Metadata gives queryable object inventories (useful at millions of objects; ours is thousands — `ls` works). The AI query layers add spend and an abstraction we don't need: the MCP server IS our natural-language interface, and it queries Postgres projections, not raw payloads. Skip for now; nothing in this design blocks adopting them later since the data sits in open formats. |

**Concrete recommendation:** partitioned gzip JSON objects + one Glue
table + Athena for account-side questions; DuckDB for local
archaeology. Both read the same layout; neither adds standing cost.

## 3. The broader data-tools posture

- **Postgres stays the system of record for projections** (battles,
  snapshots, war, entitlements). Nothing this week suggested otherwise:
  after R1, ingest is 2x faster on 5x data, the DB idles at 8% CPU, and
  every reader is index-served. No columnar sidecar, no OLAP engine —
  at 100x today's volume the first move would be Athena over
  S3-exported projection snapshots, not a new database.
- **S3 becomes the system of record for raw observations** (this
  design), making Postgres rebuildable-from-source in principle — the
  property that made this week's repairs possible, now durable.
- **CloudWatch Logs Insights is the metrics store** (the perf lines).
  It earns its place: censusing the ingest path found and verified
  three optimizations this week. No Prometheus/Grafana — hobby scale.
- **SQLite archives stay read-only sources** (elixir-bot, workshop
  DBs): query in place with `?mode=ro`, never migrate them anywhere.
- **What we deliberately don't adopt**: streaming (Kinesis/Firehose —
  SQS is our stream and it's fine), a data catalog beyond one Glue
  table, dbt-style transform layers (projections are code with tests,
  which is stricter), and vector/AI stores (the MCP interface is the
  AI layer; it reads projections).

## 4. Build plan, if approved

1. `0017`: nothing — no schema change needed (the sweep is code).
2. Infra: archive bucket + lifecycle + Glue database/table in the
   stack; ingest lambda gains s3:PutObject on the archive prefix.
3. Ingest: the S3 put at admission (+ tests, including put-failure ->
   retry semantics).
4. Migrate-lambda export op for the existing payload history; run once;
   verify object counts match row counts.
5. Weekly Postgres sweep (superseded payloads with confirmed S3 twins).
6. docs + a DuckDB/Athena crib sheet in this file.

Estimated: one focused session, fully test-first, no user-visible
change. Rollback story: stop the sweep; Postgres accumulates again;
S3 objects are harmless.
