/**
 * Feedback, one system for all of Elixir (2026-10-08, Jamie: "one general
 * feedback system that can work for all of the types of feedback that we
 * want to collect"). Every door files the same record: the MCP tool, the
 * JSON API, the Console, Ladder, Elixir Clan, the docs and the email
 * footer. These lists are that record's vocabulary, and the database's
 * CHECKs, the tool schemas and the web forms all read them from here.
 */

/** What the person says it is. `judgment`: Elixir judged someone wrongly
 *  (Elixir Clan's standing, an award, a removal clock). */
export const FEEDBACK_CATEGORIES = [
  "general",
  "bug",
  "data_quality",
  "feature",
  "praise",
  "judgment",
  "other",
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

/** Where an item stands. `new` is only ever the filing's own. */
export const FEEDBACK_STATUSES = [
  "new",
  "seen",
  "planned",
  "done",
  "declined",
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
/** The statuses an answer may set. */
export const FEEDBACK_ANSWER_STATUSES = [
  "seen",
  "planned",
  "done",
  "declined",
] as const;

/** The part of Elixir an item is about: the place it was written from,
 *  which is also how the maintainer's queue is sorted. */
export const FEEDBACK_AREAS = [
  "mcp",
  "api",
  "console",
  "ladder",
  "clan",
  "mail",
  "docs",
  "recorder",
] as const;
export type FeedbackArea = (typeof FEEDBACK_AREAS)[number];

/** The door it came through: `recorder` is Elixir filing on itself. */
export const FEEDBACK_SURFACES = ["web", "mcp", "api", "recorder"] as const;
export type FeedbackSurface = (typeof FEEDBACK_SURFACES)[number];

/** What an item can point at. `call` (a request_id) and `email` (a
 *  send_id) are checked against the filer; the rest are pointers the
 *  maintainer reads, never something shown back as the filer's. */
export const FEEDBACK_REF_KINDS = [
  "call",
  "email",
  "player",
  "clan",
  "clan_action",
  "award",
  "policy",
] as const;
export type FeedbackRefKind = (typeof FEEDBACK_REF_KINDS)[number];

export interface FeedbackRef {
  kind: FeedbackRefKind;
  ref: string;
}

/** Message and answer caps, one for every door. */
export const FEEDBACK_MESSAGE_MAX = 8000;
export const FEEDBACK_RESPONSE_MAX = 4000;
/** How many pointers one item may carry (a Ladder page reads several). */
export const FEEDBACK_REFS_MAX = 20;
