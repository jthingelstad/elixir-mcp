# 2026-10-21 — The MCP handshake leaves the hourly bucket

The platform review of 2026-10-21 (§2, "The MCP handshake costs as much
as a call") counted the MCP Web Function log for the week from 10-14 to
10-21: 899 authenticated handshake messages (`tools/list` 259,
`initialize` 220, `notifications/initialized` 216, `resources/list` 103,
`prompts/list` 101) beside 1,986 `tools/call`. Each one took a database
lease, the token join and a `rate_limit` upsert, and spent a slot of the
principal's 300-an-hour like a call.

Now only calls count: `tools/call`, `resources/read`, `prompts/get` and
any method the door does not serve (`countsAgainstHour()` in
`services/mcp/src/protocol.mjs`). A notification is answered 202 after
the credential check with no upsert, and `initialize`, `ping`,
`tools/list`, `resources/list`, `resources/templates/list` and
`prompts/list` are answered without one. Every message is still
authenticated: the lease and the token join stay, because a message the
door does not count must still be one it has identified. Whose bucket a
counted message spends from is unchanged (DECISIONS, "The hour is the
principal's, the day is the payer's"). A spent hour still lets a client
connect and list; its next call is the 429.

`server/discover` (245 a week, each refused with HTTP 400 for its
`MCP-Protocol-Version` and followed by a successful `initialize`) is not
a method this server serves, so it still counts. The door's request line
now carries `protocol_version`, the version a request presented when the
server does not speak it: the header after `initialize` (refused, as the
transport requires; the refusal is unchanged), and on `initialize` the
body's `protocolVersion` (answered with 2025-06-18 instead). That says
which client revision is being turned away.

DECISIONS gains "Only calls count against the MCP hour" [engineering].
MCP 11.13.3 (a correction); no tool, field or argument changes; JSON API
3.2.0 is unchanged.
