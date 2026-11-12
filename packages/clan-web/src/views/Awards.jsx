import {
  Disclosure,
  ago,
  Tag,
  TagText,
  useClock,
  Panel,
  Table,
  Empty,
} from "@elixir-mcp/ui";
import { useRef, useState } from "react";
import { manageApi } from "../api.js";
import { useAwards } from "../lib/queries.js";
import { MemberLink } from "../components/MemberLink.jsx";
import { TooFew } from "../components/TooFew.jsx";
import { ReportThis } from "../components/ReportThis.jsx";
import { PageHead } from "../components/PageHead.jsx";
import { trackEvent } from "../analytics.js";
import { CLAN, clanPath } from "../lib/base.js";
import { ordinal } from "../lib/words.js";

/**
 * Clan ▸ Awards: the open season's races (provisional, tie-aware), each
 * closed season's grants, a leaders' pick granted by hand with the
 * podium in view, and the clan's awards document: every award with its
 * kind, name, parameters and help text, versioned like policy. Members read;
 * elders grant what elders may; leaders edit.
 */
export function Awards({ clan, who, season: seasonParam, navigate }) {
  const { whenDay } = useClock();
  const base = clanPath(clan.clan_tag);
  const { state, load, query } = useAwards(clan.clan_tag);
  if (state.signedOut) {
    window.location.assign(`${CLAN}?error=session_expired`);
    return null;
  }
  if (state.forbidden)
    return (
      <div className="callout callout--warn" role="alert">
        <span>Awards are unavailable for your current clan access.</span>
      </div>
    );
  if (state.error === "too_few_members") {
    const d = query.data?.data ?? {};
    return <TooFew members={d.members} min={d.min_members} />;
  }
  if (state.error === "no_policy")
    return (
      <Empty title="No policy yet">
        Awards start with the clan&rsquo;s policy. Standing, Actions and Awards
        wait until a leader or co-leader sets it.
      </Empty>
    );
  if (state.error)
    return state.error === "clan_not_recorded" ? (
      <Empty title="Elixir is not recording this clan yet">
        There is nothing to award.
      </Empty>
    ) : (
      <Empty
        title="Elixir did not answer"
        action={
          <button type="button" className="btn" onClick={() => load()}>
            Try again
          </button>
        }
      >
        Try again in a minute.
      </Empty>
    );
  if (!state.data) return <p className="page__lede">Reading the awards…</p>;
  const d = state.data;
  const seasonIds = [
    ...new Set([
      ...d.seasons.map((s) => s.season_id),
      ...d.grants.map((g) => g.season_id),
    ]),
  ].sort((a, b) => b - a);
  const asked = Number(seasonParam);
  const selected = seasonIds.includes(asked)
    ? asked
    : (d.seasons[0]?.season_id ?? seasonIds[0]);
  const season = d.seasons.find((s) => s.season_id === selected);
  const awardById = new Map(d.config.awards.map((a) => [a.id, a]));
  const setup = `${base}/run/awards-setup`;
  const yours = d.grants.filter((g) => g.player_tag === who?.player_tag);
  if (!seasonIds.length && d.config_version === 0)
    return (
      <>
        <PageHead title="Awards" />
        <Empty
          title="This clan runs no awards yet"
          action={
            d.can_edit ? (
              <a
                className="btn btn--primary"
                href={setup}
                onClick={(e) => {
                  e.preventDefault();
                  navigate?.(setup);
                }}
              >
                Add awards, in Run
              </a>
            ) : null
          }
        >
          A leader adds the ones it runs.
        </Empty>
      </>
    );
  return (
    <div className="grid gap-5">
      <PageHead title="Awards" />
      <div className="clan-subnav">
        <label className="flex items-center gap-3">
          <span className="field-label">Season</span>
          <select
            className="input w-auto"
            value={selected ?? ""}
            onChange={(e) => navigate?.(`${base}/standings/${e.target.value}`)}
          >
            {seasonIds.map((id) => {
              const known = d.seasons.find((s) => s.season_id === id);
              return (
                <option key={id} value={id}>
                  Season {id}
                  {!known
                    ? ", grants only"
                    : known.closed === false
                      ? ", in progress"
                      : ", closed"}
                </option>
              );
            })}
          </select>
        </label>
        <p className="page-head__note m-0">
          Awards v{d.config_version} · read {ago(d.evaluated_at)}{" "}
          <button
            type="button"
            className="btn--text"
            onClick={() => load(true)}
            disabled={state.loading}
          >
            {state.loading ? "Reading…" : "Read again"}
          </button>
          {d.can_edit ? (
            <>
              {" · "}
              <a
                href={setup}
                onClick={(e) => {
                  e.preventDefault();
                  navigate?.(setup);
                }}
              >
                Awards setup, in Run
              </a>
            </>
          ) : null}
        </p>
      </div>
      {d.can_send &&
      d.seasons[0]?.closed === false &&
      d.seasons[0].awards.some(
        (a) => a.state !== "off" && a.state !== "manual",
      ) ? (
        <CurrentUpdate
          clan={clan}
          navigate={navigate}
          seasonId={d.seasons[0].season_id}
          viewingSeason={selected}
        />
      ) : null}
      {yours.length ? (
        <p className="m-0">
          <span className="label mr-2">Yours</span>
          {yours
            .map(
              (g) =>
                `${awardById.get(g.award_id)?.name ?? g.award_id}${g.rank ? `, ${ordinal(g.rank)}` : ""}, Season ${g.season_id}`,
            )
            .join("; ")}
          .
        </p>
      ) : null}
      {season ? (
        <section key={selected} className="grid gap-3">
          <div className="label">
            Season {season.season_id},{" "}
            {season.closed
              ? `closed ${whenDay(season.closed_at)}`
              : "in progress"}
            , {season.weeks} war week{season.weeks === 1 ? "" : "s"}
          </div>
          {!season.closed ? (
            <p className="page__lede m-0">
              Provisional: the season is still being fought. Its races are
              decided when it closes
              {season.picks_open &&
              season.awards.some((a) => a.state === "manual")
                ? "; a leaders' pick can be granted now"
                : ""}
              .
            </p>
          ) : null}
          {season.awards.map((a) => (
            <AwardPanel
              key={`${selected}-${a.award_id}`}
              award={a}
              season={season}
              grants={d.grants.filter(
                (g) => g.season_id === selected && g.award_id === a.award_id,
              )}
              canGrant={
                season.picks_open === true && d.can_grant.includes(a.award_id)
              }
              canRevoke={d.can_edit}
              clan={clan}
              candidates={d.members}
              navigate={navigate}
              previousGrants={d.grants.filter(
                (g) =>
                  g.award_id === a.award_id && g.season_id === selected - 1,
              )}
              onChange={() => load()}
            />
          ))}
        </section>
      ) : (
        <OlderGrants
          grants={d.grants.filter((g) => g.season_id === selected)}
          awardById={awardById}
        />
      )}
      <Disclosure title="How awards work here">
        <div className="panel__body grid gap-2">
          {d.config.awards.map((a) => (
            <div key={a.id}>
              <strong>{a.name}</strong>
              {a.enabled ? "" : <span className="chip"> off</span>}
              <div className="page-head__note">
                {a.description ? `${a.description} ` : ""}
                <em>{describeFrom(d, a)}</em>
              </div>
            </div>
          ))}
          <p className="page__lede m-0">
            Clan decides its awards after a season closes; a leaders&rsquo; pick
            can also be granted while the season is fought, and records who
            chose it and why. Members can read the races and saved grants here;
            nothing is published outside the signed-in app.
          </p>
        </div>
      </Disclosure>
      {/* An award race is Elixir's reading against the clan's awards config:
          the version rides along (2026-10-08). */}
      <div>
        <ReportThis
          about={`Awards in ${clan.name ?? clan.clan_tag}${d.config_version ? `, awards v${d.config_version}` : ""}. Name the award and what reads wrong.`}
          refs={[
            { kind: "clan", ref: clan.clan_tag },
            ...(d.config_version
              ? [{ kind: "award", ref: `config:v${d.config_version}` }]
              : []),
          ]}
          context={{ page: "awards" }}
        />
      </div>
    </div>
  );
}

