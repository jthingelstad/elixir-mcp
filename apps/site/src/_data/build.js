/** Facts about THIS build, for examples that would otherwise go stale:
 *  a quota example that says when the day resets should name a reset
 *  that has not happened yet. SOURCE_DATE_EPOCH, when a build sets it,
 *  stands in for the clock: the deploy pins the docs corpus to its
 *  sources' last commit (infra/scripts/build.mjs), and the site it
 *  publishes builds without it, so the pages keep today's date. */
const now = process.env.SOURCE_DATE_EPOCH
  ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000)
  : new Date();
export default {
  date: now.toISOString().slice(0, 10),
  nextResetAt: new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString(),
};
