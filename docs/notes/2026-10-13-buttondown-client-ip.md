# 2026-10-13 — Buttondown enrollment carries the subscriber's IP

Website and OAuth sign-in and verified signup enrollment now carry the
trusted CloudFront viewer address through the mail outbox to Buttondown's
`ip_address` field. Without it, Buttondown evaluates subscribers against
the relay's shared outbound IP, which can make legitimate signups look
like spam. IPv4 and IPv6 addresses are forwarded without their port;
the relay omits missing or invalid addresses. Request bodies,
forwarded-for headers and edge socket addresses supply no fallback.

No IP is rendered in mail or logged, and opted-out mail carries none in
the outbox. Bulk imports and operator welcomes have no live subscriber
request, so they still omit the IP. No import is replayed. Existing
subscription and unsubscribe behavior, and best-effort enrollment after
service-mail delivery, are unchanged. The privacy page discloses the
subscriber IP sent to Buttondown for spam checks.

Regression coverage checks website code/link proof, OAuth enrollment,
the outbox-to-Buttondown request (IPv4 and IPv6), opt-out, old messages,
imports and invalid IPs. No MCP or JSON API change, no migration;
tool acceptance is not needed because no tool behavior changed.
MCP 11.13.0 and JSON API 3.2.0 unchanged.
