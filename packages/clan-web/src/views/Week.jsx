import { MemberLink } from "../components/MemberLink.jsx";
import { Fresh } from "@elixir-mcp/ui";
import { CATEGORY_LABELS } from "@elixir-mcp/clan-engine";
import { useWeek } from "../lib/queries.js";
import { CLAN, clanPath } from "../lib/base.js";
import { PageHead, Tile, Tiles } from "../components/PageHead.jsx";

const ROLE = {
  member: "Member",
  elder: "Elder",
  coLeader: "Co-leader",
  leader: "Leader",
};
const n = (x) => (x === null || x === undefined ? "—" : x.toLocaleString());
const date = (ts) =>
  ts
    ? new Date(ts).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "";
const plural = (k, one, many = `${one}s`) => `${n(k)} ${k === 1 ? one : many}`;
const DAY_MS = 86_400_000;
const after = (a, b) => Date.parse(a ?? "") > Date.parse(b ?? "");

/** When the first whole week Elixir records for a clan closes: the
 *  Monday reset ending the first week (Monday 00:00 UTC to Monday) that
 *  began after it started following the clan. The week's own shape is
 *  the engine's (week.mjs); this only names its date. */
function firstFullWeekCloses(recordedFrom) {
  const t = Date.parse(recordedFrom ?? "");
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const midnight = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
  );
  let monday = midnight + ((8 - d.getUTCDay()) % 7) * DAY_MS;
  if (monday < t) monday += 7 * DAY_MS;
  return new Date(monday + 7 * DAY_MS).toISOString();
}
const list = (items) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** An area's headline: what the clan did together. */
function summary(a) {
  const took = a.participants.length;
  if (a.key === "war") {
    const parts = [plural(a.total, "deck"), "played"];
    if (a.points !== null && a.points !== undefined)
      parts.push(`· ${n(a.points)} points`);
    return parts.join(" ");
  }
  if (a.key === "donations")
    return `${plural(a.total, "card")} donated by ${plural(took, "member")}`;
  if (a.key === "ranked")
    return `${plural(a.total, "ranked battle")} by ${plural(took, "member")}`;
  return `${plural(a.total, "battle")} by ${plural(took, "member")}`;
}

function warLine(w) {
  const lines = [];
  if (w.is_colosseum) lines.push("Colosseum week: all four war days count.");
  else if (w.finished_early && w.finish_war_day)
    lines.push(
      `The boat crossed the finish line on war day ${w.finish_war_day}.`,
    );
  if (w.decks_asked)
    lines.push(
      `${plural(w.all_decks, "member")} played every deck asked (${w.decks_asked} each).`,
    );
  return lines.join(" ");
}

const TONE = { ok: "text-ok", warn: "text-warn", dim: "text-ink-dim" };

/** The race a war week was, as the game numbers it: "race 136/2". */
const raceName = (w) =>
  w && w.season_id !== null && w.section_index !== null
    ? `race ${w.season_id}/${w.section_index}`
    : null;

