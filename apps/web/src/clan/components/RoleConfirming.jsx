import { useEffect, useState } from "react";
import { onRoleWait, waitingForRole } from "../lib/role.js";

/** The notice for a change waiting on the person's role in the game
 *  (lib/role.js), above whatever page asked. */
export function RoleConfirming() {
  const [entry, setEntry] = useState(waitingForRole);
  const [, rerender] = useState(0);
  useEffect(
    () =>
      onRoleWait((next) => {
        setEntry(next);
        rerender((n) => n + 1);
      }),
    [],
  );
  if (!entry) return null;
  return (
    <div className="callout callout--info mb-4" role="status">
      <span>Confirming your role in the game; try again in a minute.</span>
      <span className="flex gap-2">
        <button
          type="button"
          className="btn btn--sm"
          disabled={entry.retrying}
          onClick={() => entry.retry()}
        >
          {entry.retrying ? "Trying…" : "Try again"}
        </button>
        <button
          type="button"
          className="btn--text"
          onClick={() => entry.dismiss()}
        >
          Dismiss
        </button>
      </span>
    </div>
  );
}
