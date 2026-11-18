const ID = /^[1-9][0-9]{0,18}$/;
const precise = (at) => {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return null;
  const fraction =
    typeof at === "string"
      ? at.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/)?.[1]
      : "";
  return [ms, (fraction ?? "").slice(3).padEnd(6, "0").slice(0, 6)];
};

/** Match the server's timestamp/id tuple when the caller has that cursor.
 * Existing bell links keep their original time-only marker behavior. */
export function commentIsAfter(comment, entry) {
  if (!entry?.after) return false;
  if (entry.after === "all") return true;
  if (!ID.test(String(entry.afterId)) || !ID.test(String(comment.id)))
    return Date.parse(comment.at) > Date.parse(entry.after);
  const a = precise(comment.at);
  const b = precise(entry.after);
  if (!a || !b) return false;
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return BigInt(comment.id) > BigInt(entry.afterId);
}
