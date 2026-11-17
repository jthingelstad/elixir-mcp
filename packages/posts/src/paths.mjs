/** Member destinations, never public-share tokens. Safe in the browser. */
import { ELIXIR_ORIGIN } from "@elixir-mcp/contracts";

export function memberPostPath(id) {
  const value = String(id ?? "");
  return /^[1-9][0-9]{0,18}$/.test(value) &&
    BigInt(value) <= 9223372036854775807n
    ? `/home/post/${value}`
    : null;
}

export function memberPostUrl(id) {
  const path = memberPostPath(id);
  return path ? `${ELIXIR_ORIGIN}${path}` : null;
}
