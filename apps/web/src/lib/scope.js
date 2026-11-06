import { createContext, useContext } from "react";
import { SETTINGS } from "./settings.js";

/**
 * Whose page this is: null for yours, an agent's public id for its.
 *
 * Set from the ADDRESS by the agent's pages (`/settings/agents/<public_id>/...`),
 * never remembered: two tabs can show two agents, and a write can only land
 * where the address says. The scoped query hooks read it, so a view that serves
 * you and an agent does not have to thread it through its props.
 */
const ScopeContext = createContext(null);

export const ScopeProvider = ScopeContext.Provider;

export const useScope = () => useContext(ScopeContext);

/** Your pages and where the same page sits for an agent. Anything else
 *  (a Players link from a Connections page, say) is yours and stays yours. */
const AGENT_PAGE = [
  [`${SETTINGS}/players`, "reads"],
  [`${SETTINGS}/usage`, "usage"],
  [`${SETTINGS}/connections`, "connections"],
  [`${SETTINGS}/feedback`, "feedback"],
];
function scopedPath(agent, path) {
  if (!agent) return path;
  for (const [mine, theirs] of AGENT_PAGE)
    if (path === mine || path.startsWith(`${mine}/`))
      return `${SETTINGS}/agents/${agent}/${theirs}${path.slice(mine.length)}`;
  return path;
}

/** scopedPath bound to the page being read. */
export function useScopedPath() {
  const agent = useScope();
  return (path) => scopedPath(agent, path);
}
