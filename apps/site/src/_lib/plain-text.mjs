/**
 * Markdown to one line of plain text, for a meta description or an
 * update's teaser on /updates.
 *
 * Only Markdown's marks come off. An underscore between two word
 * characters is part of a name (`elixir_my_feedback`, `follows_id`),
 * never emphasis, so it stays: the first version stripped every `_`
 * and the Updates page printed "elixirmyfeedback".
 */
export function firstParagraph(md) {
  const body = String(md ?? "")
    .split("\n")
    .filter((l) => !l.startsWith("#"))
    .join("\n")
    .trim();
  const para = body.split(/\n\s*\n/)[0] ?? "";
  return (
    para
      .replace(/\s+/g, " ")
      // A link keeps its words: [Modes](/docs/modes) reads "Modes".
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*`[\]]/g, "")
      // Emphasis underscores sit at a word's edge; a name's sit inside it.
      .replace(/(^|[^\p{L}\p{N}_])_+(?=\S)/gu, "$1")
      .replace(/(\S)_+(?=$|[^\p{L}\p{N}_])/gu, "$1")
      .trim()
  );
}
