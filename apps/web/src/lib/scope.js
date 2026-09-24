import { createContext, useContext } from "react";

/**
 * Whose console this is: null for yours, an agent's public id for its
 * (docs/reviews/2026-09-23-CONSOLE-ACCOUNT-SWITCHER.md).
 *
 * Set from the ADDRESS by the agent route (`/agent/<public_id>/...`), never
 * remembered: two tabs can show two consoles, and a write can only land
 * where the address says. The scoped query hooks read it, so a view that
 * serves both consoles does not have to thread it through its props.
 */
const ScopeContext = createContext(null);

export const ScopeProvider = ScopeContext.Provider;

export const useScope = () => useContext(ScopeContext);

/** A console path in a scope: `/account/<rest>` for you, the same page
 *  under `/agent/<public_id>/<rest>` for an agent. */
function consolePath(agent, path) {
  if (!agent || !path.startsWith("/account/")) return path;
  return `/agent/${agent}/${path.slice("/account/".length)}`;
}

/** consolePath bound to the console being read. */
export function useConsolePath() {
  const agent = useScope();
  return (path) => consolePath(agent, path);
}
