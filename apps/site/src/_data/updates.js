/**
 * What's new — the product-updates surface. Newest first.
 *
 * One file per entry in ./updates/, written in the change's own pull
 * request, so parallel pull requests never edit one line:
 *
 *   updates/<YYYY-MM-DD>-<NN>-<slug>.md
 *
 *   # The title, one line
 *
 *   The body: what a person notices, in their words, ending with the
 *   versions ("MCP 11.7.2 and JSON API 3.1.0 unchanged.").
 *
 * The date is the file's. NN orders one day's entries, the higher the
 * newer: a new entry takes the day's highest NN plus one (01 on a new
 * day), so it sorts first without renaming any other. The slug is for
 * people; the page's address is made from the date and title
 * (updatesView.js).
 *
 * Rendered as a real page at /updates and summarised on the home page;
 * the docs corpus serves it to agents (elixir_updates). Lives in the
 * static site because it is content, not application state.
 */
import { readUpdates } from "../_lib/updates.mjs";

export default readUpdates(new URL("./updates/", import.meta.url));
