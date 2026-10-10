import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.2.1",
  date: "2026-09-24",
  summary: md(
    "The consent page asks, and says what each capability is for (Jamie, 2026-09-24).",
    list(
      "What a client asks for is granted; every other standard capability is a checkbox, and a client that names no scope asks for `cr:read` alone (it used to be granted everything with no box to untick). Existing connections keep what they were granted.",
      "On a person's own connection the writes start unticked; on an agent or integration every write starts ticked except `recordings:write`, which spends the owner's tracking slots.",
      "Each checkbox says what the connection cannot do without it, and unticking one that started ticked asks for confirmation, naming what will not work, before the sign-in code is used.",
      "The checkboxes are inside the form: before, a tick on the consent page was never posted, so widening a grant there did nothing.",
      "Plainer capability descriptions, the same on the console's Connections page.",
    ),
    "Additive for tools; a client that relied on an empty scope meaning every capability now gets what the person ticks.",
  ),
} satisfies ChangelogEntry;
