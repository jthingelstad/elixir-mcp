import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.32.0",
  date: "2026-09-08",
  summary:
    "The event feed now carries milestones, and it reaches agents through the clan they run. Badges, arena changes, personal-best trophies, career-win thousands, collection levels and Path of Legends promotions all nod at you now - none of them ever did before, because the player fan-out was written but never wired up. A one-off badge and a mastery level-up are separate topics, so asking for the notable ones actually gets you the notable ones. An agent hears about the players in its clan without adding fifty of them itself; an integration, which has no players of its own, hears nothing. Everything that can arrive in bulk folds into a single unread nod with a running count - the feed tells you a thing happened and where to look, and the data tools tell you what it was. 'role_changed' is now 'account_tier_changed' (both are sent for now): it means your account tier, and it sat one word away from 'member_role_changed', which means a clan promotion.",
} satisfies ChangelogEntry;
