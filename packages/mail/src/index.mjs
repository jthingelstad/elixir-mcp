/** @elixir-mcp/mail: Elixir's email, rendered from facts.
 *
 *  One shell for every kind (shell.mjs): the logo and the wordmark, the
 *  product pill, packages/design's dark palette inline, table layout,
 *  600 px, and one footer. The relay's sign-in code, welcome and
 *  operator notices wear it too. A renderer per product kind takes the
 *  facts object its builder produced and returns {subject, preheader,
 *  html}; a text alternative is derived from the HTML so the two can
 *  never disagree; and the signed one-click unsubscribe token (RFC 8058)
 *  rides the footer and the header. Images are PNGs on Elixir's own
 *  origin (the logo, card art), each with alt text; the one tracking
 *  image is the open pixel, which names the mail and never the reader;
 *  links into the site carry the mail's campaign tag. Facts in, mail
 *  out; nothing here reads a database.
 */
export { renderMail, tagLink, KIND_LABELS } from "./render.mjs";
export {
  mailShell,
  mailParts,
  M as MAIL_PALETTE,
  FONT as MAIL_FONT,
  MONO as MAIL_MONO,
  MAIL_SCHEDULE,
} from "./shell.mjs";
export {
  pixelPath,
  pixelUrl,
  pixelTag,
  TINYLYTICS_EMBED_CODE,
} from "./pixel.mjs";
export { htmlToText } from "./text.mjs";
export { lintIssue, repairNames, briefNames } from "./top100-lint.mjs";
export {
  signUnsubscribe,
  verifyUnsubscribe,
  unsubscribeUrl,
  UNSUBSCRIBE_KEY_ID,
} from "./unsubscribe.mjs";
