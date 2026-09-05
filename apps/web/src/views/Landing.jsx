import { UPDATES } from "../updates.js";
import { useEffect, useState } from "react";
import { api } from "../api.js";

/** Home (design handoff §1): public proof. Hero + live counters,
 *  request access, how it works, what's new. The hero copy also lives
 *  in the crawlable bake — keep them in step. */
export function Landing({ authed, navigate }) {
  const [form, setForm] = useState({ email: "", player_tag: "", note: "" });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState(null);
  useEffect(() => {
    api.publicStats().then((r) => {
      if (r.ok) setStats(r.data);
    });
  }, []);
  const t = stats?.totals;
  const go = (to) => (e) => {
    e.preventDefault();
    navigate(to);
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "40px",
          alignItems: "flex-start",
          paddingTop: "24px",
        }}
      >
        <div style={{ flex: "1 1 480px", minWidth: 0 }}>
          <div className="eyebrow" style={{ marginBottom: "14px" }}>
            A CLASH ROYALE HISTORY RECORDER · REMOTE MCP SERVER
          </div>
          <h1 className="hero-title">Clash Royale history, recorded.</h1>
          <p className="lede" style={{ margin: "0 0 14px" }}>
            The official API only knows the present — a rotating ~30-battle log,
            no trophy timeline, no season history. Elixir MCP records your
            battles, progression, and clan life as they happen, and serves the
            history to <strong>your own AI agent</strong> over MCP. Your agent
            brings the brain; we bring the memory.
          </p>
          <p className="lede" style={{ margin: "0 0 20px" }}>
            Ask{" "}
            <em>
              &ldquo;what&rsquo;s my win rate since I swapped to
              Firecracker?&rdquo;
            </em>{" "}
            or <em>&ldquo;show my trophy graph this season&rdquo;</em> —
            questions the game itself cannot answer.
          </p>
          <div
            style={{
              display: "flex",
              gap: "10px",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {authed ? (
              <button
                className="btn"
                onClick={() => navigate("/account/overview")}
              >
                Your account →
              </button>
            ) : (
              <a
                className="btn btn--gold"
                href="#request"
                onClick={(e) => {
                  e.preventDefault();
                  document
                    .getElementById("request")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                Request access
              </a>
            )}
            <button
              className="btn btn--quiet"
              onClick={() => navigate("/data/dashboard")}
            >
              See the data →
            </button>
            <span style={{ fontSize: "12px", color: "var(--dim)" }}>
              approval-gated · free while in early access
            </span>
          </div>
        </div>

        <section
          className="panel"
          style={{ flex: "1 1 320px", maxWidth: "420px" }}
        >
          <div className="panel__head">
            <span
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--muted)",
              }}
            >
              The corpus, live
            </span>
            <span
              className="mono"
              style={{
                marginLeft: "auto",
                fontSize: "11px",
                color: "var(--faint)",
              }}
            >
              as of {t?.newest_battle?.slice(0, 10) ?? "…"}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            {[
              ["battles recorded", t?.battles],
              ["players observed", t?.players],
              ["clans observed", t?.clans],
              ["collectors active", t?.collectors_active],
            ].map(([label, v], i) => (
              <div
                key={label}
                style={{
                  padding: "16px",
                  borderRight:
                    i % 2 === 0 ? "1px solid var(--edge-soft)" : "none",
                  borderBottom: i < 2 ? "1px solid var(--edge-soft)" : "none",
                }}
              >
                <div className="stat__value" style={{ fontSize: "30px" }}>
                  {v?.toLocaleString() ?? "—"}
                </div>
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--faint)",
                    marginTop: "6px",
                  }}
                >
                  {label}
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              padding: "10px 16px",
              borderTop: "1px solid var(--edge-soft)",
              display: "flex",
              gap: "8px",
              alignItems: "center",
              fontSize: "12px",
              color: "var(--dim)",
              flexWrap: "wrap",
            }}
          >
            <span
              className="mono"
              style={{ color: "var(--muted)", fontSize: "11px" }}
            >
              oldest battle {t?.oldest_battle?.slice(0, 10) ?? "—"}
            </span>
            <span>·</span>
            <span>refreshed each deploy</span>
            <a style={{ marginLeft: "auto" }} onClick={go("/data/dashboard")}>
              Data ›
            </a>
          </div>
        </section>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "20px",
          marginTop: "48px",
        }}
      >
        {!authed && (
          <section className="panel" id="request">
            <div className="panel__head">
              <span className="panel-title">Request access</span>
            </div>
            <div
              className="panel__body"
              style={{ display: "flex", flexDirection: "column", gap: "10px" }}
            >
              {sent ? (
                <div className="notice">
                  If your request is approved, you&rsquo;ll hear from us by
                  email.
                </div>
              ) : (
                <>
                  <div style={{ fontSize: "12.5px", color: "var(--faint)" }}>
                    Access is invite-approved while the recorder grows. Tell us
                    who you are in the arena.
                  </div>
                  <form
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setError("");
                      const res = await api.requestAccess(form);
                      if (res.ok) setSent(true);
                      else
                        setError(
                          res.data.error === "invalid_tag"
                            ? "That doesn’t look like a CR tag."
                            : "Something went wrong — try again.",
                        );
                    }}
                  >
                    <label>
                      <span className="label">Email</span>
                      <input
                        type="email"
                        required
                        placeholder="you@example.com"
                        value={form.email}
                        onChange={(e) =>
                          setForm({ ...form, email: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span className="label">Your player tag</span>
                      <input
                        className="mono"
                        placeholder="#20JJJ2CCRU"
                        required
                        value={form.player_tag}
                        onChange={(e) =>
                          setForm({ ...form, player_tag: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span className="label">
                        Anything we should know?{" "}
                        <span style={{ color: "var(--dim)" }}>(optional)</span>
                      </span>
                      <input
                        value={form.note}
                        onChange={(e) =>
                          setForm({ ...form, note: e.target.value })
                        }
                      />
                    </label>
                    {error && <p className="field-error">{error}</p>}
                    <div>
                      <button className="btn btn--gold">Request access</button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </section>
        )}

        <section className="panel">
          <div className="panel__head">
            <span className="panel-title">How it works</span>
          </div>
          <div
            className="panel__body"
            style={{ display: "flex", flexDirection: "column", gap: "14px" }}
          >
            {[
              [
                "01",
                "Add your players and clans. Added means recorded — capture starts on the next poll and never stops.",
              ],
              [
                "02",
                "Connect your own AI agent over MCP. It sees your full recorded history with your entitlements applied.",
              ],
              [
                "03",
                "Ask it anything the game can't answer. Every number ships its sample size — observation, never opinion.",
              ],
            ].map(([n, body]) => (
              <div key={n} style={{ display: "flex", gap: "12px" }}>
                <span
                  className="mono"
                  style={{ color: "var(--purple-link)", fontWeight: 600 }}
                >
                  {n}
                </span>
                <span
                  style={{
                    fontSize: "12.5px",
                    color: "var(--muted)",
                    lineHeight: 1.55,
                  }}
                >
                  {body}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel__head">
            <span className="panel-title">What&rsquo;s new</span>
            <a
              className="mono"
              style={{ marginLeft: "auto", fontSize: "11px" }}
              onClick={go("/data/changelog")}
            >
              Changelog ›
            </a>
          </div>
          <div
            className="panel__body"
            style={{ display: "flex", flexDirection: "column", gap: "12px" }}
          >
            {UPDATES.slice(0, 4).map((u) => (
              <div key={u.title} style={{ display: "flex", gap: "12px" }}>
                <span
                  className="mono"
                  style={{
                    flex: "0 0 52px",
                    fontSize: "11px",
                    color: "var(--dim)",
                  }}
                >
                  {u.date.slice(5)}
                </span>
                <span style={{ fontSize: "12.5px", lineHeight: 1.5 }}>
                  <strong>{u.title}.</strong>{" "}
                  <span style={{ color: "var(--muted)" }}>
                    {u.body.length > 140 ? u.body.slice(0, 140) + "…" : u.body}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
