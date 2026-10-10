import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.3.0",
  date: "2026-09-25",
  summary: md(
    "A departure a leader classified (`departure_classified`, kick or leave) now reaches the whole clan on the timeline, the clan's own agent included; in 9.2.0 only the clan's leaders saw it, so that a kick would never be narrated. The game already tells everyone in clan chat that a member was kicked, and leaders say why there: keeping it from the clan's agent kept nothing from anyone (Jamie). A member's away stays with the leaders.",
    "Who sees an attested fact is now read from its type when the timeline is read, not from what the type said when the fact was written, so departures recorded under 9.2.0 follow. Additive for agents: a clan's agent can wake on `departure_classified` and say whether a member left or was removed.",
  ),
} satisfies ChangelogEntry;
