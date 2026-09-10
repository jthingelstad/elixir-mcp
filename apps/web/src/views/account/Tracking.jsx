import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { Fresh } from "../../components/Fresh.jsx";

/**
 * Tracking — the full table, and the only page that changes what we
 * record for you.
 *
 * Both halves of it lived on Overview until the 2026-09-09 design split
 * reading from doing. The tables come across unchanged; what moved is
 * where they are, and that Overview no longer carries a control.
 *
 * "Tracking", never "subjects": the product concept is a player or clan
 * with a relationship to you, not an assertion of identity.
 */
const TAG_OK = /^#?[0289PYLQGRJCUVOo]{3,12}$/;

function NickCell({ tag, current, refresh }) {
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const v = value.trim();
    if (v === (current ?? "")) return;
    setBusy(true);
    await api.explore("elixir_nickname", {
      player_tag: tag,
      nickname: v || null,
    });
    setBusy(false);
    refresh();
  };
  return (
    <input
      className="mono"
      value={value}
      placeholder="—"
      maxLength={40}
      disabled={busy}
      aria-label={`nickname for ${tag}`}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      style={{
        width: "7.5rem",
        padding: "3px 8px",
        fontSize: "12px",
        background: "transparent",
        borderColor: "transparent",
      }}
    />
  );
}

function Switch({ on, onToggle, label }) {
  return (
    <button
      className="switch"
      role="switch"
      aria-checked={on ? "true" : "false"}
      aria-label={label}
      onClick={onToggle}
    />
  );
}

