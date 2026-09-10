/**
 * The home page transcript: three of the examples, one per chip.
 *
 * Derived from examples.js rather than copied from it, so the home
 * page's exchange and the example's page can never disagree — and so
 * the three cards under the window are the same three examples.
 */
import examples from "./examples.js";

const PICK = [
  ["play", "Your play"],
  ["clan", "Your clan"],
  ["friends", "Your friends"],
];

const all = examples.flatMap((g) => g.cases);

export default PICK.map(([key, label]) => {
  const c = all.find((x) => x.key === key);
  if (!c)
    throw new Error(
      `home transcript names example "${key}", which does not exist`,
    );
  return {
    key,
    label,
    title: c.title,
    lede: c.lede,
    icon: c.icon,
    proof: c.reads[0],
    tool: c.script.tool,
    lines: c.script.lines,
  };
});
