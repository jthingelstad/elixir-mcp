import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.14.0",
  date: "2026-10-24",
  summary: md(
    "A person can link their Discord account to Elixir from their profile (Discord's own sign-in proves it), so an agent's `on_behalf_of: \"discord:<user id>\"` now resolves without `elixir_identify`.",
    list(
      "on_behalf_of `discord:<user id>`: resolves to the linked person's primary, else an alt, that is a current member of a clan this agent acts for. Otherwise the agent's own mapping (elixir_identify) applies, as before.",
      "meta.asker on every agent call that carries on_behalf_of: `{ external_id, player_tag, via, verified }`. via is `discord_link` (the person linked it), `agent_mapping` (the agent's own elixir_identify) or null (nobody yet); verified says the claim is proven in game.",
      "no_subject for a `discord:` id adds that the person can connect Discord on their Elixir profile.",
    ),
    "Additive. JSON API 3.3.0: the response `meta` schema gains `asker`, which only an agent's MCP call carries.",
  ),
} satisfies ChangelogEntry;
