import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { Icon } from "../../components/Icon.jsx";
import { ago, secsSince } from "../../lib/time.js";

/**
 * One tracked player or clan: how you track it, and what that is
 * capturing.
 *
 * The controls live here rather than in the Tracking row. A list row
 * with a nickname field, a relationship select, a notify switch and a
 * remove button in it is a form pretending to be a list, and it makes
 * the one thing a list is for — comparing rows — impossible.
 *
 * "Stop tracking" says what it costs beside itself: the history already
 * recorded is kept, and this only stops new capture. That is the whole
 * reason the word is "stop" and not "delete".
 */
export function TrackedRecord({ me, refresh, navigate, tag }) {
  const [clans, setClans] = useState(null);
  const [nick, setNick] = useState(null);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());

  const loadClans = () => api.myClans().then((r) => r.ok && setClans(r.data));
  useEffect(() => {
    loadClans();
  }, []);

  const wanted = decodeURIComponent(tag ?? "");
  const claim = (me.claims ?? []).find((c) => c.player_tag === wanted);
  const clan = (clans?.clans ?? []).find((c) => c.clan_tag === wanted);
  const rec = me.recordings?.find((r) => r.subject_tag === wanted);

  const crumb = (
    <div className="page__crumb">
      <a onClick={() => navigate("/account/tracking")}>‹ Tracking</a>
    </div>
  );

  if (!claim && !clan) {
    if (clans === null)
      return <p style={{ color: "var(--ink-faint)" }}>Loading…</p>;
    return (
      <>
        {crumb}
        <div className="empty">
          <div className="empty__title">You are not tracking that</div>
          <p className="empty__body" style={{ marginBottom: 0 }}>
            <span className="mono">{wanted}</span> is not on your account. If
            you removed it, the history we already recorded is still there —
            look it up in Explore.
          </p>
        </div>
      </>
    );
  }

  const isClan = Boolean(clan);
  const name = isClan
    ? (clan.name ?? clan.clan_tag)
    : (claim.nickname ?? claim.name ?? claim.player_tag);
  const fresh = secsSince(rec?.freshest_poll, now);

  return (
    <>
      {crumb}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "14px",
          flexWrap: "wrap",
          marginBottom: "18px",
        }}
      >
        <div>
          <h1 className="page__title">{name}</h1>
          <p className="page__lede">
            <a
              className="mono"
              onClick={() =>
                navigate(
                  `/explore/${isClan ? "clan" : "player"}/${encodeURIComponent(wanted)}`,
                )
              }
            >
              {wanted}
            </a>
            <span>
              {" · "}
              {isClan ? "clan" : "player"}
              {isClan && clan.member_count
                ? ` · ${clan.member_count} members`
                : ""}
              {!isClan && claim.is_primary ? " · your primary" : ""}
            </span>
          </p>
        </div>
        <button
          className="btn"
          style={{ marginLeft: "auto" }}
          onClick={() =>
            navigate(
              `/explore/${isClan ? "clan" : "player"}/${encodeURIComponent(wanted)}`,
            )
          }
        >
          <Icon name="search" size={16} />
          Open in Explore
        </button>
      </div>

      <div style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
        <section className="panel" style={{ flex: "1 1 340px" }}>
          <div className="panel__head">How you track it</div>
          <div
            style={{
              padding: "16px",
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "14px 16px",
              alignItems: "center",
              fontSize: "13.5px",
            }}
          >
            <span style={{ color: "var(--ink-faint)" }}>Relationship</span>
            <span>
              {isClan ? (
                <span style={{ color: "var(--ink-faint)" }}>
                  a clan is tracked, not related
                </span>
              ) : claim.is_primary ? (
                // Gold marks ownership, and the primary player is the one
                // thing on this account that is unambiguously you.
                <span
                  style={{
                    color: "var(--gold)",
                    fontSize: "12.5px",
                    border: "1px solid var(--warn-edge)",
                    borderRadius: "var(--r-chip)",
                    padding: "5px 10px",
                  }}
                >
                  you
                </span>
              ) : (
                <select
                  className="select"
                  aria-label="Relationship"
                  value={claim.relationship ?? "watching"}
                  onChange={async (ev) => {
                    await api.setRelationship(wanted, ev.target.value);
                    refresh();
                  }}
                >
                  <option value="alt">alt</option>
                  <option value="friend">friend</option>
                  <option value="watching">watching</option>
                </select>
              )}
            </span>

            <span style={{ color: "var(--ink-faint)" }}>Scope</span>
            <span>
              {isClan ? (
                <select
                  className="select"
                  aria-label="Scope"
                  value={clan.scope}
                  onChange={async (ev) => {
                    await api.myClanAction({
                      action: "add",
                      clan_tag: wanted,
                      scope: ev.target.value,
                    });
                    loadClans();
                  }}
                >
                  <option value="comprehensive">comprehensive</option>
                  <option value="activity">activity</option>
                </select>
              ) : (
                <span style={{ color: "var(--ink-faint)" }}>
                  players have one scope
                </span>
              )}
            </span>

            {!isClan && (
              <>
                <span style={{ color: "var(--ink-faint)" }}>Nickname</span>
                <span>
                  <input
                    className="mono"
                    aria-label="Nickname"
                    placeholder="—"
                    maxLength={40}
                    value={nick ?? claim.nickname ?? ""}
                    onChange={(ev) => setNick(ev.target.value)}
                    onBlur={async () => {
                      if (nick == null || nick === (claim.nickname ?? ""))
                        return;
                      await api.explore("elixir_nickname", {
                        player_tag: wanted,
                        nickname: nick.trim() || null,
                      });
                      refresh();
                    }}
                    style={{ width: "11rem" }}
                  />
                  <span
                    className="footnote"
                    style={{ display: "block", marginTop: "4px" }}
                  >
                    Private to you, and your agent sees it.
                  </span>
                </span>
              </>
            )}

            <span style={{ color: "var(--ink-faint)" }}>Notifications</span>
            <span>
              <button
                className="switch"
                role="switch"
                aria-checked={
                  (isClan ? clan.notify : claim.notify) ? "true" : "false"
                }
                aria-label="Notifications"
                onClick={async () => {
                  const on = isClan ? clan.notify : claim.notify;
                  if (isClan)
                    await api.myClanAction({
                      clan_tag: wanted,
                      action: on ? "notify_off" : "notify_on",
                    });
                  else
                    await api.claimAction({
                      player_tag: wanted,
                      action: on ? "notify_off" : "notify_on",
                    });
                  if (isClan) loadClans();
                  else refresh();
                }}
              />
              <span
                className="footnote"
                style={{ display: "block", marginTop: "4px" }}
              >
                Queued for a connection to pick up, never email.
              </span>
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              flexWrap: "wrap",
              padding: "13px 16px",
              borderTop: "1px solid var(--line-soft)",
            }}
          >
            <button
              className="btn btn--danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                if (isClan)
                  await api.myClanAction({
                    clan_tag: wanted,
                    action: "remove",
                  });
                else
                  await api.claimAction({
                    player_tag: wanted,
                    action: "remove",
                  });
                setBusy(false);
                await refresh();
                navigate("/account/tracking");
              }}
            >
              Stop tracking
            </button>
            {/* The consequence beside the control: this stops new capture
                and takes nothing away. */}
            <span className="footnote">History already recorded is kept.</span>
          </div>
        </section>

        <section className="panel" style={{ flex: "1 1 300px" }}>
          <div className="panel__head">Capture</div>
          <dl
            style={{
              padding: "16px",
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "12px 16px",
              margin: 0,
              fontSize: "13.5px",
            }}
          >
            <dt style={{ color: "var(--ink-faint)" }}>Recording</dt>
            <dd style={{ margin: 0 }}>
              <span
                className={
                  "chip " +
                  ((isClan ? clan.recording_status : rec?.status) === "active"
                    ? "chip--ok"
                    : "chip--info")
                }
              >
                <span className="chip__dot" />
                {(isClan ? clan.recording_status : rec?.status) ?? "off"}
              </span>
            </dd>
            <dt style={{ color: "var(--ink-faint)" }}>How</dt>
            <dd style={{ margin: 0, color: "var(--ink-body)" }}>
              {isClan
                ? clan.scope === "comprehensive"
                  ? "comprehensive — clan every 15 min, river race, and every member's battles and profile"
                  : "activity — clan every 15 min, river race"
                : "battle log every 5–30 min while active · daily snapshot"}
            </dd>
            <dt style={{ color: "var(--ink-faint)" }}>Freshest poll</dt>
            <dd style={{ margin: 0, color: "var(--ink-body)" }}>
              {/* Never polled is not stale and not zero. */}
              {fresh == null ? "never polled" : ago(rec.freshest_poll, now)}
            </dd>
            <dt style={{ color: "var(--ink-faint)" }}>Fetches, 24h</dt>
            <dd
              style={{
                margin: 0,
                fontFamily: "var(--font-mono)",
                color: "var(--ink-body)",
              }}
            >
              {rec?.fetches_24h ?? "—"}
            </dd>
            <dt style={{ color: "var(--ink-faint)" }}>Tracked since</dt>
            <dd
              style={{
                margin: 0,
                fontFamily: "var(--font-mono)",
                color: "var(--ink-body)",
              }}
            >
              {(isClan ? clan.created_at : rec?.created_at)?.slice(0, 10) ??
                "—"}
            </dd>
          </dl>
        </section>
      </div>
    </>
  );
}
