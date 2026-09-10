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

/** Every entry is a page, so every entry needs a stable address. The date
 *  leads it: two updates have shared a title before now, updates are read
 *  newest-first anyway, and a dated URL tells a reader how old the thing
 *  they are about to read is before they open it. */
const slugify = (date, title) =>
  `${date}-${String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "")}`;

const product = updates.map((u) => ({
  ...u,
  kind: RETIRED.test(u.title) ? "retired" : "shipped",
  version: null,
  slug: slugify(u.date, u.title),
}));

// The contract's own changelog IS the contract half of this list — there
// is no second page for it since 2026-09-10, so its extra facts (the
// tools a version added, what it broke) ride on the entry rather than
// being flattened into the summary and lost.
const contract = (changelog ?? []).map((c) => ({
  date: c.date,
  title: `Contract ${c.version}`,
  body: c.summary,
  tools_added: c.tools_added ?? [],
  breaking: c.breaking ?? null,
  kind: "contract",
  version: c.version,
  slug: `${c.date}-contract-${String(c.version).replaceAll(".", "-")}`,
}));

// Newest first; a product update and a contract change on the same day
// keep the update first, because it is the one written for a reader.
export default [...product, ...contract].sort((a, b) =>
  a.date === b.date
    ? (a.kind === "contract") - (b.kind === "contract")
    : String(b.date).localeCompare(String(a.date)),
);
