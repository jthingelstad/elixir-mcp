import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.28.0",
  date: "2026-09-07",
  summary:
    "OAuth grants now mean what the consent page says. cr:read calls every read-only tool but cannot edit collections, change recordings, update nicknames/event cursors, or file feedback; those actions require collections:write, recordings:write, account:write, or feedback:write respectively. The requested capabilities are listed before the user enters their code, persist unchanged through refresh rotation, and are enforced before rate or daily quota is spent. Tokens are also audience-bound to https://elixir.poapkings.com/mcp through the RFC 8707 resource parameter. Existing OAuth connections become cr:read-only because that is the authority their original consent granted; reconnect with the additional scopes to restore writes. Owner-issued service tokens remain explicit full-capability administrative credentials.",
  breaking:
    "OAuth clients must send resource=https://elixir.poapkings.com/mcp on authorization-code and token requests. Existing OAuth families retain reads but need fresh consent for write capabilities.",
} satisfies ChangelogEntry;