function CurrentUpdate({ clan, navigate, seasonId, viewingSeason }) {
  const request = useRef(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  return (
    <div className="grid gap-2">
      <button
        className="btn"
        type="button"
        disabled={busy}
        onClick={async () => {
          if (busy) return;
          request.current ??= crypto.randomUUID();
          setBusy(true);
          setError("");
          try {
            const r = await manageApi.awardsUpdate(
              clan.clan_tag,
              request.current,
            );
            if (!r.ok) {
              if (r.data?.error === "no_awards") {
                request.current = null;
                setError("There are no current computed standings to share.");
              } else
                setError(
                  "The update was not confirmed. Retry to recover this same Action.",
                );
              return;
            }
            setResult(r.data);
            request.current = null;
          } catch {
            setError(
              "The update was not confirmed. Retry to recover this same Action.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Preparing update…" : `Send Season ${seasonId} update to clan`}
      </button>
      {viewingSeason !== seasonId ? (
        <p className="page-head__note m-0">
          This prepares the current Season {seasonId} update, while you are
          viewing Season {viewingSeason}.
        </p>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {result ? (
        <a
          href={`${clanPath(clan.clan_tag)}/actions/${result.action.number}`}
          onClick={(e) => {
            if (navigate) {
              e.preventDefault();
              navigate(e.currentTarget.getAttribute("href"));
            }
          }}
        >
          Review Action #{result.action.number} ·{" "}
          {result.action.evidence.messages.length} message
          {result.action.evidence.messages.length === 1 ? "" : "s"}
        </a>
      ) : null}
    </div>
  );
}

function describeFrom(d, a) {
  const live = d.seasons
    .flatMap((s) => s.awards)
    .find((x) => x.award_id === a.id);
  return live?.rule ?? "";
}

const UNIT = {
  points: "pts",
  donations: "cards",
  war_decks: "war decks",
  war_days: "war days",
};

function AwardPanel({
  award,
  season,
  grants = [],
  canGrant = false,
  canRevoke = false,
  clan,
  candidates = [],
  navigate,
  previousGrants = [],
  onChange,
}) {
  const { whenDay } = useClock();
  const [granting, setGranting] = useState(false);
  const [tag, setTag] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sourceRows =
    season.closed && award.state === "closed"
      ? grants.map((g) => ({ ...g, name: g.player_name }))
      : (award.rows ?? []);
  const rows =
    award.kind === "perfect_attendance"
      ? [...sourceRows].sort(
          (a, b) =>
            (Number.isFinite(b.donations) ? b.donations : -1) -
              (Number.isFinite(a.donations) ? a.donations : -1) ||
            a.player_tag.localeCompare(b.player_tag),
        )
      : sourceRows;
  const pointsKind = ["season_points_podium", "rookie_podium"].includes(
    award.kind,
  );
  const position = (row) => row.place ?? row.rank;
  const shared = new Map();
  for (const row of rows) {
    const place = position(row);
    if (place != null) shared.set(place, (shared.get(place) ?? 0) + 1);
  }
  const sharesPlace = (row) =>
    pointsKind
      ? (row.place_tied ?? shared.get(position(row)) > 1)
      : (row.tied ?? shared.get(position(row)) > 1);
  return (
    <Panel as="div">
      <div className="panel__head" style={{ gap: "8px", flexWrap: "wrap" }}>
        <span>
          {season.closed && grants.length ? grants[0].name : award.name}
        </span>
        <span className="chip">{STATE_LABEL[award.state] ?? award.state}</span>
        {award.kind === "perfect_attendance" && award.state !== "off" ? (
          <span className="page-head__note">
            pass/fail · displayed by donations
          </span>
        ) : null}
      </div>
      <div className="panel__body" style={{ display: "grid", gap: "8px" }}>
        {award.state === "held" ? (
          <p className="page__lede m-0">
            {award.note}
            {rows.length
              ? " Recorded totals below are provisional; no places or winners are decided."
              : ""}
          </p>
        ) : null}
        {award.state === "off" ||
        (award.state === "held" && !rows.length) ? null : award.state ===
          "manual" ? (
          <>
            {award.description ? (
              <p className="page__lede m-0">{award.description}</p>
            ) : null}
            {season.picks_open ? (
              <p className="page-head__note m-0">
                <TagText>
                  {previousGrants.length
                    ? `Season ${season.season_id - 1}: ${previousGrants.map((g) => g.player_name ?? g.player_tag).join(", ")}.`
                    : `No recorded ${award.name} grant for season ${season.season_id - 1}. Check the clan's history before choosing.`}
                </TagText>{" "}
                {season.closed
                  ? "Review the final podium and this award's rule; the choice is yours."
                  : "The season is in progress: a pick now is granted at once, for this season. Review the races so far and this award's rule; the choice is yours."}
              </p>
            ) : null}
            {season.closed &&
            season.awards.some((a) => a.computed && a.state === "held") ? (
              <p className="callout callout--warn" role="alert">
                Evidence is incomplete for{" "}
                {season.awards
                  .filter((a) => a.computed && a.state === "held")
                  .map((a) => a.name)
                  .join(", ")}
                . If this pick depends on those results, wait for the evidence
                before choosing.
              </p>
            ) : null}
            {rows.length === 0 ? (
              <p className="page__lede" style={{ margin: 0 }}>
                Not granted{season.closed || season.picks_open ? " yet" : ""}.
              </p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: "18px" }}>
                {rows.map((r) => (
                  <li key={r.player_tag}>
                    <strong>
                      <MemberLink
                        clanTag={clan.clan_tag}
                        playerTag={r.player_tag}
                        navigate={navigate}
                        current={candidates.some(
                          (member) => member.player_tag === r.player_tag,
                        )}
                      >
                        {r.name ?? <Tag tag={r.player_tag} />}
                      </MemberLink>
                    </strong>{" "}
                    <span className="tag">{r.player_tag}</span>
                    {r.note ? `: ${r.note}` : ""}{" "}
                    <span className="page-head__note">
                      · granted {whenDay(r.granted_at)} by{" "}
                      {r.granted_by_name ?? r.granted_by}
                    </span>
                    {canRevoke ? (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="btn--text"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            setError("");
                            try {
                              const result = await manageApi.revokeAward(
                                clan.clan_tag,
                                season.season_id,
                                award.award_id,
                                r.player_tag,
                              );
                              if (!result.ok)
                                return setError(
                                  "Taking back the award was not confirmed. Read the awards again before retrying.",
                                );
                              onChange?.();
                            } catch {
                              setError(
                                "Taking back the award was not confirmed. Read the awards again before retrying.",
                              );
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          take back
                        </button>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canGrant ? (
              granting ? (
                <form
                  style={{ display: "grid", gap: "8px", maxWidth: "520px" }}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    setError("");
                    const chosen = candidates.find((c) => c.player_tag === tag);
                    try {
                      const r = await manageApi.grantAward(clan.clan_tag, {
                        award_id: award.award_id,
                        player_tag: tag,
                        player_name: chosen?.name ?? null,
                        season_id: season.season_id,
                        note,
                      });
                      if (!r.ok)
                        return setError(
                          GRANT_ERRORS[r.data?.error] ??
                            "The grant was not confirmed. Read the awards again before retrying.",
                        );
                      trackEvent("clan.award_granted", award.kind);
                      setGranting(false);
                      setTag("");
                      setNote("");
                      onChange?.();
                    } catch {
                      setError(
                        "The grant was not confirmed. Read the awards again before retrying.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <label
                    className="field-label"
                    htmlFor={`g-${award.award_id}`}
                  >
                    Member
                  </label>
                  <select
                    id={`g-${award.award_id}`}
                    className="input"
                    value={tag}
                    required
                    disabled={busy}
                    onChange={(e) => setTag(e.target.value)}
                  >
                    <option value="">Choose a member…</option>
                    {candidates.map((c) => (
                      <option key={c.player_tag} value={c.player_tag}>
                        {c.name} ({c.player_tag})
                      </option>
                    ))}
                  </select>
                  <label
                    className="field-label"
                    htmlFor={`note-${award.award_id}`}
                  >
                    Why this member
                  </label>
                  <input
                    id={`note-${award.award_id}`}
                    className="input"
                    placeholder="Why (shown with the award)"
                    value={note}
                    maxLength={500}
                    required
                    disabled={busy}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  {tag ? (
                    <p className="page-head__note m-0">
                      Confirm {award.name} for season {season.season_id} for{" "}
                      {candidates.find((c) => c.player_tag === tag)?.name ??
                        tag}
                      .{" "}
                      {season.closed
                        ? "This records your choice; it does not send an announcement."
                        : "The season is still being fought; this records your choice now. It does not send an announcement."}
                    </p>
                  ) : null}
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="submit"
                      className="btn btn--primary"
                      disabled={busy || !tag || !note.trim()}
                    >
                      Grant {award.name}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setGranting(false)}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="btn btn--sm"
                  style={{ width: "fit-content" }}
                  onClick={() => setGranting(true)}
                >
                  Grant {award.name} for season {season.season_id}
                </button>
              )
            ) : null}
            {error ? <p className="field-error">{error}</p> : null}
          </>
        ) : rows.length === 0 ? (
          <p className="page__lede" style={{ margin: 0 }}>
            {season.closed
              ? "No grants recorded."
              : award.kind === "perfect_attendance"
                ? "Nobody on track."
                : "Nobody in the race yet."}
          </p>
        ) : (
          <Table
            columns={[
              {
                head: "",
                cellProps: () => ({
                  style: { width: "2.5em", color: "var(--ink-faint)" },
                }),
                cell: (r) =>
                  award.state === "held"
                    ? "—"
                    : award.kind === "perfect_attendance"
                      ? "✓"
                      : position(r) == null
                        ? "—"
                        : `${position(r)}${sharesPlace(r) ? "=" : ""}`,
              },
              {
                head: "",
                cell: (r) => {
                  const grant = grants.find(
                    (g) => g.player_tag === r.player_tag,
                  );
                  return (
                    <>
                      <strong>
                        <MemberLink
                          clanTag={clan.clan_tag}
                          playerTag={r.player_tag}
                          navigate={navigate}
                          current={candidates.some(
                            (member) => member.player_tag === r.player_tag,
                          )}
                        >
                          {r.name ?? <Tag tag={r.player_tag} />}
                        </MemberLink>
                      </strong>{" "}
                      <span className="tag">{r.player_tag}</span>
                      {season.closed && grant ? (
                        <span
                          className="chip chip--ok"
                          style={{ marginLeft: "6px" }}
                        >
                          granted
                        </span>
                      ) : null}
                    </>
                  );
                },
              },
              {
                head: "",
                num: true,
                cell: (r) => (
                  <>
                    <span>{metric(award, r)}</span>
                    {aside(award, r) ? (
                      <span className="block page-head__note">
                        {aside(award, r)}
                      </span>
                    ) : null}
                  </>
                ),
              },
            ]}
            rows={rows}
            rowKey={(r) => r.player_tag}
            noHead
            phone="fit"
            className="awards-race"
          />
        )}
      </div>
    </Panel>
  );
}

const STATE_LABEL = {
  live: "in progress",
  closed: "closed",
  held: "held",
  off: "off",
  manual: "by hand",
};

const GRANT_ERRORS = {
  season_not_pickable:
    "A leaders' pick is granted for the season in progress or for a closed season recorded whole. Read the awards again.",
  bad_note: "Add a reason of at most 500 characters.",
  not_in_roster:
    "This member is not in the recorded roster. Read the awards again.",
  grant_exists:
    "This grant already has a different recorded reason. Read it before making a change.",
};

function metric(award, r) {
  if (r.granted_at)
    return r.metric_value === null || r.metric_value === undefined
      ? "Recorded grant"
      : `${r.metric_value.toLocaleString()} ${UNIT[r.metric_unit] ?? r.metric_unit}`;
  if (award.kind === "perfect_attendance")
    return r.decks_short === 0
      ? `all ${r.decks_asked} war decks`
      : `${r.decks_short} deck${r.decks_short === 1 ? "" : "s"} short of ${r.decks_asked}`;
  if (award.kind === "donations_podium")
    return `${r.total.toLocaleString()} ${UNIT.donations}`;
  return `${r.points.toLocaleString()} ${UNIT.points}`;
}

/* The second line under a race's figure, so the figure itself stays
   short enough to sit beside the name on a phone (#386). */
function aside(award, r) {
  if (award.kind === "perfect_attendance")
    return Number.isFinite(r.donations)
      ? `${r.donations.toLocaleString()} donated`
      : "Donations unknown";
  if (r.granted_at) return null;
  if (award.kind === "donations_podium")
    return r.known_weeks < r.weeks
      ? `${r.known_weeks}/${r.weeks} weeks seen`
      : null;
  return r.tied ? `${r.donations.toLocaleString()} donated` : null;
}

function OlderGrants({ grants, awardById }) {
  if (!grants.length) return null;
  const seasons = [...new Set(grants.map((g) => g.season_id))].sort(
    (a, b) => b - a,
  );
  return (
    <section>
      <div className="label" style={{ marginBottom: "8px" }}>
        Earlier seasons, no longer in the record&rsquo;s window
      </div>
      {seasons.map((sid) => (
        <Panel as="div" key={sid} style={{ marginBottom: "10px" }}>
          <div className="panel__head">Season {sid}</div>
          <div className="panel__body">
            <ul style={{ margin: 0, paddingLeft: "18px" }}>
              {grants
                .filter((g) => g.season_id === sid)
                .map((g) => (
                  <li key={`${g.award_id}-${g.player_tag}`}>
                    <strong>{awardById.get(g.award_id)?.name ?? g.name}</strong>
                    {g.rank > 1 ? ` #${g.rank}` : ""} ·{" "}
                    {g.player_name ?? <Tag tag={g.player_tag} />}{" "}
                    <span className="tag">{g.player_tag}</span>
                    {g.note ? `: ${g.note}` : ""}
                  </li>
                ))}
            </ul>
          </div>
        </Panel>
      ))}
    </section>
  );
}

/**
 * The document editor: every award as a card (kind, name, description,
 * parameters with help text, on/off), add one, remove one, a note, save.
 * Validation answers come back keyed by field.
 */
export function AwardsConfig({ clan, view, onDone }) {
  const { whenDay } = useClock();
  const [draft, setDraft] = useState(() => structuredClone(view.config));
  const [errors, setErrors] = useState({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const kinds = view.kinds;
  const setAward = (i, patch) =>
    setDraft((d) => ({
      ...d,
      awards: d.awards.map((a, j) => (j === i ? { ...a, ...patch } : a)),
    }));
  const setParam = (i, key, value) =>
    setDraft((d) => ({
      ...d,
      awards: d.awards.map((a, j) =>
        j === i ? { ...a, params: { ...a.params, [key]: value } } : a,
      ),
    }));
  const add = (kind) => {
    const k = kinds[kind];
    const params = Object.fromEntries(
      Object.entries(k.params).map(([key, p]) => [key, p.default]),
    );
    setDraft((d) => ({
      ...d,
      awards: [
        ...d.awards,
        {
          id: `${kind.split("_")[0]}_${d.awards.length + 1}`,
          kind,
          name: k.title,
          description: "",
          enabled: true,
          params,
        },
      ],
    }));
  };
  const save = async () => {
    setBusy(true);
    setMessage("");
    const r = await manageApi.saveAwards(clan.clan_tag, draft, note || null);
    setBusy(false);
    if (!r.ok) {
      setErrors(r.data?.errors ?? {});
      setMessage(
        r.data?.errors ? "Fix the fields marked below." : "Save failed.",
      );
      return;
    }
    trackEvent("clan.awards_saved", `v${r.data.version}`);
    onDone();
  };
  const err = (key) =>
    errors[key] ? <p className="field-error">{errors[key]}</p> : null;

  return (
    <div className="grid gap-4">
      <p className="page-head__note m-0">
        Every save is a new version; grants already written keep the name they
        were given. Names and descriptions are yours; the rule under each is the
        kind&rsquo;s.
      </p>
      {draft.awards.map((a, i) => {
        const k = kinds[a.kind];
        return (
          <Panel key={i}>
            <div
              className="panel__head"
              style={{ gap: "8px", flexWrap: "wrap" }}
            >
              <span>{a.name || k.title}</span>
              <span className="chip">{k.title}</span>
              <label
                style={{
                  marginLeft: "auto",
                  display: "inline-flex",
                  gap: "6px",
                }}
              >
                <input
                  type="checkbox"
                  checked={a.enabled !== false}
                  onChange={(e) => setAward(i, { enabled: e.target.checked })}
                />
                <span>{a.enabled !== false ? "on" : "off"}</span>
              </label>
            </div>
            <div
              className="panel__body"
              style={{ display: "grid", gap: "10px" }}
            >
              <p className="page__lede" style={{ margin: 0 }}>
                {k.rule}
              </p>
              <div style={{ display: "grid", gap: "4px" }}>
                <label className="field-label" htmlFor={`a-${i}-name`}>
                  Name
                </label>
                <input
                  id={`a-${i}-name`}
                  className="input"
                  value={a.name}
                  maxLength={40}
                  onChange={(e) => setAward(i, { name: e.target.value })}
                />
                {err(`awards.${i}.name`)}
              </div>
              <div style={{ display: "grid", gap: "4px" }}>
                <label className="field-label" htmlFor={`a-${i}-desc`}>
                  Description{" "}
                  <span className="page-head__note">
                    (shown with the award)
                  </span>
                </label>
                <input
                  id={`a-${i}-desc`}
                  className="input"
                  value={a.description ?? ""}
                  maxLength={300}
                  onChange={(e) => setAward(i, { description: e.target.value })}
                />
                {err(`awards.${i}.description`)}
              </div>
              <div style={{ display: "grid", gap: "4px" }}>
                <label className="field-label" htmlFor={`a-${i}-id`}>
                  Short name{" "}
                  <span className="page-head__note">
                    (the durable key for this award and its grants; change it
                    only before the first grant)
                  </span>
                </label>
                <input
                  id={`a-${i}-id`}
                  className="input mono"
                  value={a.id}
                  onChange={(e) => setAward(i, { id: e.target.value })}
                />
                {err(`awards.${i}.id`)}
              </div>
              {Object.entries(k.params).map(([key, p]) => (
                <div key={key} style={{ display: "grid", gap: "4px" }}>
                  <label className="field-label" htmlFor={`a-${i}-${key}`}>
                    {p.label}{" "}
                    <span className="page-head__note">
                      {p.type === "enum"
                        ? `(${p.options.join(" / ")}; default ${p.default})`
                        : `(${p.min}–${p.max}; default ${p.default})`}
                    </span>
                  </label>
                  {p.type === "enum" ? (
                    <select
                      id={`a-${i}-${key}`}
                      className="input"
                      style={{ width: "auto" }}
                      value={a.params?.[key] ?? p.default}
                      onChange={(e) => setParam(i, key, e.target.value)}
                    >
                      {p.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`a-${i}-${key}`}
                      className="input"
                      type="number"
                      style={{ width: "8em" }}
                      min={p.min}
                      max={p.max}
                      step={1}
                      value={a.params?.[key] ?? p.default}
                      onChange={(e) =>
                        setParam(
                          i,
                          key,
                          e.target.value === "" ? "" : Number(e.target.value),
                        )
                      }
                    />
                  )}
                  <span className="page-head__note">{p.why}</span>
                  {err(`awards.${i}.params.${key}`)}
                </div>
              ))}
              <button
                type="button"
                className="btn--text"
                style={{ width: "fit-content" }}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    awards: d.awards.filter((_, j) => j !== i),
                  }))
                }
              >
                remove this award
              </button>
            </div>
          </Panel>
        );
      })}
      {err("awards")}
      <div
        style={{
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <span className="page-head__note">Add an award:</span>
        {Object.entries(kinds).map(([kind, k]) => (
          <button
            key={kind}
            type="button"
            className="btn btn--sm"
            onClick={() => add(kind)}
          >
            {k.title}
          </button>
        ))}
      </div>
      <input
        className="input"
        placeholder="A note for this version (optional)"
        value={note}
        maxLength={200}
        onChange={(e) => setNote(e.target.value)}
      />
      {message ? <p className="field-error">{message}</p> : null}
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={save}
        >
          {busy ? "Saving…" : "Save as a new version"}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
      {view.versions.length ? (
        <p className="page-head__note" style={{ margin: 0 }}>
          Versions:{" "}
          {view.versions
            .map(
              (v) =>
                `v${v.version} (${whenDay(v.saved_at)}${v.note ? `, ${v.note}` : ""})`,
            )
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
