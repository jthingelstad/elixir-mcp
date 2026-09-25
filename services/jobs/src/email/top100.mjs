/** The Top 100 issue: the brief builder, the lint, and the hand-off to
 *  the editor Lambda (docs/EMAIL.md; first specified in docs/archive/TOP100-README.md: the builder computes, the
 *  model writes).
 *
 *  top100Generate reads the recorded global Path of Legends board now
 *  and a week ago through the rankings readers, computes every delta,
 *  cluster and threshold the writer may print (deltas are precomputed:
 *  the model never subtracts), decides drought mode and the deep cut,
 *  writes the brief to the archive bucket and queues it for the editor
 *  Lambda, which has the internet the VPC does not. top100Accept takes
 *  the editor's answer back, lints it (every number traces to the
 *  brief, no tags, no exclamation marks, tables pair rank and rating,
 *  under the length ceiling) and stores the issue for Thursday's send;
 *  a failing issue never sends and the owner hears why. */
import pg from "pg";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { makeOutbox } from "../../../web-api/src/outbox.mjs";
import { loadRecipients, accountCtx, callTool } from "./ctx.mjs";
import { tryTool } from "./shared.mjs";
import { upsertIssue } from "./ledger.mjs";
import { lintIssue, repairNames } from "@elixir-mcp/mail";

const MASTHEAD = "Ultimate Champions";
const STRAP = "Elixir's weekly read of the Path of Legends top 100";
const SITE = "https://elixir.poapkings.com";
const DAY_MS = 86_400_000;

const s3 = new S3Client({});
const outbox = makeOutbox(process.env.OUTBOX_BUCKET, s3);

