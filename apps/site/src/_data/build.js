/** Facts about THIS build, for examples that would otherwise go stale:
 *  a quota example that says when the day resets should name a reset
 *  that has not happened yet. */
const now = new Date();
export default {
  date: now.toISOString().slice(0, 10),
  nextResetAt: new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString(),
};
