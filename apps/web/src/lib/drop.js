import {
  ATTESTED_FACT_TYPES,
  ATTESTED_SOURCE_NAMES,
} from "@elixir-mcp/contracts";
import { SHELL_PRODUCTS } from "@elixir-mcp/ui";

export const DROP_HOME =
  SHELL_PRODUCTS.find((product) => product.key === "drop")?.href ??
  "https://drop.poapkings.com/";

export function dropPlayHref(it) {
  if (it.kind === "drop_game") {
    const mode = it.facts?.mode;
    const modes = ATTESTED_FACT_TYPES.drop_game.detail.mode.values;
    // Drop routes games inside its document using the URL fragment.
    return modes.includes(mode)
      ? new URL(`#/${mode}`, DROP_HOME).href
      : DROP_HOME;
  }
  // Older personal bests identify the source but have no canonical mode.
  return it.kind === "personal_record" &&
    it.facts?.attested_by?.app === ATTESTED_SOURCE_NAMES["elixir-drop"]
    ? DROP_HOME
    : null;
}