async function readBoard(ctx, asOf = null) {
  const pages = [];
  for (let offset = 0; offset < 1000; offset += 500) {
    const page = await callTool(ctx, "rankings_players", {
      board: "pol",
      location: "global",
      limit: 500,
      offset,
      ...(asOf ? { as_of: asOf } : {}),
    });
    pages.push(...(page.players ?? []));
    if (!page.players?.length || page.players.length < 500) {
      pages.snapshot = page.snapshot;
      break;
    }
    pages.snapshot = page.snapshot;
  }
  return { players: pages, snapshot: pages.snapshot };
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

async function buildBrief({ db, account, now = new Date() }) {
  const ctx = accountCtx(db, account);
  const clock = await callTool(ctx, "game_clock", { at: now.toISOString() });
  const nowBoard = await readBoard(ctx);
  const dataAsOf = nowBoard.snapshot?.observed_at ?? now.toISOString();
  const weekAgo = new Date(Date.parse(dataAsOf) - 7 * DAY_MS).toISOString();
  const prevBoard = await readBoard(ctx, weekAgo);
  const prevSnap = prevBoard.snapshot?.observed_at ?? weekAgo;
  const cur = nowBoard.players;
  const prev = prevBoard.players;
  const prevBy = new Map(prev.map((p) => [p.player_tag, p]));
  const curBy = new Map(cur.map((p) => [p.player_tag, p]));
  const top100 = cur.filter((p) => p.rank <= 100);
  const row = (p) => ({
    rank: p.rank,
    name: p.name,
    tag: p.player_tag,
    rating: p.rating,
    clan_name: p.clan_name ?? null,
    clan_tag: p.clan_tag ?? null,
  });
  const mover = (p, q) => ({
    name: p.name,
    tag: p.player_tag,
    rank_from: q.rank,
    rank_to: p.rank,
    rating_from: q.rating,
    rating_to: p.rating,
    rank_delta: q.rank - p.rank,
    rating_delta: p.rating - q.rating,
    places: Math.abs(q.rank - p.rank),
  });
  const both = top100
    .filter((p) => prevBy.has(p.player_tag))
    .map((p) => mover(p, prevBy.get(p.player_tag)));
  const up = both
    .filter((m) => m.rank_delta > 0)
    .sort((a, b) => b.rank_delta - a.rank_delta)
    .slice(0, 5);
  const down = both
    .filter((m) => m.rank_delta < 0)
    .sort((a, b) => a.rank_delta - b.rank_delta)
    .slice(0, 5);
  const entered = top100
    .filter((p) => !prevBy.has(p.player_tag))
    .slice(0, 5)
    .map((p) => ({
      name: p.name,
      tag: p.player_tag,
      rank_to: p.rank,
      rating_to: p.rating,
      prior_field_size: prev.length,
    }));
  const exited = prev
    .filter(
      (q) =>
        q.rank <= 100 &&
        (!curBy.has(q.player_tag) || curBy.get(q.player_tag).rank > 100),
    )
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5)
    .map((q) => ({
      name: q.name,
      tag: q.player_tag,
      rank_from: q.rank,
      rating_from: q.rating,
      rank_now: curBy.get(q.player_tag)?.rank ?? null,
      rating_now: curBy.get(q.player_tag)?.rating ?? null,
    }));
  const gains = both.map((m) => m.rating_delta);
  const clans = [
    ...top100
      .reduce((m, p) => {
        if (!p.clan_tag) return m;
        const c = m.get(p.clan_tag) ?? {
          clan_name: p.clan_name,
          clan_tag: p.clan_tag,
          members_in_top100: 0,
          best_rank: p.rank,
          ranks: [],
        };
        c.members_in_top100 += 1;
        c.best_rank = Math.min(c.best_rank, p.rank);
        c.ranks.push(p.rank);
        return m.set(p.clan_tag, c);
      }, new Map())
      .values(),
  ]
    .filter((c) => c.members_in_top100 >= 2)
    .sort(
      (a, b) =>
        b.members_in_top100 - a.members_in_top100 || a.best_rank - b.best_rank,
    )
    .slice(0, 6);

  // Podium and the spike deep cut from each contender's own week on the board.
  const podium = [];
  for (const p of top100.slice(0, 3)) {
    const q = prevBy.get(p.player_tag);
    const tl = await tryTool(callTool, ctx, "rankings_timeline", {
      player_tag: p.player_tag,
      from: prevSnap,
      to: dataAsOf,
      limit: 200,
    });
    const pts = tl?.points ?? tl?.snapshots ?? [];
    podium.push({
      name: p.name,
      tag: p.player_tag,
      rating: p.rating,
      rank: p.rank,
      clan_name: p.clan_name ?? null,
      rank_from: q?.rank ?? null,
      rating_from: q?.rating ?? null,
      rank_delta: q ? q.rank - p.rank : null,
      rating_delta: q ? p.rating - q.rating : null,
      days_in_top3:
        pts.filter((x) => x.rank != null && x.rank <= 3).length || null,
    });
  }
  let deep = { type: "none", facts: null, novelty_score: 0 };
  for (const p of cur.filter((x) => x.rank <= 200)) {
    const tl = await tryTool(callTool, ctx, "rankings_timeline", {
      player_tag: p.player_tag,
      from: prevSnap,
      to: dataAsOf,
      limit: 200,
    });
    const pts = (tl?.points ?? tl?.snapshots ?? []).filter(
      (x) => x.rank != null,
    );
    if (pts.length < 3) continue;
    const peak = pts.reduce((a, b) => (b.rank < a.rank ? b : a));
    const q = prevBy.get(p.player_tag);
    const placesBack = p.rank - peak.rank;
    if (peak.rank > 10 || placesBack < 20) continue;
    const score = Math.min(1, placesBack / 100 + (10 - peak.rank) / 20);
    if (score <= deep.novelty_score) continue;
    const before = pts.filter(
      (x) =>
        Date.parse(x.observed_at ?? x.at) <=
        Date.parse(peak.observed_at ?? peak.at),
    );
    deep = {
      type: "spike_hidden_by_weekly",
      novelty_score: Number(score.toFixed(2)),
      facts: {
        player: p.name,
        tag: p.player_tag,
        rank_from: q?.rank ?? null,
        rank_to: p.rank,
        rating_from: q?.rating ?? null,
        rating_to: p.rating,
        rank_delta: q ? q.rank - p.rank : null,
        rating_delta: q ? p.rating - q.rating : null,
        peak_rank: peak.rank,
        peak_rating: peak.rating,
        peak_date: String(peak.observed_at ?? peak.at).slice(0, 10),
        rating_gained_before_peak: before.length
          ? peak.rating - before[0].rating
          : null,
        days_to_peak: before.length
          ? Math.round(
              (Date.parse(peak.observed_at ?? peak.at) -
                Date.parse(before[0].observed_at ?? before[0].at)) /
                DAY_MS,
            )
          : null,
        rating_lost_after_peak: peak.rating - p.rating,
        places_lost_after_peak: placesBack,
      },
    };
  }
  // The meta over the top-100 collection, when the segment resolves.
  const seg = { collection: "pol-global-top-100" };
  const decks = await tryTool(callTool, ctx, "battles_meta_decks", {
    segment: seg,
    from: prevSnap,
    to: dataAsOf,
    mode: "ranked",
    limit: 8,
  });
  const cards = await tryTool(callTool, ctx, "battles_meta_cards", {
    segment: seg,
    from: prevSnap,
    to: dataAsOf,
    mode: "ranked",
    limit: 12,
  });
  const meta = {
    decks: (decks?.decks ?? []).slice(0, 8).map((d) => ({
      cards: (d.cards ?? []).map((c) => (typeof c === "string" ? c : c.name)),
      players: d.players ?? d.distinct_players ?? null,
      battles: d.battles ?? null,
      win_rate: d.win_rate ?? null,
    })),
    cards: (cards?.cards ?? []).slice(0, 12).map((c) => ({
      name: c.name,
      usage_share: c.usage_share ?? c.share ?? null,
      players: c.players ?? null,
      form: c.form ?? null,
    })),
    players_covered: decks?.population?.players ?? decks?.players ?? null,
    players_total: 100,
    available: Boolean(decks?.decks?.length),
  };
  const seasonStart = Date.parse(clock.season_started_at);
  const dayOfSeason = Math.max(
    1,
    Math.floor((Date.parse(dataAsOf) - seasonStart) / DAY_MS) + 1,
  );
  const sections = {
    podium:
      (podium[0] && prevBy.get(podium[0].tag)?.rank !== 1) ||
      podium.some((p) => p.rank_delta != null && Math.abs(p.rank_delta) >= 20),
    climbers: up[0]?.rank_delta >= 50,
    drops:
      (down[0] && -down[0].rank_delta >= 40) ||
      exited.some((e) => e.rank_from <= 20),
    meta: meta.available,
    deep_cut: deep.type !== "none",
  };
  const cleared = Object.entries(sections)
    .filter(([, v]) => v)
    .map(([k]) => k);
  return {
    generated_at: now.toISOString(),
    data_as_of: dataAsOf,
    masthead: MASTHEAD,
    strap: STRAP,
    season: {
      id: clock.season_id,
      month: clock.season_month,
      day_of_season: dayOfSeason,
    },
    window: {
      from: prevSnap,
      to: dataAsOf,
      label: rangeLabel(prevSnap, dataAsOf),
      issue_date: dataAsOf.slice(0, 10),
    },
    board: {
      top100: top100.map(row),
      cutoff_rating: top100.at(-1)?.rating ?? null,
      field_size: cur.length,
      prev_field_size: prev.length,
      prev_leader_rating: prev[0]?.rating ?? null,
      leader_rating: cur[0]?.rating ?? null,
      inflation: prev[0] && cur[0] ? cur[0].rating - prev[0].rating : null,
      median_rating_gain: median(gains),
      players_gained: gains.filter((g) => g > 0).length,
      players_compared: gains.length,
      spread_top3:
        top100[0] && top100[2] ? top100[0].rating - top100[2].rating : null,
      spread_top10:
        top100[0] && top100[9] ? top100[0].rating - top100[9].rating : null,
      all_drops_gained_rating:
        down.length > 0 && down.every((m) => m.rating_delta > 0),
    },
    movers: { up, down, entered, exited },
    podium,
    clans,
    meta,
    deep_cut: deep,
    sections_cleared: cleared,
    drought_mode: cleared.length < 3,
    coverage: {
      freshness_seconds: Math.max(
        0,
        Math.round((now.getTime() - Date.parse(dataAsOf)) / 1000),
      ),
      gaps: [
        ...(meta.available
          ? []
          : [
              "deck and battle data for the top 100 was not available for this issue",
            ]),
      ],
    },
  };
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
function rangeLabel(fromIso, toIso) {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  return `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()} – ${a.getUTCMonth() === b.getUTCMonth() ? "" : `${MONTHS[b.getUTCMonth()]} `}${b.getUTCDate()}`;
}

export async function top100Generate({
  databaseUrl,
  bucket,
  now = new Date(),
}) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const [account] = await loadRecipients(db, "top_100");
    if (!account) return { skipped: "no recipient to read as" };
    const brief = await buildBrief({ db, account, now });
    const key = `mail/top100/${brief.window.issue_date}/brief.json`;
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(brief),
        ContentType: "application/json",
      }),
    );
    await upsertIssue(db, {
      kind: "top_100",
      periodKey: brief.window.issue_date,
      subjectKey: "",
      status: "composed",
      note: `brief ${key}`,
    });
    // The VPC reaches nothing but S3: the editor gets the brief through
    // the outbox, the way mail reaches the relay.
    if (outbox) await outbox("editor", { brief_key: key });
    return {
      brief_key: key,
      issue_date: brief.window.issue_date,
      sections_cleared: brief.sections_cleared,
      drought_mode: brief.drought_mode,
      deep_cut: brief.deep_cut.type,
    };
  } finally {
    await db.end();
  }
}

