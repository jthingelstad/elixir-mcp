/**
 * The sitemap's <lastmod>: when a page's content last really changed.
 *
 * Never the build's clock. A page is dated by the newest of:
 *   - the last commit to each source file its content comes from (its
 *     template, the data module behind it, an update's own file, a
 *     contract change's own file). The layouts and the shared chrome are
 *     left out, so a header change does not redate every page;
 *   - the data it bakes in: the contract's newest change for the pages
 *     generated from the tool registry, the card catalog's last change
 *     (its as_of) for the card pages, the stats snapshot for the pages
 *     that print one ("snapshot fetched ...");
 *   - for a list page, the newest of the pages it lists.
 *
 * One `git log` pass reads every file's last commit. A shallow clone
 * would date every file by its one commit, so a build that publishes
 * (one that reads live stats) refuses one; a test build (--skip-stats)
 * takes what history it has.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parseUpdate } from "./updates.mjs";

const siteDir = path.resolve(import.meta.dirname, "..", "..");
const repoRoot = path.resolve(siteDir, "..", "..");
const src = (rel) => `apps/site/src/${rel}`;
const CHANGES = "packages/contracts/src/changes";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** W3C datetime to the second, UTC; a bare day stays a day. */
const w3c = (date) =>
  DAY.test(date)
    ? date
    : new Date(date).toISOString().replace(/\.\d{3}Z$/, "Z");
const time = (d) => new Date(d).getTime();
/** The newest of some dates (ISO strings or days), as given. */
const newest = (dates) =>
  dates
    .filter((d) => d && !Number.isNaN(time(d)))
    .reduce((a, b) => (a === null || time(b) > time(a) ? b : a), null);

const git = (args) =>
  execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

/** Every file's last and first commit dates under the paths the site
 *  reads. */
function readCommitDates({ publishing }) {
  if (
    publishing &&
    git(["rev-parse", "--is-shallow-repository"]).trim() === "true"
  )
    throw new Error(
      "sitemap lastmod needs full git history: this clone is shallow",
    );
  const dates = new Map();
  const firsts = new Map();
  let at = null;
  for (const line of git([
    "log",
    "--format=%x01%cI",
    "--name-only",
    "--",
    "apps/site/src",
    CHANGES,
  ]).split("\n")) {
    if (line.startsWith("\x01")) at = line.slice(1);
    else if (line && at) {
      if (!dates.has(line)) dates.set(line, at);
      firsts.set(line, at);
    }
  }
  return { dates, firsts };
}

/** The update file each product entry came from, by date and title. */
function updateFiles() {
  const dir = path.join(siteDir, "src/_data/updates");
  const files = new Map();
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
    const { entry } = parseUpdate(
      name,
      readFileSync(path.join(dir, name), "utf8"),
    );
    files.set(`${entry.date}\n${entry.title}`, src(`_data/updates/${name}`));
  }
  return files;
}

/** Source files beyond a page's own template, by canonical URL. */
const EXTRA = [
  [/^\/cards(\/|$)/, ["_lib/cards.mjs"]],
  [/^\/docs\/tools(\/|$)/, ["_includes/tool-group.njk", "_data/tools.js"]],
  [
    /^\/examples\//,
    ["_data/examples.js", "_data/examplesFlat.js", "_data/transcript.js"],
  ],
  [/^\/family(\/|$)/, ["_data/family.js", "_data/familyFlat.js"]],
];
/** Pages that print the stats snapshot. */
const STATS = /^\/(|support|data|data\/growth|data\/now|data\/collect)$/;

/**
 * Make the lastmod function for one build. `pages` are the sitemap's
 * pages (Eleventy collection items); `data` is the build's global data
 * (stats, catalogAsOf, updatesView).
 */
export function makeLastmod({ pages, data, pageUrl }) {
  const publishing = data.stats?.ok === true;
  const { dates: commits, firsts } = readCommitDates({ publishing });
  const committed = (rel) => {
    if (commits.has(rel)) return commits.get(rel);
    // Not committed yet (a local build of new work): its file time.
    const file = path.join(repoRoot, rel);
    return existsSync(file) ? statSync(file).mtime.toISOString() : null;
  };
  const contractDate = newest(
    [...commits].filter(([f]) => f.startsWith(`${CHANGES}/`)).map(([, d]) => d),
  );
  const files = updateFiles();
  // An entry is dated by its own file's last commit, except where the
  // file was MADE later than the entry: What's new and the contract
  // changelog were split one file per entry on 2026-10-10, and an older
  // entry did not change that day. Its own day stands until a later
  // commit edits it.
  const entryDate = (rel, day) => {
    const last = rel && commits.get(rel);
    if (!last) return (rel && committed(rel)) ?? day;
    const moved = time(firsts.get(rel)) - time(day) > 2 * 86_400_000;
    return moved && last === firsts.get(rel) ? day : last;
  };
  const updateDate = (u) =>
    u.kind === "contract"
      ? entryDate(`${CHANGES}/${u.version}.ts`, u.date)
      : entryDate(files.get(`${u.date}\n${u.title}`), u.date);
  const updatesDate = newest((data.updatesView ?? []).map(updateDate));

  const own = (p) => {
    const url = pageUrl(p);
    const template = src(
      path.relative(
        path.join(siteDir, "src"),
        path.resolve(siteDir, p.inputPath),
      ),
    );
    // An update's page is its entry; the template is its layout.
    const dates = url.startsWith("/updates/") ? [] : [committed(template)];
    for (const [re, extra] of EXTRA)
      if (re.test(url)) dates.push(...extra.map((f) => committed(src(f))));
    if (url.startsWith("/updates/")) dates.push(updateDate(p.data.u));
    if (url.startsWith("/cards")) dates.push(data.catalogAsOf);
    if (STATS.test(url) && data.stats?.ok) dates.push(data.stats.fetched_at);
    // Generated from the tool registry: every change to it is a contract
    // change (golden rule 5), so the contract's newest change dates it.
    const text = p.inputPath.endsWith(".md")
      ? readFileSync(path.resolve(siteDir, p.inputPath), "utf8")
      : "";
    if (url.startsWith("/docs/tools") || /\{\{[^}]*\btools\./.test(text))
      dates.push(contractDate);
    if (/\{\{[^}]*\bresponses\./.test(text))
      dates.push(committed(src("_data/responses.js")));
    return newest(dates);
  };

  const byUrl = new Map(pages.map((p) => [pageUrl(p), own(p)]));
  // List pages: the newest of what they list.
  const listed = (prefix) =>
    [...byUrl].filter(([u]) => u.startsWith(prefix)).map(([, d]) => d);
  if (byUrl.has("/updates"))
    byUrl.set("/updates", newest([byUrl.get("/updates"), updatesDate]));
  if (byUrl.has("/docs"))
    byUrl.set("/docs", newest([byUrl.get("/docs"), ...listed("/docs/")]));
  if (byUrl.has("/cards"))
    byUrl.set("/cards", newest([byUrl.get("/cards"), ...listed("/cards/")]));

  return (p) => {
    const date = byUrl.get(pageUrl(p));
    if (!date) throw new Error(`sitemap: no lastmod for ${pageUrl(p)}`);
    return w3c(date);
  };
}
