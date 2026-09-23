/** Card of the Week: choose, brief, hand to the editor; then take the
 *  editor's answer back, lint it and store it (docs/EMAIL.md, Friday).
 *
 *  The shape is the Top 100's, through issue-pipeline.mjs. What is this
 *  kind's own: the card is CHOSEN first (card-of-week-select.mjs) and
 *  the pick is written before the brief, the season chart is rendered
 *  and stored as an asset beside the brief, and the facts the renderer
 *  gets carry the decks as structured rows - the writer places a deck
 *  and never spells it. */
import pg from "pg";
import { loadRecipients } from "./ctx.mjs";
import { lastGameWeek } from "./week.mjs";
import { selectCard, recordFeatured } from "./card-of-week-select.mjs";
import { buildCardOfWeekBrief } from "./build-card-of-week.mjs";
import { seasonChart } from "./chart.mjs";
import { generateIssue, acceptIssue, putAsset } from "./issue-pipeline.mjs";

const KIND = "card_of_week";
const SITE = "https://elixir.poapkings.com";
const MASTHEAD = "Card of the Week";

/** The week a Friday issue covers: the game week that closed on Monday,
 *  the same grid the other reports use, keyed by its ISO week. */
export function issueWeek(now = new Date()) {
  const week = lastGameWeek(now);
  return { week, periodKey: week.key };
}

/** The renderer's facts, from the brief and the accepted issue. */
export function cardOfWeekFacts(brief, issue) {
  return {
    masthead: MASTHEAD,
    subject: issue.subject,
    preheader: issue.preheader ?? "",
    card: brief.card,
    issue: {
      date: brief.period_key,
      week_label: brief.windows.headline.label,
      season_label: `Season ${brief.windows.depth.season_month} to date`,
      data_as_of: brief.generated_at,
    },
    body_markdown: issue.body_markdown,
    chart: brief.chart,
    decks: brief.decks,
    coverage: coverageLine(brief),
    numbers_used: issue.numbers_used ?? [],
    alternates: issue.subjects ?? [],
  };
}

/** Both windows named, and the record they were read from. The mail
 *  never shows one window's number under the other's label. */
function coverageLine(b) {
  const w = b.windows.headline;
  const n = (v) => (v == null ? "?" : Number(v).toLocaleString("en-US"));
  const pop = {
    recorded_players: n(b.population.recorded_players),
    recorded_clans: n(b.population.recorded_clans),
    players_in_window: n(b.population.players_in_window),
  };
  return (
    `Numbers are the game week of ${w.from_day} to ${w.to_day} ${w.month} ${w.year} (headline) ` +
    `and ${b.windows.depth.label} (modes, bands, partners, decks), read from the Elixir record of ` +
    `${pop.recorded_players} recorded players across ${pop.recorded_clans} clans and ` +
    `${pop.players_in_window} players seen in the window. Only decided one-on-one battles count.`
  );
}

/** Every name the writer might have mangled through a broken escape. */
export function briefNames(brief) {
  const names = new Set([brief.card?.name]);
  for (const p of brief.partners ?? []) names.add(p.name);
  for (const d of [...(brief.decks ?? []), brief.best_of_five].filter(Boolean))
    for (const c of d.cards ?? []) names.add(c.name);
  for (const r of [brief.rank?.above, brief.rank?.below].filter(Boolean))
    names.add(r.name);
  return [...names].filter(Boolean);
}

export async function cardOfWeekGenerate({
  databaseUrl,
  db = null,
  bucket,
  now = new Date(),
  force = process.env.CARD_OF_WEEK_FORCE,
  dryRun = false,
}) {
  const own = !db;
  if (own) {
    db = new pg.Client({ connectionString: databaseUrl });
    await db.connect();
  }
  try {
    const [account] = await loadRecipients(db, KIND);
    if (!account) return { skipped: "no recipient to read as" };
    const { week, periodKey } = issueWeek(now);
    const selection = await selectCard(db, { periodKey, now, force });
    if (!selection.card) return { skipped: selection.why, periodKey };
    // The candidate log is written every week, whatever happens next, so
    // the choice is auditable. A dry run decides nothing and writes
    // nothing: it must not consume a card or move the week's pick.
    if (!dryRun) await recordFeatured(db, { periodKey, ...selection });
    const brief = await buildCardOfWeekBrief({
      db,
      account,
      selection,
      week,
      periodKey,
      now,
    });
    // The chart is rendered here so the writer never sees the series
    // except through the brief. A chart that fails to render is not a
    // reason to lose the issue, and a record with no comparable seasons
    // yet has no chart to draw: a picture of our own coverage growing
    // is not a picture of the card.
    try {
      const png = brief.trend
        ? seasonChart(brief.trend.seasons, brief.windows.depth.season_month)
        : null;
      if (png && brief.chart) {
        const key = `mail/${KIND}/${periodKey}/season.png`;
        await putAsset(bucket, key, png, "image/png");
        brief.chart.url = `${SITE}/assets/mail/${KIND}/${periodKey}/season.png`;
        brief.chart.key = key;
      } else brief.chart = null;
    } catch (err) {
      console.error("card_of_week_chart_failed", err?.message);
      brief.chart = null;
    }
    if (dryRun) return { dry_run: true, periodKey, brief };
    const out = await generateIssue({
      db,
      bucket,
      kind: KIND,
      periodKey,
      brief,
    });
    return {
      ...out,
      card: brief.card.name,
      reason: selection.reason,
      candidates: selection.candidates.map((c) => c.name),
    };
  } finally {
    if (own) await db.end();
  }
}

export async function cardOfWeekAccept({
  databaseUrl,
  db = null,
  bucket,
  key,
  enqueue = null,
}) {
  const own = !db;
  if (own) {
    db = new pg.Client({ connectionString: databaseUrl });
    await db.connect();
  }
  try {
    return await acceptIssue({
      db,
      bucket,
      key,
      kind: KIND,
      names: briefNames,
      factsOf: cardOfWeekFacts,
      enqueue,
    });
  } finally {
    if (own) await db.end();
  }
}
