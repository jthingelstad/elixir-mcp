/** A leader's change refused `role_unconfirmed` (409): the clan's roster
 *  in Elixir is over an hour old, so Elixir is reading it from the game
 *  before acting on the role (packages/clan/src/role-freshness.mjs). The
 *  request that asked does not answer yet: the shell's notice says what
 *  is happening, Try again sends the same request, and its answer goes to
 *  the page that asked. Dismiss gives that page the refusal. One waits at
 *  a time; a newer one answers an older one with its refusal. */

let waiting = null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(waiting));

export const roleUnconfirmed = (r) =>
  r?.status === 409 && r.data?.error === "role_unconfirmed";

/** The request waiting on the role, or null. */
export const waitingForRole = () => waiting;

export function onRoleWait(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** `send()` makes the request; resolves to its answer, holding a
 *  role_unconfirmed refusal until the person tries again or dismisses. */
export async function confirmingRole(send) {
  const first = await send();
  if (!roleUnconfirmed(first)) return first;
  return new Promise((resolve) => {
    waiting?.dismiss();
    const entry = {
      refusal: first,
      retrying: false,
      async retry() {
        if (waiting !== entry || entry.retrying) return;
        entry.retrying = true;
        emit();
        const next = await send();
        entry.retrying = false;
        if (waiting !== entry) return;
        if (roleUnconfirmed(next)) {
          entry.refusal = next;
          emit();
          return;
        }
        waiting = null;
        emit();
        resolve(next);
      },
      dismiss() {
        if (waiting !== entry) return;
        waiting = null;
        emit();
        resolve(entry.refusal);
      },
    };
    waiting = entry;
    emit();
  });
}