function briefNames(brief) {
  const names = new Set();
  for (const p of brief.board?.top100 ?? []) names.add(p.name);
  for (const list of [
    brief.movers?.up,
    brief.movers?.down,
    brief.movers?.entered,
    brief.movers?.exited,
    brief.podium,
  ])
    for (const p of list ?? []) names.add(p.name);
  for (const c of brief.clans ?? []) names.add(c.clan_name);
  if (brief.deep_cut?.facts?.player) names.add(brief.deep_cut.facts.player);
  return [...names].filter(Boolean);
}

async function readJson(bucket, key) {
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return JSON.parse(await out.Body.transformToString());
}

export async function top100Accept({
  databaseUrl,
  bucket,
  key,
  enqueue = null,
}) {
  const issueKey = key;
  const briefKey = key.replace(/issue\.json$/, "brief.json");
  const [issue, brief] = await Promise.all([
    readJson(bucket, issueKey),
    readJson(bucket, briefKey),
  ]);
  // Names the model spelled through a broken JSON escape come back
  // from the brief before anything else looks at the body.
  issue.body_markdown = repairNames(issue.body_markdown, briefNames(brief));
  const problems = lintIssue(issue, brief);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const date = brief.window.issue_date;
    if (problems.length) {
      await upsertIssue(db, {
        kind: "top_100",
        periodKey: date,
        subjectKey: "",
        status: "failed",
        note: problems.join("; "),
      });
      if (enqueue)
        await enqueue({
          v: 1,
          kind: "owner_notify",
          to: process.env.OWNER_NOTIFY_EMAIL || "elixir@poapkings.com",
          note: `Top 100 issue ${date} failed lint: ${problems.slice(0, 5).join("; ")}`,
          link: `${SITE}/admin`,
        });
      return { accepted: false, problems };
    }
    const names = new Map(brief.board.top100.map((p) => [p.name, p.tag]));
    for (const list of [
      brief.movers.up,
      brief.movers.down,
      brief.movers.entered,
      brief.movers.exited,
      brief.podium,
    ])
      for (const p of list ?? []) names.set(p.name, p.tag);
    if (brief.deep_cut?.facts?.player)
      names.set(brief.deep_cut.facts.player, brief.deep_cut.facts.tag);
    const index = [...names]
      .filter(([name]) => name && issue.body_markdown.includes(name))
      .map(([name, tag]) => ({ name, tag }));
    const facts = {
      masthead: MASTHEAD,
      strap: STRAP,
      subject: issue.subject,
      preheader: issue.preheader ?? "",
      issue: {
        date,
        label: brief.window.label,
        season: brief.season.id,
        day_of_season: brief.season.day_of_season,
        data_as_of: brief.data_as_of,
      },
      body_markdown: issue.body_markdown,
      players_index: index,
      cta: {
        head: "Start your record",
        text: "Everything above exists because Elixir was recording. Your history starts the day you track your tag, not the day you first ask a question. Elixir is a hand-approved beta; ask for a place.",
        button: "Request access",
        url: `${SITE}/`,
      },
      coverage: `Data from the Path of Legends board recorded at the 10:00 UTC reset, ${date}.${brief.coverage?.gaps?.length ? ` ${brief.coverage.gaps.join("; ")}.` : ""}`,
      numbers_used: issue.numbers_used ?? [],
      alternates: issue.subjects ?? [],
    };
    await upsertIssue(db, {
      kind: "top_100",
      periodKey: date,
      subjectKey: "",
      facts,
      subjectLine: issue.subject,
      status: "composed",
      note: `issue ${issueKey}`,
    });
    return { accepted: true, date, subject: issue.subject };
  } finally {
    await db.end();
  }
}
