# Connected agents get only what you approve

Connecting an agent used to ask for read access while its token could also change recordings, collections, nicknames, event state, and feedback. That mismatch is closed. The authorization page now lists each capability before you enter the code, read-only access stays read-only, and write actions require their own explicit grants. Tokens are also bound to this MCP server, so one minted for another resource cannot be replayed here. Existing connections keep read access; reconnect when an agent needs to make changes.
