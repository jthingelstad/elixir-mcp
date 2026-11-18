/** A bounded source locator, never submitted facts or permission. Every
 * action resolves the identity from its current source before using it. */
export { timelineItemRef } from "@elixir-mcp/ui/item-link";

export function readItemRef(raw) {
  if (typeof raw !== "string" || raw.length > 1500) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}
