import type { ReactNode } from "react";

/**
 * A player or clan tag as a person reads it (2026-10-08). Tags mix
 * digits and capitals, and in the display face and plain Inter a zero
 * and a capital O are the same round shape: a typo'd "#9YOLV2QCL" read
 * as the right tag on the Tracking page's own headline. Every tag a
 * page shows goes through here, or through `.cr-tag` in markup the kit
 * does not draw: monospace with a slashed zero (design
 * components.css), at the size of the text around it.
 */
export function Tag({
  tag,
  className,
  title,
}: {
  tag: string | null | undefined;
  className?: string;
  title?: string;
}) {
  if (!tag) return null;
  return (
    <span
      className={className ? `cr-tag ${className}` : "cr-tag"}
      translate="no"
      {...(title ? { title } : {})}
    >
      {tag}
    </span>
  );
}

/** A tag inside a sentence: "#" then three or more capitals and digits
 *  with at least one capital (a typo can carry an O or an I the game
 *  never issues, which is the case this exists for), so "PR #345" and
 *  a season number stay words. */
const TAG_IN_TEXT = /#(?=[0-9]*[A-Z])[0-9A-Z]{3,}(?![0-9A-Za-z])/g;

/** The pieces of a sentence, with each tag in it marked. Pure, so a
 *  test can read it without rendering. */
export function splitTags(text: string): Array<{ text: string; tag: boolean }> {
  const out: Array<{ text: string; tag: boolean }> = [];
  let at = 0;
  for (const m of String(text ?? "").matchAll(TAG_IN_TEXT)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: text.slice(at, i), tag: false });
    out.push({ text: m[0], tag: true });
    at = i + m[0].length;
  }
  if (at < String(text ?? "").length)
    out.push({ text: String(text).slice(at), tag: false });
  return out;
}

/** A sentence that may name a tag ("Clash Royale answered 'not found'
 *  for #9YOLV2QCL"): the words stay in the page's face, each tag in it
 *  is a Tag. Anything that is not a string is drawn as given. */
export function TagText({ children }: { children?: ReactNode }) {
  if (typeof children !== "string") return <>{children}</>;
  const parts = splitTags(children);
  if (!parts.some((p) => p.tag)) return <>{children}</>;
  return (
    <>
      {parts.map((p, i) =>
        p.tag ? <Tag key={i} tag={p.text} /> : <span key={i}>{p.text}</span>,
      )}
    </>
  );
}
