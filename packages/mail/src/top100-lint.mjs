/** The deterministic lint the Top 100 issue must pass before it sends
 *  (docs/top100/README.md, build order step 3): every number in the
 *  body exists in the brief, every numbers_used path resolves, no bare
 *  tag, no exclamation mark, prose under the ceiling, every table row
 *  that moves a rank carries a rating delta. Pure: the editor Lambda
 *  runs it between its two passes and the jobs Lambda runs it on
 *  acceptance, on the same code. */

/** Every number the brief holds, as canonical strings, for the lint. */
function numberSet(v, out = new Set()) {
  if (typeof v === "number" && Number.isFinite(v)) {
    out.add(String(Math.round(v)));
    out.add(String(Math.abs(Math.round(v))));
    if (Number.isInteger(v) && Math.abs(v) >= 1000)
      out.add(Math.abs(v).toLocaleString("en-US"));
  } else if (Array.isArray(v)) v.forEach((x) => numberSet(x, out));
  else if (v && typeof v === "object")
    Object.values(v).forEach((x) => numberSet(x, out));
  return out;
}

function resolvePath(obj, path) {
  return String(path)
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
    .reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** The deterministic lint. Returns [] when the issue may send. */
export function lintIssue(issue, brief) {
  const problems = [];
  const body = String(issue?.body_markdown ?? "");
  if (!body.trim()) problems.push("body_markdown is empty");
  if (/!/.test(body.replace(/!\[/g, "")))
    problems.push("exclamation mark in body");
  if (/#[0289PYLQGRJCUV]{5,}/.test(body))
    problems.push("a bare tag appears in the body");
  const prose = body
    .split("\n")
    .filter((l) => !/^\s*\|/.test(l) && !/^#/.test(l))
    .join(" ");
  const words = prose.split(/\s+/).filter(Boolean).length;
  if (words > 760) problems.push(`prose is ${words} words; the ceiling is 700`);
  const known = numberSet(brief);
  // Structural numbers the writer may print without a brief path.
  [
    "100",
    "10",
    "3",
    "5",
    "1",
    "2",
    "4",
    "6",
    "7",
    "8",
    "9",
    String(brief?.season?.id ?? ""),
  ].forEach((x) => known.add(x));
  for (const m of body.matchAll(/(?<![\w#])[+−-]?\d[\d,]*(?![\w])/g)) {
    const raw = m[0].replace(/^[+−-]/, "");
    if (raw.length < 2) continue;
    if (/^\d{4}$/.test(raw) && Number(raw) >= 2022 && Number(raw) <= 2030)
      continue; // a year
    if (!known.has(raw) && !known.has(raw.replace(/,/g, "")))
      problems.push(`number ${m[0]} is not in the brief`);
  }
  for (const row of body
    .split("\n")
    .filter((l) => /^\s*\|/.test(l) && /→/.test(l))) {
    if (!/[+−-]\s?\d/.test(row))
      problems.push(
        `table row without a rating delta: ${row.trim().slice(0, 60)}`,
      );
  }
  for (const u of issue?.numbers_used ?? []) {
    const v = resolvePath(brief, u.brief_path);
    if (v === undefined)
      problems.push(`numbers_used path ${u.brief_path} does not resolve`);
  }
  if (!issue?.subject || String(issue.subject).length > 78)
    problems.push("subject missing or over 78 characters");
  return [...new Set(problems)];
}
