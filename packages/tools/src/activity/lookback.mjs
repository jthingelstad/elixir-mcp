/**
 * How far back a Timeline list read reaches: at most one week, everywhere.
 * "The timeline in the product experience should have the same look back
 * as the MCP endpoint ... AT MOST 1 week of events" (Jamie, 2026-11-23;
 * DECISIONS "A Timeline read reaches back one week"). Home, the player
 * page, the account page, the clan's Timeline, the Discord cross-posts and
 * `elixir_timeline` all read their list from this.
 *
 * Not a look-back, and not bound by it: a permalink to one item or one
 * session keeps its own reach, the stored Timeline (`STORY_SPAN_DAYS`)
 * keeps more than a week, and the data tools window older history.
 */
export const TIMELINE_LOOKBACK_DAYS = 7;
export const TIMELINE_LOOKBACK_MS = TIMELINE_LOOKBACK_DAYS * 86_400_000;
