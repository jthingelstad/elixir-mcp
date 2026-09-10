/**
 * The eleven examples as one list, for pagination: each carries its
 * group, its glyph, and the three siblings "More like this" offers —
 * the rest of its own group first, then the next group's, so a card is
 * never the page you are on and never a blank.
 */
import examples from "./examples.js";

const all = examples.flatMap((g) =>
  g.cases.map((c) => ({ ...c, group: g.group })),
);

export default all.map((c, i) => {
  const same = all.filter((x) => x.group === c.group && x.key !== c.key);
  const rest = all.filter((x) => x.group !== c.group);
  const after = [...all.slice(i + 1), ...all.slice(0, i)].filter(
    (x) => x.key !== c.key,
  );
  const related = [...same, ...rest.filter((x) => after.includes(x))].slice(
    0,
    3,
  );
  return { ...c, related, count: all.length };
});
