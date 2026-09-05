import { useEffect, useState } from "react";
import { api } from "../api.js";

/** Account ▸ Collector: what YOUR machines have done (SITE-IA). One
 *  block per owned gateway — 30-day fetch series, 7-day endpoint mix,
 *  points, version, status. The raise-a-hand flow lives above this in
 *  the same page. */
export function CollectorDetail() {
  const [gateways, setGateways] = useState(null);
  const [details, setDetails] = useState({});

  useEffect(() => {
    api.myGateways().then(async (r) => {
      if (!r.ok) return;
      const gws = r.data.gateways ?? [];
      setGateways(gws);
      for (const g of gws) {
        const d = await api.gatewayDetail(g.gateway_id);
        if (d.ok) setDetails((prev) => ({ ...prev, [g.gateway_id]: d.data }));
      }
    });
  }, []);

  if (gateways === null || gateways.length === 0) return null;
  return (
    <>
      {gateways.map((g) => {
        const d = details[g.gateway_id];
        const daily = d?.daily ?? [];
        const max = Math.max(...daily.map((x) => x.fetches), 1);
        return (
          <div className="panel" key={g.gateway_id}>
            <h3>Collector: {g.name}</h3>
            {g.provision_ready && (
              <p className="notice">
                Your configuration is ready.{" "}
                <button
                  className="quiet"
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
                  }}
                >
                  Download .env (one time)
                </button>{" "}
                It disappears from the server the moment you fetch it — add your
                own CR API key to the file, then start the collector.
              </p>
            )}
            <p className="fine">
              id <code>{g.gateway_id}</code> · status{" "}
              <span className={`status ${g.status}`}>{g.status}</span>
              {" · "}
              {Number(d?.gateway.fetch_points ?? 0).toLocaleString()} points
              {" · last success "}
              {d?.gateway.last_success_at
                ? new Date(d.gateway.last_success_at).toLocaleString()
                : "never"}
              {d?.gateway.last_seen_sha
                ? ` · version ${d.gateway.last_seen_sha.slice(0, 7)}`
                : ""}
            </p>
            {daily.length > 0 && (
              <figure style={{ margin: "0.5rem 0" }}>
                <svg
                  viewBox={`0 0 640 90`}
                  role="img"
                  aria-label={`${g.name} fetches per day, 30 days`}
                  style={{ width: "100%", height: "auto", display: "block" }}
                >
                  {daily.map((x, i) => {
                    const bw = Math.max(2, Math.floor(640 / daily.length) - 2);
                    const h = Math.max(1, Math.round((x.fetches / max) * 84));
                    return (
                      <rect
                        key={x.day}
                        x={i * (bw + 2)}
                        y={90 - h}
                        width={bw}
                        height={h}
                        fill="var(--purple, #6d28d9)"
                      >
                        <title>{`${x.day}: ${x.fetches} fetches (${x.admitted} admitted, ${x.rejected} rejected)`}</title>
                      </rect>
                    );
                  })}
                </svg>
                <figcaption className="fine">
                  Fetches per day, last 30 — peak {max.toLocaleString()}. Every
                  10 fetches earns +1 daily tool call on your quota.
                </figcaption>
              </figure>
            )}
            {d?.endpoints_7d?.length > 0 && (
              <p className="fine">
                Last 7 days by endpoint:{" "}
                {d.endpoints_7d
                  .map((e) => `${e.endpoint} ${e.fetches.toLocaleString()}`)
                  .join(" · ")}
              </p>
            )}
          </div>
        );
      })}
    </>
  );
}
