# Running an Elixir MCP collector

The collector (formerly "gateway") moved to its own small repo so
operators clone only what they run:

**<https://github.com/jthingelstad/elixir-mcp-collector>** — the full
operator guide lives in that repo's README.

The short version: raise your hand at
<https://elixir.poapkings.com/dashboard> (**Run a gateway**), receive an
IP-allowlisted CR key + scoped AWS credentials out of band, clone the
collector repo, fill `.env`, and run the installer. Collectors lease
server-chosen targets, share ONE global rate budget (more collectors =
resilience, never more quota), and self-update hourly from that repo's
green main.

The queue contract stays canonical here in `packages/contracts`;
contract changes land server-side first.

---

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
