# 2026-10-21 — The collector door's 503 carries no Retry-After

Codex on #622: DECISIONS said every door pool answers a connection it
cannot have with 503 and `Retry-After`. Only MCP and web-api do. The
collector door lets the refused connection reach the shared server's
generic 503 (`packages/http/src/server.mjs`), with no header.

The promise is narrowed rather than the collector changed. The Go
collector retries any 5xx on its own backoff, and reads `Retry-After`
only on a 4xx the hub names retryable (`internal/v2/v2.go`), so a header
on its 503 would change nothing it does. DECISIONS and ENGINEERING now
name the two doors that send it. No code or contract moves.