export function Tracking({ me, refresh }) {
  const [tag, setTag] = useState("");
  const [tagErr, setTagErr] = useState("");
  const [clans, setClans] = useState(null);
  const [clanTag, setClanTag] = useState("");
  const [clanScope, setClanScope] = useState("comprehensive");
  const [clanErr, setClanErr] = useState("");

  const loadClans = () => api.myClans().then((r) => r.ok && setClans(r.data));
  useEffect(() => {
    loadClans();
  }, []);

  const recFor = (t) => me.recordings?.find((r) => r.subject_tag === t);
  const e = me.entitlements;

  return (
    <>
      <div style={{ marginBottom: "20px" }}>
        <h1 className="page__title">Tracking</h1>
        <p className="page__lede">
          Added means recorded. Capture starts on the next poll and never stops
          until you remove it.
        </p>
      </div>
      <section className="panel">
        <div className="panel__head">
          <span className="panel-title">Your players</span>
          {e && (
            <span className="sample">
              {e.player_slots.used} of {e.player_slots.limit ?? "∞"} slots
            </span>
          )}
        </div>
        {me.claims.length === 0 ? (
          <div className="panel__body">
            <div className="empty">
              <div className="empty__mark">＋</div>
              <div className="empty__title">No players added yet</div>
              <div className="empty__body">
                Added means recorded — capture starts on the next poll.
              </div>
            </div>
          </div>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>TAG</th>
                  <th>NAME</th>
                  <th>NICKNAME</th>
                  <th>CLAN</th>
                  <th>RECORDING</th>
                  <th>LAST POLL</th>
                  <th className="num">FETCHES/24H</th>
                  {/* 0055 added claim.relationship and the MCP identity
                      block groups by it -- but nothing could ever SET it,
                      so every non-primary player was announced to every
                      connected agent as "watching". This is the writer. */}
                  <th>RELATIONSHIP</th>
                  <th>NOTIFY</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {me.claims.map((c) => {
                  const rec = recFor(c.player_tag);
                  return (
                    <tr key={c.player_tag}>
                      <td>
                        {c.is_primary && <span className="yours">★ </span>}
                        <span className="tag">{c.player_tag}</span>
                      </td>
                      <td>{c.name ?? "—"}</td>
                      <td>
                        <NickCell
                          tag={c.player_tag}
                          current={c.nickname}
                          refresh={refresh}
                        />
                      </td>
                      <td>
                        {c.last_known_clan_tag ? (
                          <span className="tag">{c.last_known_clan_tag}</span>
                        ) : (
                          <span className="nil">—</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`chip ${rec?.status === "active" ? "chip--active" : ""}`}
                        >
                          {rec?.status ?? "off"}
                        </span>
                      </td>
                      <td>
                        <Fresh ts={rec?.freshest_poll} />
                      </td>
                      <td className="num">{rec?.fetches_24h ?? ""}</td>
                      <td>
                        {c.is_primary ? (
                          <span style={{ color: "var(--ink-faint)" }}>
                            primary
                          </span>
                        ) : (
                          <select
                            aria-label={`relationship for ${c.player_tag}`}
                            value={c.relationship ?? "watching"}
                            onChange={async (e) => {
                              await api.setRelationship(
                                c.player_tag,
                                e.target.value,
                              );
                              refresh();
                            }}
                          >
                            <option value="alt">alt</option>
                            <option value="friend">friend</option>
                            <option value="watching">watching</option>
                          </select>
                        )}
                      </td>
                      <td>
                        <Switch
                          on={c.notify}
                          label={`notify for ${c.player_tag}`}
                          onToggle={async () => {
                            await api.claimAction({
                              player_tag: c.player_tag,
                              action: c.notify ? "notify_off" : "notify_on",
                            });
                            refresh();
                          }}
                        />
                      </td>
                      <td>
                        <button
                          className="btn--text"
                          onClick={async () => {
                            await api.claimAction({
                              player_tag: c.player_tag,
                              action: "remove",
                            });
                            refresh();
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="panel__actions">
          <span style={{ fontSize: "12.5px", color: "var(--ink-faint)" }}>
            Add a player
          </span>
          <input
            id="add-player-tag"
            aria-label="Player tag"
            className="mono"
            placeholder="#20JJJ2CCRU"
            aria-invalid={tagErr ? "true" : undefined}
            value={tag}
            onChange={(e2) => {
              setTag(e2.target.value);
              setTagErr("");
            }}
            style={{ flex: "0 1 180px" }}
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
            Add
          </button>
          {tagErr && <span className="field-error">{tagErr}</span>}
          <span
            style={{
              marginLeft: "auto",
              fontSize: "12px",
              color: "var(--ink-faint)",
            }}
          >
            added = recorded
          </span>
        </div>
      </section>
      <section className="panel">
        <div className="panel__head">
          <span className="panel-title">Your clans</span>
          {/* Guard the SHAPE, not just the presence. `clans &&` only says
              the request came back; a 200 whose body is missing `slots`
              is still truthy, and reading through it threw -- which,
              before the error boundary, took the whole page with it. */}
          {clans?.slots && (
            <span className="sample">
              activity {clans.slots.activity?.used ?? 0}/
              {clans.slots.activity?.limit ?? "∞"} · comprehensive{" "}
              {clans.slots.comprehensive?.used ?? 0}/
              {clans.slots.comprehensive?.limit ?? "∞"}
            </span>
          )}
        </div>
        {clans?.home_clan &&
          !clans.clans.some((c) => c.clan_tag === clans.home_clan.clan_tag) && (
            <div className="panel__body" style={{ paddingBottom: 0 }}>
              <div className="notice">
                <span>
                  <span className="yours">★</span> Your clan:{" "}
                  <strong>{clans.home_clan.name ?? "—"}</strong>{" "}
                  <span className="tag">{clans.home_clan.clan_tag}</span>{" "}
                  <button
                    className="btn--text"
                    onClick={async () => {
                      await api.myClanAction({
                        action: "add",
                        clan_tag: clans.home_clan.clan_tag,
                        scope: "comprehensive",
                      });
                      loadClans();
                    }}
                  >
                    Add comprehensive
                  </button>
                  <button
                    className="btn--text"
                    onClick={async () => {
                      await api.myClanAction({
                        action: "add",
                        clan_tag: clans.home_clan.clan_tag,
                        scope: "activity",
                      });
                      loadClans();
                    }}
                  >
                    Add activity
                  </button>
                </span>
              </div>
            </div>
          )}
        {clans?.clans?.length > 0 && (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>CLAN</th>
                  <th>TAG</th>
                  <th>SCOPE</th>
                  <th>RECORDING</th>
                  <th>NOTIFY</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {clans.clans.map((c) => (
                  <tr key={c.clan_tag}>
                    <td>
                      {clans.home_clan?.clan_tag === c.clan_tag && (
                        <span className="yours">★ </span>
                      )}
                      {c.name ?? "—"}
                    </td>
                    <td>
                      <span className="tag">{c.clan_tag}</span>
                    </td>
                    <td>
                      <span className="tag-chip">
                        {c.scope}
                        {c.effective_scope && c.effective_scope !== c.scope
                          ? " †"
                          : ""}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`chip ${c.recording_status === "active" ? "chip--active" : ""}`}
                      >
                        {c.recording_status ?? "off"}
                      </span>
                    </td>
                    <td>
                      <Switch
                        on={c.notify}
                        label={`notify for ${c.clan_tag}`}
                        onToggle={async () => {
                          await api.myClanAction({
                            clan_tag: c.clan_tag,
                            action: c.notify ? "notify_off" : "notify_on",
                          });
                          loadClans();
                        }}
                      />
                    </td>
                    <td>
                      <button
                        className="btn--text"
                        onClick={async () => {
                          await api.myClanAction({
                            clan_tag: c.clan_tag,
                            action: "remove",
                          });
                          loadClans();
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="panel__actions">
          <span style={{ fontSize: "12.5px", color: "var(--ink-faint)" }}>
            Add a clan
          </span>
          <input
            className="mono"
            placeholder="#CLANTAG"
            value={clanTag}
            onChange={(e2) => {
              setClanTag(e2.target.value);
              setClanErr("");
            }}
            style={{ flex: "0 1 150px" }}
          />
          <select
            value={clanScope}
            onChange={(e2) => setClanScope(e2.target.value)}
            style={{ width: "auto" }}
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
            Add
          </button>
          {clanErr && <span className="field-error">{clanErr}</span>}
        </div>
        {clans?.clans?.some(
          (c) => c.effective_scope && c.effective_scope !== c.scope,
        ) && (
          <div className="panel__note">
            † another account records this clan comprehensively — the shared
            recording runs at the widest scope anyone requested.
          </div>
        )}
      </section>
    </>
  );
}
