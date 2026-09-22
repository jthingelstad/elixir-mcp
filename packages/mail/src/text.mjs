/** The plain-text alternative, derived from the rendered HTML.
 *
 *  A second hand-written text template per kind would drift from the
 *  HTML the week after it was written; deriving keeps the two halves of
 *  the multipart the same mail. Tables become one line per row with
 *  cells separated by two spaces; block elements break lines; links
 *  print their href once after the text when it is not the text itself.
 *  Good enough for a text-only client and for an agent reading mail. */

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  nbsp: " ",
  "#39": "'",
  ldquo: "\u201c",
  rdquo: "\u201d",
  lsquo: "\u2018",
  rsquo: "\u2019",
  hellip: "\u2026",
  mdash: "\u2014",
  ndash: "\u2013",
};

function decode(s) {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#")
      return String.fromCodePoint(
        e[1] === "x" || e[1] === "X"
          ? parseInt(e.slice(2), 16)
          : Number(e.slice(1)),
      );
    return ENTITIES[e] ?? m;
  });
}

export function htmlToText(html) {
  let s = String(html ?? "");
  // The hidden preheader is for inboxes, not the text part.
  s = s.replace(/<span style="display:none[^"]*"[^>]*>[\s\S]*?<\/span>/i, "");
  s = s.replace(/<head[\s\S]*?<\/head>/i, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  // Links: "text (href)" unless the text is the href.
  s = s.replace(
    /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (m, href, text) => {
      const t = text.replace(/<[^>]+>/g, "").trim();
      return t === href || !/^https?:/.test(href) ? t : `${t} (${href})`;
    },
  );
  // An image's alt is its text. A deck block is eight card icons in a
  // table, so without this the text half loses the deck entirely; the
  // open pixel carries alt="" and correctly leaves nothing behind.
  s = s.replace(
    /<img\b[^>]*\balt="([^"]*)"[^>]*>/gi,
    (m, alt) => decode(alt) || "",
  );
  s = s.replace(/<\/(td|th)>/gi, "  ");
  s = s.replace(/<\/(tr|p|div|h[1-6]|li|table)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decode(s);
  return (
    s
      .split("\n")
      .map((l) =>
        l
          .replace(/[ \t]+/g, " ")
          .replace(/ {2,}/g, "  ")
          .trim(),
      )
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}
