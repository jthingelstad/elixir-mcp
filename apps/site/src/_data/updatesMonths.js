/**
 * The Updates stream by month, newest first: each month is a page of its own at
 * /updates/<YYYY-MM>, and /updates shows the newest month plus earlier ones
 * until there are ten product entries to read (A36). Derived from the dates,
 * never typed twice.
 */
import updatesView from "./updatesView.js";

const FRONT_PRODUCT_ENTRIES = 10;

const label = (key) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

const byKey = new Map();
for (const u of updatesView) {
  const key = String(u.date).slice(0, 7);
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(u);
}

const months = [...byKey.entries()]
  .sort(([a], [b]) => b.localeCompare(a))
  .map(([key, items]) => ({
    key,
    label: label(key),
    items,
    product: items.filter((u) => u.kind !== "contract").length,
    all: items.length,
  }));

months.forEach((m, i) => {
  m.newer = months[i - 1]?.key ?? null;
  m.newerLabel = months[i - 1]?.label ?? null;
  m.older = months[i + 1]?.key ?? null;
  m.olderLabel = months[i + 1]?.label ?? null;
});

/** How many months the front page holds. */
let front = 0;
for (let shown = 0; front < months.length; front += 1) {
  if (shown >= FRONT_PRODUCT_ENTRIES) break;
  shown += months[front].product;
}

export default { months, front: months.slice(0, Math.max(front, 1)) };
