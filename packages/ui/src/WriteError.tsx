/**
 * What a failed write says: one sentence, where
 * the control is, so a refused revoke or sign-out never looks like
 * nothing happened. Fed the `error` of the client's `useWrite` (an
 * ApiError); typed by shape here, so the kit does not depend on the
 * client package.
 *
 * - The server refused and said why: its own message, which names the
 *   rule (a tier, a slot, a primary player in use).
 * - The server refused without a message: the status, plainly.
 * - No answer in time: the write may or may not have landed, so it says
 *   to reload and look rather than claiming either.
 * - No answer at all, or a 5xx: nothing took, try again.
 */
export interface WriteFailure {
  status?: number;
  transport?: string | null;
  data?: unknown;
}

export function writeErrorText(error: WriteFailure): string {
  const data = error.data as { message?: unknown } | null | undefined;
  const said =
    data && typeof data.message === "string" && data.message.trim()
      ? data.message.trim()
      : null;
  if (error.transport === "timeout")
    return "Elixir did not answer in time, so this may or may not have taken effect. Reload to see.";
  if (error.transport || !error.status)
    return "Elixir could not be reached, so nothing was changed. Try again in a moment.";
  if (error.status >= 500)
    return (
      said ??
      `That did not go through (HTTP ${error.status}). Try again in a moment.`
    );
  return said ?? `That was refused (HTTP ${error.status}).`;
}

export function WriteError({
  error,
  className = "field-error",
}: {
  error: WriteFailure | null | undefined;
  className?: string;
}) {
  if (!error) return null;
  return (
    <p className={className} role="alert">
      {writeErrorText(error)}
    </p>
  );
}
