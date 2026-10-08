import { ago, Icon, Link, secsSince } from "@elixir-mcp/ui";
import { useState } from "react";
import { api } from "../../api.js";
import { useInvalidate, useMyClans } from "../../lib/queries.js";
import { tagPath } from "../../lib/tag-url.js";
import { VerifiedMark } from "../../components/VerifiedMark.jsx";
import { CONSOLE } from "../../lib/console.js";
import { ClanReadStatus } from "../../components/ClanReadStatus.jsx";

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
const TAG_OK = /^#?[0289PYLQGRJCUVO]{3,12}$/i;

function freshness(ts, now) {
  const s = secsSince(ts, now);
  if (s == null) return { text: "never polled", tone: "ink-faint" };
  if (s < 3600) return { text: ago(ts, now), tone: "ok" };
  if (s < 86400) return { text: ago(ts, now), tone: "warn" };
  return { text: ago(ts, now), tone: "ink-faint" };
}

export function Tracking({ me, refresh, navigate }) {
  const clansQuery = useMyClans();
  const clans = clansQuery.data ?? null;
  const [homeBusy, setHomeBusy] = useState(false);
  const [homeErr, setHomeErr] = useState("");
  const [filter, setFilter] = useState("all");
  const [tag, setTag] = useState("");
  const [tagErr, setTagErr] = useState("");
  const [tagInfo, setTagInfo] = useState("");
  const [tagBusy, setTagBusy] = useState(false);
  const [clanTag, setClanTag] = useState("");
  // Activity is the slot every tier has; comprehensive is an upgrade
  // chosen knowing its cost. The comprehensive default failed a new
  // member's first clan add (console audit F1), as the home-clan offer
  // below once did.
  const [clanScope, setClanScope] = useState("activity");
  const [clanErr, setClanErr] = useState("");
  const [now] = useState(() => Date.now());

  // A tracking change moves the rail's count as well as this list, so
  // it invalidates everything that is the reader's own, not just clans.
  const invalidate = useInvalidate();
  const loadClans = () => invalidate();

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
        verified: c.status === "verified",
        fresh: freshness(rec?.freshest_poll, now),
        day: rec?.fetches_24h ?? 0,
      };
    }),
    ...((clans?.clans ?? []).map((c) => {
      const rec = recFor(c.clan_tag);
      // † marks a clan another account records more deeply than you asked
      // for; the footnote under the table says what that means.
      const deeper = c.effective_scope && c.effective_scope !== c.scope;
      return {
        kind: "clan",
        key: c.clan_tag,
        tag: c.clan_tag,
        name: c.name ?? c.clan_tag,
        rel:
          (clans?.home_clan?.clan_tag === c.clan_tag ? "your clan" : c.scope) +
          (deeper ? " †" : ""),
        primary: clans?.home_clan?.clan_tag === c.clan_tag,
        // The same clock as a player row: when the clan was last polled.
        // A clan with no recording at all is honestly "off".
        fresh: rec
          ? freshness(rec.freshest_poll, now)
          : { text: c.recording_status ?? "off", tone: "ink-faint" },
        day: rec?.fetches_24h ?? null,
      };
    }) ?? []),
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
            Adding a tag requests recording. Saved profiles and battles appear
            as observations arrive; gaps and unobserved time remain unknown.
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

      <ClanReadStatus query={clansQuery} />

      {rows.length === 0 ? (
        (clansQuery.isSuccess || filter === "players") && (
          <div className="empty">
            <div className="empty__title">
              {filter === "players"
                ? "No players tracked"
                : filter === "clans"
                  ? "No clans tracked"
                  : "Nothing tracked yet"}
            </div>
            <p className="empty__body" style={{ marginBottom: 0 }}>
              {filter === "clans"
                ? "Track a clan below, or add your player to see their clan."
                : "Add the player you play as below. Nothing here defaults to you, and capture starts on the next poll."}
            </p>
          </div>
        )
      ) : (
        <div className="table__scroll" tabIndex={0}>
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
                      {/* The kind glyph tells a player from a clan under the
                          "All" filter; gold on the ones that are yours, because
                          ownership is a mark and a word, never a tinted row. */}
                      <span
                        style={{
                          display: "flex",
                          color: r.primary
                            ? "var(--gold)"
                            : "var(--ink-quiet-icon)",
                        }}
                        title={r.kind === "clan" ? "clan" : "player"}
                      >
                        <Icon
                          name={r.kind === "clan" ? "shield" : "user-round"}
                          size={16}
                        />
                      </span>
                      <Link
                        style={{ fontWeight: 600, fontSize: "14px" }}
                        to={`${CONSOLE}/account/tracking/${tagPath(r.tag)}`}
                      >
                        {r.name}
                      </Link>
                      {r.verified && <VerifiedMark />}
                    </span>
                    <Link
                      className="mono"
                      style={{ display: "inline-block", marginTop: "3px" }}
                      to={`${CONSOLE}/explore/${r.kind === "clan" ? "clan" : "player"}/${tagPath(r.tag)}`}
                    >
                      {r.tag}
                    </Link>
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
                          `${CONSOLE}/account/tracking/${tagPath(r.tag)}`,
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
            {/* This offered COMPREHENSIVE, which every tier below
                supporter has no slots for, so the button posted, was
                refused, and reported nothing — it read as a dead
                control. Activity is the right default anyway: it is the
                slot every account has, and it is what "follow my clan"
                means. Comprehensive is an upgrade you choose knowing
                what it costs. */}
            <span>
              <span style={{ color: "var(--gold)" }}>★</span>{" "}
              {clans.home_clan.name ?? clans.home_clan.clan_tag} is your
              player&rsquo;s clan and{" "}
              <button
                type="button"
                className="link"
                onClick={async () => {
                  if (homeBusy) return;
                  setHomeBusy(true);
                  setHomeErr("");
                  const res = await api.myClanAction({
                    action: "add",
                    clan_tag: clans.home_clan.clan_tag,
                    scope: "activity",
                  });
                  setHomeBusy(false);
                  // The API's own message names the tier and the slot,
                  // which is more use than anything this file could
                  // guess — a refusal that says nothing is what made
                  // the old button read as broken.
                  if (!res.ok)
                    return setHomeErr(
                      res.data?.message ?? "That did not work. Try again.",
                    );
                  loadClans();
                }}
              >
                is not tracked yet, start tracking now!
              </button>
              <span
                style={{
                  display: "block",
                  marginTop: "5px",
                  fontSize: "13px",
                  color: "var(--ink-dim)",
                }}
              >
                Activity follows the clan itself — its roster, its members
                coming and going, and its river races. Comprehensive also
                records every member&rsquo;s battles, which is what builds the
                clan a full history.
              </span>
              {homeErr && <p className="field-error">{homeErr}</p>}
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
              disabled={tagBusy}
              className="mono"
              placeholder="#20JJJ2CCRU"
              aria-invalid={tagErr ? "true" : undefined}
              value={tag}
              onChange={(ev) => {
                setTag(ev.target.value);
                setTagErr("");
                setTagInfo("");
              }}
              style={{ flex: "1 1 10rem" }}
            />
            <button
              className="btn"
              disabled={tagBusy}
              onClick={async () => {
                if (tagBusy) return;
                setTagErr("");
                setTagInfo("");
                if (!TAG_OK.test(tag.trim())) {
                  setTagErr("That doesn't look like a CR tag.");
                  return;
                }
                setTagBusy(true);
                try {
                  const r = await api.addClaim(tag.trim());
                  if (r.ok) {
                    setTagErr("");
                    setTag("");
                    const savedTag =
                      r.data?.player_tag ??
                      tag
                        .trim()
                        .toUpperCase()
                        .replace(/^#/, "")
                        .replaceAll("O", "0");
                    setTagInfo("Your player tag was saved.");
                    let current;
                    try {
                      current = await refresh();
                    } catch {
                      /* The add already succeeded. */
                    }
                    if (
                      !current?.claims?.some(
                        (c) => tagPath(c.player_tag) === tagPath(savedTag),
                      )
                    ) {
                      setTagInfo(
                        "Your tag was saved, but Tracking could not refresh. Reload this page to continue; you do not need to add it again.",
                      );
                      return;
                    }
                    navigate(
                      `${CONSOLE}/account/tracking/${tagPath(savedTag)}`,
                    );
                  } else
                    setTagErr(r.data?.message ?? "Could not add. Try again.");
                } catch {
                  setTagErr(
                    "Elixir did not answer. Check Tracking before retrying; the tag may have been saved.",
                  );
                } finally {
                  setTagBusy(false);
                }
              }}
            >
              {tagBusy ? "Adding…" : "Track"}
            </button>
            {tagErr && (
              <span className="field-error" style={{ flexBasis: "100%" }}>
                {tagErr}
              </span>
            )}
            {tagInfo && (
              <p role="status" className="w-full">
                {tagInfo}
              </p>
            )}
          </div>
          <div className="panel__foot">
            Find your player tag in Clash Royale: open your player profile and
            look below your name.
            {(me.claims ?? []).length === 0
              ? " Your first player becomes your primary player."
              : ""}{" "}
            Adding a tag starts recording. Proving ownership is a separate step
            under{" "}
            <Link className="underline" to={`${CONSOLE}/account/verify`}>
              Verify
            </Link>
            .
          </div>
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
              <option
                value="comprehensive"
                disabled={e?.comprehensive_clans?.limit === 0}
              >
                comprehensive
              </option>
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
            {e?.comprehensive_clans?.limit === 0
              ? " Your account includes activity recording, with no comprehensive clan slots."
              : ""}
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
