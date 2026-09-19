/** @elixir-mcp/mail: product email, rendered from facts.
 *
 *  One shell and a handful of components (packages/design's dark
 *  tokens, inline, table layout, 600 px, no images, no tracking, links
 *  bare), a renderer per kind that takes the facts object its builder
 *  produced and returns {subject, preheader, html}, a text alternative
 *  derived from the HTML so the two can never disagree, and the signed
 *  one-click unsubscribe token (RFC 8058) the footer and the header
 *  carry. Facts in, mail out; nothing here reads a database.
 */
export { renderMail, tagLink, KIND_LABELS } from "./render.mjs";
export {
  pixelPath,
  pixelUrl,
  pixelTag,
  TINYLYTICS_EMBED_CODE,
} from "./pixel.mjs";
export { htmlToText } from "./text.mjs";
export { lintIssue, repairNames } from "./top100-lint.mjs";
export {
  signUnsubscribe,
  verifyUnsubscribe,
  unsubscribeUrl,
} from "./unsubscribe.mjs";