/** One group of the people who took part, each with what they did. */
function Group({ label, tone, people, asked, name, clan, navigate }) {
  if (!people.length) return null;
  return (
    <div className="panel__body grid gap-2 border-b border-line-row last:border-b-0">
      <span className={`text-[12px] font-semibold ${TONE[tone]}`}>{label}</span>
      <ul className="m-0 p-0 list-none flex flex-wrap gap-2" aria-label={name}>
        {people.map((p) => (
          <li
            key={p.player_tag}
            className="inline-flex items-center gap-2 min-h-7 px-2.5 rounded-chip bg-panel-raised text-[13px]"
            title={p.joined_during ? "Joined this week" : undefined}
          >
            <MemberLink
              clanTag={clan.clan_tag}
              playerTag={p.player_tag}
              navigate={navigate}
            >
              {p.name ?? p.player_tag}
            </MemberLink>
            <span className={`font-mono text-[12px] ${TONE[tone]}`}>
              {asked ? `${n(p.value)}/${asked}` : n(p.value)}
            </span>
            {p.joined_during ? (
              <span className="text-[12px] text-ink-faint">new</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** An area of the week: what the clan did together, then everyone who
 *  took part. War splits into every deck asked and partway. */
function Area({ a, clan, navigate }) {
  const asked = a.war?.decks_asked ?? null;
  const race = raceName(a.war);
  const note = a.war ? warLine(a.war) : "";
  return (
    <section className="panel" aria-labelledby={`week-${a.key}`}>
      <div className="panel__head">
        <h2 id={`week-${a.key}`} className="m-0 grow text-[14px] font-semibold">
          {a.label}
          {race ? ` · ${race}` : ""}
        </h2>
        <span className="page-head__note font-normal">{summary(a)}</span>
      </div>
      {note ? (
        <div className="panel__body pb-0 page-head__note">{note}</div>
      ) : null}
      {!a.participants.length ? (
        <div className="panel__body page-head__note">Nobody this week.</div>
      ) : asked ? (
        <>
          <Group
            clan={clan}
            navigate={navigate}
            label="Every deck asked"
            tone="ok"
            people={a.participants.filter((p) => p.all_decks)}
            asked={asked}
            name={`${a.label}: played every deck asked`}
          />
          <Group
            clan={clan}
            navigate={navigate}
            label="Partway"
            tone="warn"
            people={a.participants.filter((p) => !p.all_decks)}
            asked={asked}
            name={`${a.label}: partway`}
          />
        </>
      ) : (
        <Group
          clan={clan}
          navigate={navigate}
          label="Took part"
          tone="dim"
          people={a.participants}
          name={`${a.label}: who took part`}
        />
      )}
    </section>
  );
}

/** The tiles: counts the week returned, never a score. War, where the
 *  record knows the decks asked, reads as the canvas draws it. */
function tiles(d, highlighted) {
  const out = [];
  for (const a of highlighted) {
    const took = a.participants.length;
    const asked = a.war?.decks_asked;
    if (a.key === "war" && asked) {
      const race = raceName(a.war);
      out.push(
        <Tile
          key="war-took"
          label="Took part"
          value={n(took)}
          of={`of ${n(d.members)}`}
          hint={race ? `members who played a war deck in ${race}` : undefined}
        />,
        <Tile
          key="war-partway"
          label="Partway"
          value={n(took - a.war.all_decks)}
          tone="warn"
          hint={`fewer than the ${asked} decks asked`}
        />,
        <Tile
          key="war-all"
          label="Every deck asked"
          value={n(a.war.all_decks)}
          tone="ok"
          hint={`${asked} decks each`}
        />,
      );
    } else
      out.push(
        <Tile
          key={a.key}
          label={a.label}
          value={n(a.total)}
          hint={`by ${plural(took, "member")}`}
        />,
      );
  }
  return out;
}

/** Why these areas are highlighted, in the clan's own terms. */
function basisLine(d) {
  const h = d.highlight;
  if (h.basis === "policy")
    return `Highlighted: what this clan counts (${list(
      h.counted.map((k) =>
        k === "battles"
          ? "Trophy road, shown as battles played"
          : (CATEGORY_LABELS[k] ?? k),
      ),
    )}).`;
  if (d.policy.active)
    return "This clan's policy counts no category, so the week highlights where the clan was busiest.";
  if (d.policy.set)
    return "Clan management is paused below 10 members, so the week highlights where the clan was busiest.";
  return "This clan's leaders have not set up how it runs yet, so the week highlights where the clan was busiest.";
}

/** Who came and went, one line a kind: the roster's own events inside
 *  the week. A departure is "Departed", never a kick or a leave. */
function Membership({ m }) {
  const rows = [
    ["Joined", m.joined.map((x) => x.name ?? x.player_tag)],
    ["Departed", m.departed.map((x) => x.name ?? x.player_tag)],
    [
      "Promoted",
      m.promoted.map(
        (x) =>
          `${x.name ?? x.player_tag} to ${ROLE[x.role_after] ?? x.role_after}`,
      ),
    ],
    [
      "Demoted",
      m.demoted.map(
        (x) =>
          `${x.name ?? x.player_tag} to ${ROLE[x.role_after] ?? x.role_after}`,
      ),
    ],
  ].filter(([, names]) => names.length);
  return (
    <section className="panel" aria-labelledby="week-membership">
      <div className="panel__head">
        <h2 id="week-membership" className="m-0 grow text-[14px] font-semibold">
          Who came and went
        </h2>
      </div>
      <div className="px-4 py-1">
        {rows.map(([label, names]) => (
          <div
            key={label}
            className="grid gap-1 py-2.5 border-b border-line-row last:border-b-0"
          >
            <span className="label">{label}</span>
            <span className="text-[13.5px] text-ink-body">{list(names)}</span>
          </div>
        ))}
        {rows.length === 0 && m.complete ? (
          <p className="page-head__note my-2.5">
            Nobody joined, departed or changed role.
          </p>
        ) : null}
      </div>
      {!m.complete ? (
        <div className="panel__foot">
          Elixir&rsquo;s recent roster events
          {m.events_from
            ? ` reach back to ${date(m.events_from)}`
            : " do not cover this week"}
          ; earlier changes are not shown.
        </div>
      ) : null}
    </section>
  );
}

/** The week still running: each area's total and how many took part.
 *  Named the way the closed week above it is (the week of, and the
 *  Monday reset that closes it), so the two never read as one week. */
function SoFar({ s, recordedFrom }) {
  return (
    <section className="panel" aria-labelledby="week-so-far">
      <div className="panel__head">
        <h2 id="week-so-far" className="m-0 grow text-[14px] font-semibold">
          This week so far
        </h2>
        <span className="page-head__note font-normal">
          the week of {date(s.from)}
          {s.to ? `, closes ${date(s.to)}` : ""}
        </span>
      </div>
      {after(recordedFrom, s.from) ? (
        <div className="panel__body pb-0 page-head__note">
          Counted from {date(recordedFrom)}, when Elixir started following this
          clan.
        </div>
      ) : null}
      <div className="panel__body fields">
        {s.areas.map((a) => (
          <span key={a.key} className="contents">
            <span className="label">{a.label}</span>
            <span>
              {n(a.total)} ({plural(a.took_part, "member")})
            </span>
          </span>
        ))}
      </div>
    </section>
  );
}

/** The left column when the week highlights nothing: why, never a
 *  blank. A week before Elixir followed the clan has no record, and the
 *  first whole week it will have is named; otherwise nothing the clan
 *  counts (or nothing at all) was recorded. */
function Unrecorded({ d }) {
  const before = after(d.recorded_from, d.week.from);
  const closes = before ? firstFullWeekCloses(d.recorded_from) : null;
  return (
    <section className="panel" aria-labelledby="week-unrecorded">
      <div className="panel__head">
        <h2 id="week-unrecorded" className="m-0 grow text-[14px] font-semibold">
          {before ? "Before Elixir followed this clan" : "Nothing recorded"}
        </h2>
      </div>
      <p className="panel__body page-head__note m-0">
        {before
          ? `Elixir started following this clan on ${date(d.recorded_from)}, after this week began, so it holds no record of the week.${closes ? ` The first full week it records closes at the Monday reset on ${date(closes)}.` : ""}`
          : d.highlight.basis === "policy"
            ? "Nothing the clan counts was recorded this week."
            : "No member took part in anything Elixir recorded this week."}
      </p>
    </section>
  );
}

/**
 * The week in the clan (2026-09-27; the October 2026 canvas): the latest
 * closed week, or an earlier one, for every member. What the clan did
 * together as tiles, everyone who took part by name, who came and went,
 * and the week so far. Highlighted by what the clan's policy counts, or
 * where the clan was busiest. No actions and no standings.
 */
export function Week({ clan, week, navigate }) {
  const { state } = useWeek(clan.clan_tag, week);
  const d = state.data;
  const base = `${clanPath(clan.clan_tag)}/week`;
  const go = (path) => (e) => {
    e.preventDefault();
    navigate?.(path);
  };
  const head = (lede, children) => (
    <PageHead
      clan={clan}
      name={d?.clan_name}
      crumb="The week"
      title="The week"
      lede={lede}
      navigate={navigate}
      fresh={
        d?.as_of ? (
          <Fresh label="as of" seconds={d.freshness_seconds} ts={d.as_of} />
        ) : null
      }
    >
      {children}
    </PageHead>
  );
  if (state.signedOut) {
    window.location.assign(`${CLAN}?error=session_expired`);
    return null;
  }
  if (state.forbidden)
    return (
      <>
        {head()}
        <div className="callout callout--warn" role="alert">
          <span>Your current clan access does not allow this week.</span>
        </div>
      </>
    );
  if (state.error)
    return (
      <>
        {head()}
        <div className="callout callout--warn" role="alert">
          <span>
            {state.error === "clan_not_recorded"
              ? "Elixir is not recording this clan yet."
              : state.error === "no_week"
                ? "That week is not in the record, or has not closed yet."
                : "Elixir did not answer. Try again in a minute."}
          </span>
          {state.error === "no_week" ? (
            <a href={base} onClick={go(base)}>
              The latest week
            </a>
          ) : null}
        </div>
      </>
    );
  if (!d) return head("Reading the week…");
  const at = d.weeks.findIndex((w) => w.iso_week === d.week?.iso_week);
  const earlier = at >= 0 ? d.weeks[at + 1] : null;
  const later = at > 0 ? d.weeks[at - 1] : null;
  const weekPath = (w) => `${base}/${String(w.iso_week).toLowerCase()}`;
  const highlighted = d.week ? d.areas.filter((a) => a.highlighted) : [];
  const rest = d.week ? d.areas.filter((a) => !a.highlighted) : [];
  const soFar =
    d.so_far && at <= 0 ? (
      <SoFar s={d.so_far} recordedFrom={d.recorded_from} />
    ) : null;
  if (!d.week)
    return (
      <>
        {head(
          "No week has closed in the record yet. The first one closes at the Monday reset.",
        )}
        {soFar}
      </>
    );
  const shown = tiles(d, highlighted);
  return (
    <>
      {head(
        `The week of ${date(d.week.from)}${at <= 0 ? ", the latest to close" : ""}: it closed at the Monday reset on ${date(d.week.closed_at ?? d.week.to)}. ${basisLine(d)}`,
        earlier || later ? (
          <nav className="flex flex-wrap gap-4 text-[13px]" aria-label="Weeks">
            {earlier ? (
              <a href={weekPath(earlier)} onClick={go(weekPath(earlier))}>
                ← Week of {date(earlier.from)}
              </a>
            ) : null}
            {later ? (
              <a href={weekPath(later)} onClick={go(weekPath(later))}>
                Week of {date(later.from)} →
              </a>
            ) : null}
          </nav>
        ) : null,
      )}

      {shown.length ? <Tiles label="The week in numbers">{shown}</Tiles> : null}

      <div className="grid gap-4 items-start wide:grid-cols-5">
        <div className="grid gap-4 min-w-0 wide:col-span-3">
          {highlighted.map((a) => (
            <Area key={a.key} a={a} clan={clan} navigate={navigate} />
          ))}
          {highlighted.length === 0 ? <Unrecorded d={d} /> : null}
          {rest.length ? (
            <details>
              <summary className="label cursor-pointer mb-3">
                Also this week
              </summary>
              <div className="grid gap-4">
                {rest.map((a) => (
                  <Area key={a.key} a={a} clan={clan} navigate={navigate} />
                ))}
              </div>
            </details>
          ) : null}
        </div>
        <div className="grid gap-4 min-w-0 wide:col-span-2">
          <Membership m={d.membership} />
          {soFar}
        </div>
      </div>

      <p className="page-head__note mt-[22px]">
        Numbers are for today&rsquo;s members: someone who has departed is not
        counted. Only those who took part are named.
      </p>
    </>
  );
}
