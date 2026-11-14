import { useMemo, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PlayerIdentityProvider } from "@elixir-mcp/ui";

/** The current app's cache only: SSR requests and signed-out sessions never
 * share a registry. Newer responses win; removing a query removes its proof.
 * Reads carry the metadata, so avatars never start their own HTTP requests. */
function proofs(data, into) {
  if (!data || typeof data !== "object") return;
  Object.assign(into, data.player_verifications);
  for (const key of ["data", "body", "pages"]) {
    const child = data[key];
    if (Array.isArray(child)) child.forEach((page) => proofs(page, into));
    else proofs(child, into);
  }
}
function proofStore(client) {
  const cache = client.getQueryCache();
  let snapshot;
  const read = () => {
    if (!snapshot) {
      const next = {};
      cache
        .getAll()
        .slice()
        .sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt)
        .forEach((q) => proofs(q.state.data, next));
      snapshot = next;
    }
    return snapshot;
  };
  return {
    read,
    subscribe: (notify) =>
      cache.subscribe((event) => {
        if (
          event.type === "removed" ||
          (event.type === "updated" &&
            ["success", "setState"].includes(event.action.type))
        ) {
          snapshot = undefined;
          notify();
        }
      }),
  };
}
export function PlayerIdentities({ children }) {
  const client = useQueryClient();
  const store = useMemo(() => proofStore(client), [client]);
  const players = useSyncExternalStore(store.subscribe, store.read, store.read);
  return (
    <PlayerIdentityProvider players={players}>
      {children}
    </PlayerIdentityProvider>
  );
}
