import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { FirstAnswer } from "../../components/FirstAnswer.jsx";
import { SlotMeters } from "../../components/SlotMeter.jsx";

/**
 * Overview REPORTS; Tracking manages.
 *
 * This page used to be the console: the players table, the clans table,
 * the tier panel and the timezone control all lived here, and every one
 * of them had a control on it. The 2026-09-09 design splits the reading
 * from the doing — a landing page that says whether the thing is working
 * and where to go if it is not, and nothing on it that can be got wrong.
 *
 * So: no table, no toggle, no form. The compact lists are links into
 * Tracking, and the meters are a reading of the tier whose controls are
 * on the profile.
 */
/** One row of the compact Players/Clans lists. A link, because the whole
 *  point of these lists is that they go to Tracking. */
function CompactRow({ primary, secondary, note, onClick }) {
  return (
    <a
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px 2px",
        borderBottom: "1px solid var(--line-row)",
        color: "inherit",
      }}
    >
      <span style={{ fontSize: "14px", color: "var(--ink)", fontWeight: 500 }}>
        {primary}
      </span>
      {secondary && (
        <span className="mono" style={{ color: "var(--ink-link)" }}>
          {secondary}
        </span>
      )}
      <span
        style={{
          marginLeft: "auto",
          fontSize: "12.5px",
          color: "var(--ink-faint)",
        }}
      >
        {note}
      </span>
    </a>
  );
}

function ListHead({ title, navigate }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: "10px",
        padding: "0 0 12px",
      }}
    >
      <span style={{ fontSize: "14px", fontWeight: 600 }}>{title}</span>
      <a
        style={{ marginLeft: "auto", fontSize: "13px" }}
        onClick={() => navigate("/account/tracking")}
      >
        Manage ›
      </a>
    </div>
  );
}

export function Overview({ me, navigate }) {
  const [clans, setClans] = useState(null);
  useEffect(() => {
    api.myClans().then((r) => r.ok && setClans(r.data));
  }, []);

  const e = me.entitlements;
  const players = me.claims ?? [];
  const clanRows = clans?.clans ?? [];
  // "Brand new" is derived from the record, not stored: no players, no
  // clans. The greeting and the lede are the only two places the state
  // shows, and both say what to do next rather than that it is empty.
  const fresh = players.length === 0 && clanRows.length === 0;

  return (
    <>
      <div style={{ marginBottom: "20px" }}>
        <h1 className="page__title">
          {fresh ? "Your account is open" : "Everything is recording"}
        </h1>
        <p className="page__lede">
          {fresh
            ? "Add the player you play as. Capture starts on the next poll — usually within half an hour."
            : `${players.length} player${players.length === 1 ? "" : "s"} and ${clanRows.length} clan${clanRows.length === 1 ? "" : "s"} on record. Nothing needs you today.`}
        </p>
      </div>

      <FirstAnswer
        claimsKey={players
          .map((c) => `${c.player_tag}:${c.is_primary}`)
          .join(",")}
      />

      <div
        style={{
          display: "flex",
          gap: "20px",
          flexWrap: "wrap",
          marginBottom: "22px",
        }}
      >
        <section style={{ flex: "1 1 300px" }}>
          <ListHead title="Players" navigate={navigate} />
          {players.length === 0 ? (
            <div className="empty">
              <p className="empty__body">
                No players yet — nothing here defaults to you.
              </p>
              <button
                className="btn btn--primary"
                onClick={() => navigate("/account/tracking")}
              >
                Add your player
              </button>
            </div>
          ) : (
            players.map((p) => (
              <CompactRow
                key={p.player_tag}
                primary={p.nickname ?? p.name ?? "—"}
                secondary={p.player_tag}
                note={p.is_primary ? "you" : (p.relationship ?? "watching")}
                onClick={() =>
                  navigate(
                    `/account/tracking/${encodeURIComponent(p.player_tag.replace(/^#/, ""))}`,
                  )
                }
              />
            ))
          )}
        </section>

        <section style={{ flex: "1 1 300px" }}>
          <ListHead title="Clans" navigate={navigate} />
          {clanRows.length === 0 ? (
            <div className="empty">
              <p className="empty__body" style={{ marginBottom: 0 }}>
                No clans yet. Add your player first — we offer their clan as
                soon as we see it.
              </p>
            </div>
          ) : (
            clanRows.map((c) => (
              <CompactRow
                key={c.clan_tag}
                primary={c.name ?? c.clan_tag}
                note={
                  c.member_count
                    ? `${c.scope} · ${c.member_count} members`
                    : c.scope
                }
                onClick={() =>
                  navigate(
                    `/account/tracking/${encodeURIComponent(c.clan_tag.replace(/^#/, ""))}`,
                  )
                }
              />
            ))
          )}
          {clans?.home_clan &&
            !clanRows.some((c) => c.clan_tag === clans.home_clan.clan_tag) && (
              <p
                style={{
                  margin: "12px 0 0",
                  fontSize: "12.5px",
                  color: "var(--ink-faint)",
                }}
              >
                {clans.home_clan.name ?? clans.home_clan.clan_tag} is your
                player&rsquo;s clan, and is not tracked yet.
              </p>
            )}
        </section>
      </div>

      {e && (
        <section>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              flexWrap: "wrap",
              padding: "0 0 13px",
            }}
          >
            <span style={{ fontSize: "14px", fontWeight: 600 }}>Your tier</span>
            <span className="chip chip--tier">{me.role}</span>
            <a
              style={{ marginLeft: "auto", fontSize: "13px" }}
              onClick={() => navigate("/account/profile")}
            >
              Profile ›
            </a>
          </div>
          <SlotMeters entitlements={e} />
        </section>
      )}
    </>
  );
}
