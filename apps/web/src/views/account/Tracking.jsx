import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { Icon } from "../../components/Icon.jsx";
import { ago, secsSince } from "../../lib/time.js";

/**
 * Tracking — ONE table over both kinds, and a record per tracked thing.
 *
 * It was two card-wrapped tables inherited from the old Overview, one
 * for players and one for clans, each carrying its own controls in its
 * own row. That is two idioms for one idea: a player and a clan are both
 * something you track, with a relationship, a freshness and a cost
 * against your slots.
 *
 * So: one bare table (a table is interface, not a report — no card, no
 * fills, hover only), a filter for the two kinds, and the controls moved
 * to the record, because a row with four controls in it is a form
 * pretending to be a list.
 *
 * "Tracked", never "subject", in a heading or a column — the design file
 * writes SUBJECT there but VOCABULARY.md is explicit that the schema's
 * word does not reach the interface, and it is the stricter of the two.
 */
const TAG_OK = /^#?[0289PYLQGRJCUVOo]{3,12}$/;

function freshness(ts, now) {
  const s = secsSince(ts, now);
  if (s == null) return { text: "never polled", tone: "ink-faint" };
  if (s < 3600) return { text: ago(ts, now), tone: "ok" };
  if (s < 86400) return { text: ago(ts, now), tone: "warn" };
  return { text: ago(ts, now), tone: "ink-faint" };
}

