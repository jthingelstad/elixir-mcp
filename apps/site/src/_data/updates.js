/**
 * What's new: the public log of the changes people notice. Newest first.
 * Not every user-visible change needs an entry; one is written when a
 * change is worth telling, tools included (2026-11-23).
 *
 * One file per entry in ./updates/, written in the change's own pull
 * request, so parallel pull requests never edit one line:
 *
 *   updates/<YYYY-MM-DD>-t<HHMMSS>-<slug>.md
 *
 *   # The title, one line
 *
 *   The body: what a person notices, in their words. Entries before
 *   2026-11-23 end with a versions line; that is history, and a new
 *   entry has none.
 *
 * The date and time are UTC. Each session names its own fragment; two
 * fragments at the same second sort by file name. Legacy NN entries stay
 * readable and keep their relative order, below timed entries on that day.
 * Never rename an existing entry. The slug is for people; the page's address
 * is made from the date and title (updatesView.js), not the time or number.
 *
 * Rendered as real pages at /updates, its months and its feeds; the docs
 * corpus serves it to agents (elixir_updates). Lives in the
 * static site because it is content, not application state.
 */
import { readUpdates } from "../_lib/updates.mjs";

export default readUpdates(new URL("./updates/", import.meta.url));
