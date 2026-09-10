/**
 * The updates list as the Updates page reads it: product updates and
 * contract changes in ONE stream, newest first, each entry carrying a
 * KIND (shipped, contract, retired) and, for a contract change, the
 * version it shipped in.
 *
 * Contract entries come from the contract's own CHANGELOG rather than
 * from a second field somebody has to remember to type: a version is a
 * fact the contract already records, with its date and summary. A
 * retirement is read from the update's title. Nobody maintains a kind
 * by hand, so the rail's counts cannot drift from the entries.
 */
import updates from "./updates.js";
import changelog from "./changelog.js";

const RETIRED = /\b(retired|retire|retires|gone|removed|deleted|dropped)\b/i;

const product = updates.map((u) => ({
  ...u,
  kind: RETIRED.test(u.title) ? "retired" : "shipped",
  version: null,
}));

const contract = (changelog ?? []).map((c) => ({
  date: c.date,
  title: `Contract ${c.version}`,
  body:
    c.summary +
    (c.tools_added?.length
      ? ` Tools added: ${c.tools_added.join(", ")}.`
      : "") +
    (c.breaking ? ` Breaking: ${c.breaking}` : ""),
  link: `/data/changelog#v${c.version}`,
  kind: "contract",
  version: c.version,
}));

// Newest first; a product update and a contract change on the same day
// keep the update first, because it is the one written for a reader.
export default [...product, ...contract].sort((a, b) =>
  a.date === b.date
    ? (a.kind === "contract") - (b.kind === "contract")
    : String(b.date).localeCompare(String(a.date)),
);
