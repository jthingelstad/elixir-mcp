# 2026-10-11 — A departure's post adds only a farewell; dotted clock times

Two Codex findings on #506, the activity channel's editor
(`clan-engine/src/editor.mjs`). No migration; MCP, JSON API and
contracts unchanged.

- **A departure's post.** The editor's post for a departure must keep
  Elixir's sentence word for word, and the check refused only a reason
  from a short list of words ("because", "inactive", "rules"…). "Di was
  removed from the clan. They were toxic." passed. Now everything around
  Elixir's sentence must be Elixir's own other sentences, the late
  story's "when", the member's name, emoji and the words of a thank-you
  or a farewell (`FAREWELL`: "thanks", "good luck out there", "we'll
  miss you", "take care"…). Anything else is `departure_words`, and the
  story is posted as Elixir's version. The system prompt says so. An
  allowlist rather than a longer list of reasons: a reason can be put in
  any words, a farewell in few.
- **Clock times.** `CLOCK` caught `18:05`, `6pm` and `6.05 pm`, but not
  a dotted or "h" time without am/pm. It now also refuses one after a
  word that sets a time ("at 18.05", "around 6h30"); a decimal alone
  ("3.25") still passes.

`/docs/clan-policy` and DECISIONS 147 say the departure rule as it now
stands.
