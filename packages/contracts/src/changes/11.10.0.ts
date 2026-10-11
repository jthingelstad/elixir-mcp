import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.10.0",
  date: "2026-10-11",
  summary: md(
    "Feedback you can work through: a compact listing, one item read whole, related items, and a question status.",
    list(
      "elixir_my_feedback: verbosity compact lists each item's id, area, category, title (the message's first line), status, follows_id, related_ids, has_response, responded_at and shipped_in, with no bodies; nothing is marked seen. feedback_id reads one of your items whole, with followed_by (its replies) and related_by (items naming it); its response is marked seen.",
      "elixir_my_feedback and elixir_send_feedback: a new status, needs_info, is a question from the maintainer; answer it with elixir_send_feedback follows_id. follows_id also corrects or adds to something you filed.",
      "elixir_send_feedback: refs take kind feedback with one of your own feedback ids, to say two items are related; someone else's id is refused (not_yours).",
      "elixir_send_feedback: on_behalf_of is an agent connection's argument only, as it always was; the docs no longer list it in the signature a personal connection reads.",
    ),
    "Additive. JSON API 3.2.0: GET /feedback takes feedback_id and verbosity, and the status and ref kind enums add needs_info and feedback.",
  ),
} satisfies ChangelogEntry;
