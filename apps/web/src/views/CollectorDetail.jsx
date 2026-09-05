import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Fresh } from "./Dashboard.jsx";

/** Account ▸ Collector (design handoff §10): deliberately small — the
 *  ladder is a joke, not a product. Per collector: avatar slot, status,
 *  points, a gold meter toward the next arena; beside it the
 *  raise-my-hand CTA. Arenas borrow the game's ladder for fun and mean
 *  nothing for the data. */

export function CollectorPage() {
  const [gateways, setGateways] = useState(null);
  const [ladder, setLadder] = useState([]);
  const [details, setDetails] = useState({});
  const [form, setForm] = useState({ name: "", static_ip: "" });
  const [raised, setRaised] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    const [mine, lad] = await Promise.all([
      api.myGateways(),
      api.gatewayLadder(),
    ]);
    if (mine.ok) {
      const gws = mine.data.gateways ?? [];
      setGateways(gws);
      for (const g of gws) {
        api
          .gatewayDetail(g.gateway_id)
          .then(
            (d) =>
              d.ok &&
              setDetails((prev) => ({ ...prev, [g.gateway_id]: d.data })),
          );
      }
    }
    if (lad.ok) setLadder(lad.data.ladder ?? []);
  };
  useEffect(() => {
    load();
  }, []);

  const total = ladder.length;

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Collector</h1>
        <span className="page-head__note">
          {total > 0
            ? `${total} are running for everyone right now — more collectors mean resilience, never a bigger rate budget.`
            : "more collectors mean resilience, never a bigger rate budget"}
        </span>
      </div>

      <div className="cols">
        <div className="cols__main">
          {gateways?.length === 0 && (
            <div className="empty">
              <div className="empty__mark">⚙</div>
              <div className="empty__title">You don&rsquo;t run one yet</div>
              <div className="empty__body">
                A collector is a machine with a static IP that fetches from the
                CR API for the whole service. Raise your hand →
              </div>
            </div>
          )}
          {(gateways ?? []).map((g) => {
            const d = details[g.gateway_id];
            const rank = ladder.findIndex((l) => l.name === g.name) + 1;
            const mine = ladder.find((l) => l.name === g.name);
            const daily = d?.daily ?? [];
            const max = Math.max(...daily.map((x) => x.fetches), 1);
            return (
              <section className="panel" key={g.gateway_id}>
                <div
                  className="panel__body"
                  style={{
                    display: "flex",
                    gap: "14px",
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    className="card-slot"
                    style={{
                      width: "44px",
                      borderRadius: "50%",
                      aspectRatio: "1",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <span
                      className="mono"
                      style={{ fontSize: "12px", color: "var(--dim)" }}
                    >
                      {g.name.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{g.name}</div>
                    <div
                      className="mono"
                      style={{ fontSize: "11.5px", color: "var(--dim)" }}
                    >
                      {mine?.card ?? "no card yet"}
                      {d?.gateway.last_seen_sha
                        ? ` · ${d.gateway.last_seen_sha.slice(0, 7)}`
                        : ""}
                    </div>
                  </div>
                  <span
                    className={`chip ${
                      g.status === "active"
                        ? "chip--active"
                        : g.status === "pending"
                          ? "chip--pending"
                          : ""
                    }`}
                  >
                    {g.status}
                  </span>
                  <Fresh ts={g.last_success_at} />
                  <div style={{ marginLeft: "auto", textAlign: "right" }}>
                    <div className="stat__value" style={{ fontSize: "22px" }}>
                      {Number(g.fetch_points ?? 0).toLocaleString()}
                    </div>
                    <div className="stat__sub">
                      lifetime points · {g.fetches_24h ?? 0} / 24h
                    </div>
                  </div>
                </div>
                {g.provision_ready && (
                  <div className="panel__body" style={{ paddingTop: 0 }}>
                    <div className="notice">
                      <span>
                        Your configuration is ready.{" "}
                        <button
                          className="btn--text"
                          onClick={async () => {
                            const r = await api.gatewayEnv(g.gateway_id);
                            if (!r.ok) return;
                            const blob = new Blob([r.data.env], {
                              type: "text/plain",
                            });
                            const a = document.createElement("a");
                            a.href = URL.createObjectURL(blob);
                            a.download = ".env";
                            a.click();
                            URL.revokeObjectURL(a.href);
                            load();
                          }}
                        >
                          Download .env (one time)
                        </button>{" "}
                        — it disappears from the server the moment you fetch it.
                        Add your own CR API key, then start the collector.
                      </span>
                    </div>
                  </div>
                )}
                {mine?.arena && (
                  <div
                    style={{
                      display: "flex",
                      gap: "12px",
                      alignItems: "center",
                      padding: "10px 16px",
                      borderTop: "1px solid var(--edge-soft)",
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      className="yours"
                      style={{ fontSize: "12.5px", fontWeight: 600 }}
                    >
                      {rank > 0
                        ? `${rank}${["st", "nd", "rd"][rank - 1] ?? "th"} of ${total}`
                        : ""}{" "}
                      · {mine.arena}
                    </span>
                    <div
                      className="meter meter--gold"
                      style={{ flex: "1 1 120px" }}
                    >
                      <div
                        className="meter__fill"
                        style={{
                          width: `${Math.min(100, ((g.fetch_points % 1000) / 1000) * 100)}%`,
                        }}
                      />
                    </div>
                    <span
                      className="mono"
                      style={{ fontSize: "11px", color: "var(--dim)" }}
                    >
                      {(1000 - (g.fetch_points % 1000)).toLocaleString()} to the
                      next arena
                    </span>
                  </div>
                )}
                {daily.length > 0 && (
                  <div className="chart">
                    <div className="chart__head">
                      <span className="stat__label">fetches / day · 30d</span>
                    </div>
                    <svg
                      viewBox="0 0 720 60"
                      role="img"
                      aria-label={`${g.name} fetches per day`}
                    >
                      {daily.map((x, i) => {
                        const bw = Math.max(2, 680 / daily.length - 2);
                        const h = Math.max(1, (x.fetches / max) * 52);
                        return (
                          <rect
                            key={x.day}
                            className="bar"
                            x={(i * 680) / daily.length}
                            y={56 - h}
                            width={bw}
                            height={h}
                          >
                            <title>{`${x.day}: ${x.fetches} fetches (${x.admitted} admitted, ${x.rejected} rejected)`}</title>
                          </rect>
                        );
                      })}
                    </svg>
                  </div>
                )}
                {d?.endpoints_7d?.length > 0 && (
                  <div className="panel__note">
                    last 7 days:{" "}
                    {d.endpoints_7d
                      .map((e) => `${e.endpoint} ${e.fetches.toLocaleString()}`)
                      .join(" · ")}
                    . Every 10 fetches earns +1 daily tool call on your quota.
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <div className="cols__rail">
          <section className="panel panel--cta">
            <div className="panel__head">
              <span className="panel-title">Run a collector</span>
            </div>
            <div
              className="panel__body"
              style={{ display: "flex", flexDirection: "column", gap: "10px" }}
            >
              {raised ? (
                <div className="notice">
                  Hand raised — the maintainer provisions your config, then it
                  appears here as a one-time download.
                </div>
              ) : (
                <>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "12.5px",
                      color: "var(--faint)",
                    }}
                  >
                    A machine that stays on, with a static public IP. One shared
                    rate budget — more machines for redundancy.
                  </p>
                  <label>
                    <span className="label">Collector name</span>
                    <input
                      placeholder="magic-pines"
                      value={form.name}
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    <span className="label">Static IP</span>
                    <input
                      className="mono"
                      placeholder="203.0.113.7"
                      value={form.static_ip}
                      onChange={(e) =>
                        setForm({ ...form, static_ip: e.target.value })
                      }
                    />
                  </label>
                  {err && <span className="field-error">{err}</span>}
                  <div>
                    <button
                      className="btn btn--gold"
                      onClick={async () => {
                        setErr("");
                        const r = await api.raiseGateway(
                          form.name.trim(),
                          form.static_ip.trim(),
                        );
                        if (r.ok) {
                          setRaised(true);
                          load();
                        } else setErr(r.data?.message ?? "Could not raise.");
                      }}
                    >
                      Raise my hand
                    </button>
                  </div>
                </>
              )}
            </div>
            <div className="panel__note">
              Arenas borrow the game&rsquo;s ladder for fun and mean nothing for
              the data.
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