export function Tracking({ me, refresh, navigate }) {
  const [clans, setClans] = useState(null);
  const [filter, setFilter] = useState("all");
  const [tag, setTag] = useState("");
  const [tagErr, setTagErr] = useState("");
  const [clanTag, setClanTag] = useState("");
  const [clanScope, setClanScope] = useState("comprehensive");
  const [clanErr, setClanErr] = useState("");
  const [now] = useState(() => Date.now());

  const loadClans = () => api.myClans().then((r) => r.ok && setClans(r.data));
  useEffect(() => {
    loadClans();
  }, []);

  const recFor = (t) => me.recordings?.find((r) => r.subject_tag === t);
  const e = me.entitlements;

  const rows = [
    ...(me.claims ?? []).map((c) => {
      const rec = recFor(c.player_tag);
      return {
        kind: "player",
        key: c.player_tag,
        tag: c.player_tag,
        name: c.nickname ?? c.name ?? "—",
        rel: c.is_primary ? "you" : (c.relationship ?? "watching"),
        primary: c.is_primary,
        fresh: freshness(rec?.freshest_poll, now),
        day: rec?.fetches_24h ?? 0,
      };
    }),
    ...((clans?.clans ?? []).map((c) => ({
      kind: "clan",
      key: c.clan_tag,
      tag: c.clan_tag,
      name: c.name ?? c.clan_tag,
      rel: clans?.home_clan?.clan_tag === c.clan_tag ? "your clan" : c.scope,
      primary: clans?.home_clan?.clan_tag === c.clan_tag,
      fresh: {
        text: c.recording_status ?? "off",
        tone: c.recording_status === "active" ? "ok" : "ink-faint",
      },
      day: null,
    })) ?? []),
  ].filter((r) => filter === "all" || r.kind === filter.replace(/s$/, ""));

  const chips = [
    e?.player_slots && ["Players", e.player_slots],
    e?.activity_clans && ["Clans · activity", e.activity_clans],
    e?.comprehensive_clans && ["Clans · comprehensive", e.comprehensive_clans],
  ].filter(Boolean);

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "16px",
          flexWrap: "wrap",
          marginBottom: "18px",
        }}
      >
        <div>
          <h1 className="page__title">Tracking</h1>
          <p className="page__lede">
            Tracked means recorded. Capture starts on the next poll and does not
            stop until you remove it.
          </p>
        </div>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
          }}
        >
          {chips.map(([label, slot]) => (
            <span
              className="btn btn--sm"
              key={label}
              style={{ cursor: "default" }}
            >
              {label}{" "}
              <span
                className={
                  "meter__value" +
                  (slot.limit != null &&
                  slot.limit > 0 &&
                  slot.used >= slot.limit
                    ? " meter__value--full"
                    : "")
                }
              >
                {slot.used}/{slot.limit ?? "∞"}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexWrap: "wrap",
          padding: "0 0 13px",
        }}
      >
        <div
          style={{
            display: "flex",
            background: "var(--ground-sunken)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-control)",
            padding: "3px",
            gap: "2px",
          }}
        >
          {[
            ["all", "All"],
            ["players", "Players"],
            ["clans", "Clans"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={
                "btn btn--sm" + (filter === key ? " btn--selected" : "")
              }
              style={
                filter === key
                  ? undefined
                  : { background: "transparent", border: 0 }
              }
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <div className="empty__title">Nothing tracked yet</div>
          <p className="empty__body" style={{ marginBottom: 0 }}>
            Add the player you play as below. Nothing here defaults to you, and
            capture starts on the next poll.
          </p>
        </div>
      ) : (
        <div className="table__scroll">
          <table className="table" style={{ minWidth: "640px" }}>
            <thead>
              <tr>
                <th>TRACKED</th>
                <th>RELATIONSHIP</th>
                <th>FRESHNESS</th>
                <th style={{ textAlign: "right" }}>24H</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      {/* Ownership is a mark and a word, never a tinted row. */}
                      {r.primary && (
                        <span style={{ color: "var(--gold)" }}>★</span>
                      )}
                      <a
                        style={{ fontWeight: 600, fontSize: "14px" }}
                        onClick={() =>
                          navigate(
                            `/account/tracking/${encodeURIComponent(r.tag)}`,
                          )
                        }
                      >
                        {r.name}
                      </a>
                    </span>
                    <a
                      className="mono"
                      style={{ display: "inline-block", marginTop: "3px" }}
                      onClick={() =>
                        navigate(
                          `/explore/${r.kind === "clan" ? "clan" : "player"}/${encodeURIComponent(r.tag)}`,
                        )
                      }
                    >
                      {r.tag}
                    </a>
                  </td>
                  <td>{r.rel}</td>
                  <td>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "7px",
                        color: `var(--${r.fresh.tone})`,
                      }}
                    >
                      <span
                        className="chip__dot"
                        style={{ background: `var(--${r.fresh.tone})` }}
                      />
                      {r.fresh.text}
                    </span>
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {r.day ?? "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="btn btn--sm"
                      onClick={() =>
                        navigate(
                          `/account/tracking/${encodeURIComponent(r.tag)}`,
                        )
                      }
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {clans?.home_clan &&
        !(clans.clans ?? []).some(
          (c) => c.clan_tag === clans.home_clan.clan_tag,
        ) && (
          <div className="callout callout--info" style={{ marginTop: "18px" }}>
            <Icon name="radar" size={17} />
            <span>
              <span style={{ color: "var(--gold)" }}>★</span>{" "}
              {clans.home_clan.name ?? clans.home_clan.clan_tag} is your
              player&rsquo;s clan and is not tracked yet.{" "}
              <button
                className="btn btn--sm"
                onClick={async () => {
                  await api.myClanAction({
                    action: "add",
                    clan_tag: clans.home_clan.clan_tag,
                    scope: "comprehensive",
                  });
                  loadClans();
                }}
              >
                Track it comprehensively
              </button>
            </span>
          </div>
        )}

      <div
        style={{
          display: "flex",
          gap: "18px",
          flexWrap: "wrap",
          marginTop: "24px",
        }}
      >
        <section className="panel" style={{ flex: "1 1 300px" }}>
          <div className="panel__head">Track a player</div>
          <div
            className="panel__body"
            style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}
          >
            <input
              id="add-player-tag"
              aria-label="Player tag"
              className="mono"
              placeholder="#20JJJ2CCRU"
              aria-invalid={tagErr ? "true" : undefined}
              value={tag}
              onChange={(ev) => {
                setTag(ev.target.value);
                setTagErr("");
              }}
              style={{ flex: "1 1 10rem" }}
            />
            <button
              className="btn"
              onClick={async () => {
                if (!TAG_OK.test(tag.trim())) {
                  setTagErr("That doesn't look like a CR tag.");
                  return;
                }
                const r = await api.addClaim(tag.trim());
                if (r.ok) {
                  setTag("");
                  refresh();
                } else setTagErr(r.data?.message ?? "Could not add.");
              }}
            >
              Track
            </button>
            {tagErr && (
              <span className="field-error" style={{ flexBasis: "100%" }}>
                {tagErr}
              </span>
            )}
          </div>
          <div className="panel__foot">Added means recorded.</div>
        </section>

        <section className="panel" style={{ flex: "1 1 300px" }}>
          <div className="panel__head">Track a clan</div>
          <div
            className="panel__body"
            style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}
          >
            <input
              className="mono"
              aria-label="Clan tag"
              placeholder="#CLANTAG"
              value={clanTag}
              onChange={(ev) => {
                setClanTag(ev.target.value);
                setClanErr("");
              }}
              style={{ flex: "1 1 8rem" }}
            />
            <select
              className="select"
              aria-label="Scope"
              value={clanScope}
              onChange={(ev) => setClanScope(ev.target.value)}
            >
              <option value="comprehensive">comprehensive</option>
              <option value="activity">activity</option>
            </select>
            <button
              className="btn"
              onClick={async () => {
                const r = await api.myClanAction({
                  action: "add",
                  clan_tag: clanTag.trim(),
                  scope: clanScope,
                });
                if (r.ok) {
                  setClanTag("");
                  loadClans();
                } else setClanErr(r.data?.message ?? "Could not add.");
              }}
            >
              Track
            </button>
            {clanErr && (
              <span className="field-error" style={{ flexBasis: "100%" }}>
                {clanErr}
              </span>
            )}
          </div>
          <div className="panel__foot">
            Comprehensive records every member; activity records the clan.
          </div>
        </section>
      </div>

      {(clans?.clans ?? []).some(
        (c) => c.effective_scope && c.effective_scope !== c.scope,
      ) && (
        <p
          className="footnote"
          style={{ margin: "18px 2px 0", maxWidth: "78ch" }}
        >
          † Another account records one of these clans comprehensively — a
          shared recording runs at the widest scope anyone requested.
        </p>
      )}
    </>
  );
}
