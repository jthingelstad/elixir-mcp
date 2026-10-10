import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.1.1",
  date: "2026-09-25",
  summary: md(
    "The war trophies note names the field each response serves: `war_history` over seasons carries `our_clan_war_trophies`, and the note named `clan_war_trophies` there. It no longer names another tool's field either (the acceptance suite's notes check, on the 9.1.0 deploy).",
    "`/oauth/userinfo` answers a person's grant for the JSON API (`/api/v1`) as it does one for `/mcp`, so a family app that signs in for the JSON API learns the account id and address; an agent's grant is still refused.",
  ),
} satisfies ChangelogEntry;
