import { marked } from "marked";

/**
 * Markdown from a person or the maintainer (feedback and its reply),
 * rendered the way it was written: paragraphs, lists, code, links.
 *
 * Two safety rules, because this text is typed by an account holder
 * and shown back to them (and to the maintainer): raw HTML is escaped
 * BEFORE parsing, so only Markdown syntax produces markup; and a link
 * keeps its href only when it is http(s) or mailto, so a javascript:
 * URL written as Markdown renders as plain text.
 */
const SAFE_HREF = /^(https?:|mailto:)/i;

const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const renderer = {
  link({ href, text }) {
    if (!SAFE_HREF.test(String(href ?? "")))
      return `<span>${escapeHtml(text)}</span>`;
    return `<a href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">${text}</a>`;
  },
};
marked.use({ renderer, gfm: true, breaks: true });

function renderMarkdown(text) {
  return marked.parse(escapeHtml(text ?? ""));
}

export function Markdown({ text, className = "", style }) {
  return (
    <div
      className={`md ${className}`.trim()}
      style={style}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
}
