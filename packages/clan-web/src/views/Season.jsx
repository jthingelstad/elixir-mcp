import { Fresh, Link } from "@elixir-mcp/ui";
import { PageHead, Tile, Tiles } from "../components/PageHead.jsx";
import { useSeason } from "../lib/queries.js";
import { CLAN, clanPath } from "../lib/base.js";

const n = (v) => (v == null ? "—" : v.toLocaleString());
const date = (v) =>
  new Date(v).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const STATUS = {
  open: "So far",
  closed: "Closed",
  unconfirmed: "Closure unconfirmed",
  missing: "Not recorded",
  upcoming: "Upcoming",
};

export function Season({ clan, season, navigate }) {
  const { state } = useSeason(clan.clan_tag);
  const d = state.data;
  const selected = season ?? d?.current_season_id;
  const s = d?.seasons.find((r) => String(r.season_id) === String(selected));
  const base = `${clanPath(clan.clan_tag)}/season`;
  const head = (lede, children) => (
    <PageHead
      clan={clan}
      name={d?.clan_name}
      crumb="Season"
      title={s ? `Season ${s.season_id}` : "Season"}
      lede={lede}
      navigate={navigate}
      fresh={
        d?.as_of ? (
          <Fresh
            label="record as of"
            seconds={d.freshness_seconds}
            ts={d.as_of}
          />
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
          Your current clan access does not allow this season.
        </div>
      </>
    );
  if (state.error)
    return (
      <>
        {head()}
        <div className="callout callout--warn" role="alert">
          {state.error === "clan_not_recorded"
            ? "Elixir is not recording this clan yet."
            : "Elixir did not answer. Try again in a minute."}
        </div>
      </>
    );
  if (!d) return head("Reading the season…");
  if (!s)
    return (
      <>
        {head()}
        <div className="callout callout--warn" role="alert">
          That season is outside this read of the record.{" "}
          <Link to={base}>Current season</Link>
        </div>
      </>
    );
  const c = s.coverage;
  return (
    <>
      {head(
        `${date(s.from)} to ${date(s.to)} (UTC). Recorded Clan Wars totals and each race in this season.`,
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-3">
            <span className="field-label">Season</span>
            <select
              className="input w-auto"
              value={s.season_id}
              onChange={(e) => navigate?.(`${base}/${e.target.value}`)}
            >
              {d.seasons.map((r) => (
                <option key={r.season_id} value={r.season_id}>
                  Season {r.season_id} · {STATUS[r.state].toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <span className="page-head__note">
            {STATUS[s.state]}
            {s.incomplete ? " · partial record" : ""}
          </span>
          <Link to={`${clanPath(clan.clan_tag)}/week`}>The week ›</Link>
        </div>,
      )}
      <Tiles label="Recorded season totals">
        <Tile
          label="Recorded war decks"
          value={n(s.decks)}
          hint="Known weekly counters"
        />
        <Tile
          label="Recorded period points"
          value={n(s.points)}
          hint="Member contributions"
        />
        <Tile
          label="Recorded contributors"
          value={n(s.contributors)}
          hint="Each player counted once"
        />
      </Tiles>
      <section className="panel">
        <div className="panel__head">
          <h2 id="season-races" className="m-0 grow text-[14px] font-semibold">
            Race by race
          </h2>
          <span className="page-head__note font-normal">
            {c.recorded_sections} of {c.expected_sections} races recorded
          </span>
        </div>
        <div
          className="table__scroll"
          tabIndex={0}
          role="region"
          aria-labelledby="season-races"
        >
          <table className="table">
            <caption className="sr-only">
              Recorded war decks, period points and contributors in
              chronological race order
            </caption>
            <thead>
              <tr>
                {["Race", "State", "Decks", "Points", "Players"].map((name) => (
                  <th
                    key={name}
                    scope="col"
                    className="px-3 py-2 font-semibold"
                  >
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.races.map((r) => (
                <tr key={r.section_index} className="border-t border-line-row">
                  <th scope="row" className="px-3 py-3 font-normal">
                    {r.section_index + 1}
                    <span className="block text-[12px] text-ink-faint">
                      {date(r.from)}
                    </span>
                    {r.is_colosseum ? (
                      <span className="block text-[12px] text-ink-faint">
                        Colosseum
                      </span>
                    ) : null}
                  </th>
                  <td className="px-3 py-3">
                    {STATUS[r.state]}
                    {r.counters_unknown ? (
                      <span className="block text-[12px] text-ink-faint">
                        Partial readings
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 font-mono">{n(r.decks)}</td>
                  <td className="px-3 py-3 font-mono">{n(r.points)}</td>
                  <td className="px-3 py-3 font-mono">{n(r.contributors)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel__foot grid gap-2">
          <p className="m-0">
            Readings from {c.current_members} current and {c.former_members}{" "}
            former members in this read. Missing readings are unknown.
          </p>
          {c.missing_sections ? (
            <p className="m-0">
              {c.missing_sections} race
              {c.missing_sections === 1 ? " has" : "s have"} no capture yet.
            </p>
          ) : null}
          {c.before_window ? (
            <p className="m-0">
              This season begins before the eight-week read. Earlier
              contributions are outside these totals.
            </p>
          ) : null}
          {c.roster_started_late ? (
            <p className="m-0">
              Roster recording began after this season started.
            </p>
          ) : null}
          {c.closure_unconfirmed ? (
            <p className="m-0">
              Some past race closures are not confirmed in the record.
            </p>
          ) : null}
          <p className="m-0">
            These are the members represented by this read, not proof of every
            contribution to the clan. A recorded race alone does not prove
            complete member capture.
          </p>
        </div>
      </section>
    </>
  );
}
