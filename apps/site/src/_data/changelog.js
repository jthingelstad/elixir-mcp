/** The contract changelog, straight from packages/contracts. Subpath
 *  import: the barrel pulls node:crypto through deck.js, which the app's
 *  bundler could not follow - kept here so both halves read the same
 *  module the same way. */
import { CHANGELOG } from "@elixir-mcp/contracts/dist/changelog.js";

export default CHANGELOG;
