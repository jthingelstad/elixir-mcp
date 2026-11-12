# 2026-11-12 — @hono/node-server 2.1.8 for the audit gate

CI's static job runs `npm audit --omit=dev --audit-level=low`, and two
advisories against `@hono/node-server` 2.0.0 to 2.1.5 (GHSA-qv5m-9pm6-hqp3,
an unhandled ECONNRESET during a WebSocket upgrade; GHSA-jpvv-r467-5p4w, a
backslash in the path read as a separator) turned every pull request and
`main` red on 2026-11-12. `packages/http` pins it exactly, so the pin moves
to 2.1.8, the first release with both fixes; `npm audit` then reports
nothing. `hono` itself is unchanged (Dependabot's runtime group, #720,
carries its bump).
