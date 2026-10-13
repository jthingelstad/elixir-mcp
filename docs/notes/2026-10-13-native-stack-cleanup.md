# 2026-10-13 — Clean up the native HTTP transition

Jamie approved all five post-migration cleanup items, shipping them before
safely pruning unused deployment history while protecting live references.

The HTTP doors and their fixtures now use native method/path, text bodies,
Cookie headers and request context. Retired incoming API Gateway variants
are removed; asynchronous Event Function context and binary PNG responses
remain. The trusted native request ID now reaches Clan's structured trace,
with a signed-in scratch regression that rejects viewer-supplied identity.
The HTTP services' test-only pg declarations move to devDependencies; the
shared HTTP package still owns the runtime pool. No contracts or identity
policy change: MCP 11.13.0, JSON API 3.2.0.

CloudFront's static router loses its unreachable application rewrites while
keeping its resource ID and static document behavior. Preview instructions
now describe the client fixture accurately. Per-door WebApiBuild/McpBuild/
CollectorBuild identities replace the shared WebBuild: a one-door bundle
change no longer revises unrelated doors. Common configuration remains in
all relevant revision properties. The first transition revises all three
once. The domain Operator guidance distinguishes native CPU/memory usage
from Event Function billing and from route latency.

Deployment-history pruning is explicit, dry-run by default and serialized
with deploys through the production lock. Apply requires a clean green main,
a saved manifest and a separate atomic receipt outside the public repository.
The inventory checks stable stack state, complete managed revisions and live
endpoints, all endpoint references, function ownership and paginated source
versions. A changed reference fingerprint stops the run. Every deletion is
rechecked against a fresh inventory; only unserved, non-stack revisions are
eligible. Source objects wait until all remaining revisions are stack-managed.
This avoids reading secret-bearing revision configuration. Current native
source versions and all versions of current Event Function code keys stay.
Only exact version IDs of known code/<service>/<hash>.zip objects are deleted;
archives, site assets, deploy receipts and unknown prefixes are outside scope.
The ten eligible prefixes include eight current services and editor/ingest,
retired in a2784939/779409ea; the function inventory refuses cleanup if they
reappear.

The runtime, infra and pruning changes have focused regression coverage,
including alternate endpoint references, current pins, forged manifests,
partial deletion errors, pending revisions, changed references between batches,
lock refusal/release, complete pagination and safe receipt destinations.
Full repository verification, browser journeys and the full live acceptance
suite gate this shared HTTP cleanup. Production read-back and the prune receipt
will be attached to the shipped PR after execution. Old HTTP logs retain their
30-day migration evidence and are not deleted by this code-history command.
