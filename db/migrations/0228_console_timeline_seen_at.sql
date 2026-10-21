-- 0228: the Console keeps its own place in the timeline (2026-10-20).
--
-- The Console's Timeline dot counted subjects with news since
-- account.activity_seen_at (0087), the account's unnamed read pointer,
-- and only an MCP elixir_timeline mark_read ever moves that. A person
-- with no agent connected saw a dot that never cleared and every row
-- "Unread by connections". Asked whether the Console should get its own
-- seen marker, separate from what agents have read, Jamie (2026-10-20):
-- "timeline should be independent of what agents have seen via MCP."
--
-- console_timeline_seen_at is that marker. It moves only forward, and
-- only when the Console shows the account's Timeline page (on an agent's
-- console, the agent's row, moved by its owner's visit). The rail's dot
-- and the page's "New since your last visit" divider read it; MCP never
-- reads or moves it, and the Console never moves activity_seen_at. It is
-- not a timeline_reader row (0136): meta.timeline_pending counts against
-- the oldest named pointer, so a Console reader would change what agents
-- see.
--
-- A nullable column with no default: catalog-only. Null means the
-- Console has never shown this account's Timeline. Locks: account for an
-- instant; fail fast behind a reader.

set local lock_timeout = '5s';

alter table account add column console_timeline_seen_at timestamptz;

comment on column account.console_timeline_seen_at is
  '0228: the Console''s own place in the timeline: the window end of the last Timeline page the Console showed this account. Moves only forward, only from the Console; MCP never reads or moves it, and it never moves activity_seen_at. Null: never shown.';
