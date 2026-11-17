import { Icon } from "@elixir-mcp/ui";
import { cheerOf } from "./cheer-set.js";

/** A cheer kind's glyph, the same everywhere (CHEERS in cheer-set.js is
 *  the one map). Hidden from readers: the words beside it, or its
 *  control's name, say the kind. */
export function CheerGlyph({ kind, size = 18 }) {
  return (
    <Icon
      name={cheerOf(kind).icon}
      size={size}
      className={`kit-cheerglyph kit-cheerglyph--${cheerOf(kind).key}`}
    />
  );
}
