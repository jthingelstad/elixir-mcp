import { ELIXIR_ORIGIN } from "@elixir-mcp/contracts";

export const SHARE_ID = /^[a-z2-7]{24}$/;
export const ITEM_ID = /^tl_[0-9a-f]{20}$/;
export function sharePath(id) {
  return SHARE_ID.test(String(id ?? "")) ? `/share/${id}` : null;
}
export function shareUrl(id) {
  const path = sharePath(id);
  return path ? `${ELIXIR_ORIGIN}${path}` : null;
}
