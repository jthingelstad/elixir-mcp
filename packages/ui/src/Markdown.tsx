import type { CSSProperties } from "react";
import { marked } from "marked";

/**
 * Markdown from a person or the maintainer (feedback and its reply, a
 * leader's note), rendered the way it was written: paragraphs, lists,
 * code, links.
 *
 * Two safety rules, because this text is typed by an account holder
 * and shown back to them (and to the maintainer): raw HTML is escaped
 * BEFORE parsing, so only Markdown syntax produces markup; and a link
 * keeps its href only when it is http(s) or mailto, so a javascript:
 * URL written as Markdown renders as plain text.
 */
const SAFE_HREF = /^(https?:|mailto:)/i;

const escapeHtml = (s: unknown) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** An href goes inside an attribute, so its quotes are escaped as well: a
 *  URL written with a `"` in it must not close the attribute. It arrives
 *  with `&`, `<` and `>` already escaped, so those stay as they are. */
const escapeHref = (s: unknown) =>
  String(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    link({ href, text }) {
      if (!SAFE_HREF.test(String(href ?? "")))
        return `<span>${escapeHtml(text)}</span>`;
      return `<a href="${escapeHref(href)}" rel="noopener noreferrer" target="_blank">${text}</a>`;
    },
  },
});

export function renderMarkdown(text: string | null | undefined): string {
  return marked.parse(escapeHtml(text ?? "")) as string;
}

/** `className` is the prose style to render under: the console's `md`,
 *  Elixir Clan's `prose`. */
export function Markdown({
  text,
  className = "md",
  style,
}: {
  text: string | null | undefined;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
}
