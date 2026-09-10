/**
 * The family as one list, for pagination: one page per product, each
 * knowing its group, whether it is ours, and the three siblings the
 * page offers at its foot — "Also in the family" for ours, "More we
 * like" for theirs. The hub itself is `here` and is never offered.
 */
import family from "./family.js";

const all = family.flatMap((g) =>
  g.projects.map((p) => ({ ...p, group: g.group, theirs: Boolean(g.theirs) })),
);

export default all.map((p, i) => ({
  ...p,
  first: i === 0,
  count: all.length,
  siblings: all
    .filter((x) => x.key !== p.key && !x.here && x.theirs === p.theirs)
    .slice(0, 3),
}));
