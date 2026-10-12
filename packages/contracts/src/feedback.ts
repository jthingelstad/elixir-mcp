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

/** Where an item stands. `new` is only ever the filing's own.
 *  `needs_info` (11.10.0): the answer is a question back to the filer,
 *  who replies with follows_id; it raises feedback_responses_pending like
 *  any answer. */
export const FEEDBACK_STATUSES = [
  "new",
  "seen",
  "planned",
  "needs_info",
  "done",
  "declined",
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
/** The statuses an answer may set. */
export const FEEDBACK_ANSWER_STATUSES = [
  "seen",
  "planned",
  "needs_info",
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

/** What an item can point at. `call` (a request_id), `email` (a
 *  send_id) and `feedback` (a feedback_id, 11.10.0: a related item of
 *  the filer's own, not a reply) are checked against the filer; the rest
 *  are pointers the maintainer reads, never something shown back as the
 *  filer's. */
export const FEEDBACK_REF_KINDS = [
  "call",
  "email",
  "feedback",
  "player",
  "clan",
  "clan_action",
  "award",
  "policy",
] as const;
export type FeedbackRefKind = (typeof FEEDBACK_REF_KINDS)[number];

/** Pointers only a Console or Clan page files, after checking them
 *  itself; never an MCP or /api/v1 argument, so a door's `refs` drop them
 *  as unknown. `discord_post` (2026-10-11): a row of the Discord quality
 *  ledger (0222), named by a rating of a post on its delivery history. */
export const FEEDBACK_PAGE_REF_KINDS = ["discord_post"] as const;
export type FeedbackPageRefKind = (typeof FEEDBACK_PAGE_REF_KINDS)[number];

export interface FeedbackRef {
  kind: FeedbackRefKind | FeedbackPageRefKind;
  ref: string;
}

/** A rating of one Discord post from its delivery history (2026-10-11):
 *  the owner of a timeline's cross-post or a clan's leader, thumbs up or
 *  down with an optional note. It is a feedback item with a
 *  `discord_post` ref; a second rating of the same post follows the
 *  first. */
export const DISCORD_RATINGS = ["up", "down"] as const;
export type DiscordRating = (typeof DISCORD_RATINGS)[number];
export const DISCORD_RATING_NOTE_MAX = 1000;

/** Message and answer caps, one for every door. */
export const FEEDBACK_MESSAGE_MAX = 8000;
export const FEEDBACK_RESPONSE_MAX = 4000;
/** How many pointers one item may carry (a Ladder page reads several). */
export const FEEDBACK_REFS_MAX = 20;
