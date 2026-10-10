# Feedback can carry the call it is about

Report this call on a request record now attaches that request as a field on the report — the arguments, the answer and the timings ride along, so there is nothing to describe. Agents can do the same: elixir_feedback takes request_id (contract 1.1.0), which every response already hands you as meta.request_id. In the console, feedback and maintainer replies render as the Markdown they were written in on both sides of the queue.
