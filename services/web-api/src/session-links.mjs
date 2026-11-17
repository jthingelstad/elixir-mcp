/** A sitting's public page and its picture (2026-11-17): the absolute
 *  addresses its Share panel copies and its preview tags name. One place,
 *  so the signed-in page's panel and the public page agree. */
import { ELIXIR_ORIGIN } from "@elixir-mcp/contracts";
import { publicSessionPath } from "@elixir-mcp/ui/session-story";

export function publicSessionLinks(read) {
  const path = publicSessionPath(
    read?.player?.tag,
    read?.item?.id,
    read?.item?.facts?.started_at,
  );
  return path
    ? { url: `${ELIXIR_ORIGIN}${path}`, image: `${ELIXIR_ORIGIN}${path}.png` }
    : { url: null, image: null };
}
