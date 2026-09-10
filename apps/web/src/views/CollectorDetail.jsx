import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";
import { Icon } from "../components/Icon.jsx";
import { ago, secsSince, beatCls } from "../lib/time.js";

/**
 * One collector.
 *
 * TWO CLOCKS, always both. Heartbeat is any contact with the door,
 * including a poll that found no work. Data freshness is the last
 * payload we accepted and recorded. A fresh heartbeat with stale data is
 * an IDLE collector — nothing was due — and an operator reading either
 * clock alone cannot tell idle from broken.
 *
 * Health and share are public, because the fleet's ability to keep up is
 * everyone's business. The machine label, the endpoint mix, the errors
 * and the token belong to the operator: the public name is the Clash
 * Royale card, and the machine name never leaves the owner's surfaces.
 */
function Clocks({ heartbeat, data, now }) {
  const beat = secsSince(heartbeat, now);
  const fresh = secsSince(data, now);
  // Alive on the door, but nothing admitted for a while: the machine is
  // polling and finding no work. Both windows are the same ten minutes
  // the fleet uses to call a collector "behind".
  const idle = beat != null && beat < 600 && fresh != null && fresh > 600;
  return (
    <section className="panel" style={{ marginBottom: "14px" }}>
      <div className="panel__head">Two clocks</div>
      <div
        style={{
          padding: "14px 16px",
          display: "flex",
          gap: "26px",
          flexWrap: "wrap",
          alignItems: "flex-start",
        }}
      >
        <span>
          <span
            className="label"
            style={{ display: "block", marginBottom: "5px" }}
          >
            heartbeat
          </span>
          {/* Judged on its own scale: a collector touches the door every
              few seconds and its watchdog exits after five minutes
              without a round trip, so a heartbeat older than that means
              the process is gone rather than idle. */}
          <span
            className={`mono ${beatCls(beat)}`}
            style={{ display: "block", fontSize: "15px" }}
          >
            {ago(heartbeat, now)}
          </span>
        </span>
        <span>
          <span
            className="label"
            style={{ display: "block", marginBottom: "5px" }}
          >
            data freshness
          </span>
          <span
            className="mono"
            style={{ display: "block", fontSize: "15px", color: "var(--ink)" }}
          >
            {ago(data, now)}
          </span>
        </span>
        <span
          style={{
            flex: "1 1 240px",
            fontSize: "12.5px",
            color: "var(--ink-faint)",
            textWrap: "pretty",
          }}
        >
          {idle
            ? "Polling happily with nothing to fetch — that is idle, not broken."
            : "Both clocks matter: a fresh heartbeat only says the machine is alive."}
        </span>
      </div>
    </section>
  );
}

/** Fetches per hour over the last day. Inline bars, no library — the
 *  same approach the capture charts use. A day with no fetches is a real
 *  zero on the axis, not a gap to compress. */
function Hours({ daily }) {
  const rows = (daily ?? []).slice(-30);
  const max = Math.max(...rows.map((d) => d.fetches), 1);
  if (rows.length === 0) return null;
  return (
    <section className="panel" style={{ marginBottom: "14px" }}>
      <div className="panel__head">
        <span>Fetches per day</span>
        <span
          className="footnote"
          style={{ marginLeft: "auto", fontWeight: 400 }}
        >
          last {rows.length} days · UTC
        </span>
      </div>
      <div
        style={{
          padding: "18px 16px",
          display: "flex",
          alignItems: "flex-end",
          gap: "4px",
          height: "104px",
        }}
      >
        {rows.map((d) => (
          <span
            key={d.day}
            title={`${d.day} · ${d.fetches} fetches${d.rejected ? `, ${d.rejected} rejected` : ""}`}
            style={{
              flex: "1 1 0",
              height: `${Math.max(2, (d.fetches / max) * 100)}%`,
              background: "var(--accent)",
              borderRadius: "3px 3px 0 0",
              minWidth: "4px",
            }}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * What an admin may do to this collector, on the collector's own page.
 *
 * Lifecycle is forward-only — pending → probation → active → draining →
 * probation — so exactly one move is offered, named for what it does.
 * Provisioning stages a token server-side for the operator's one-time
 * reveal, which is why it reports rather than silently refreshing.
 */
function Operations({ g, staged, setStaged, reload }) {
  const next = {
    pending: "probation",
    probation: "activate",
    active: "drain",
    draining: "probation",
  }[g.status];
  // Draining goes BACK to probation: it has been active, and the word
  // says so. Pending goes forward into it.
  const label = {
    probation:
      g.status === "draining" ? "Back to probation" : "Put on probation",
    activate: "Activate",
    drain: "Drain",
  }[next];

  return (
    <section className="panel" style={{ marginBottom: "14px" }}>
      <div className="panel__head">
        <span className="panel-title">Operations</span>
        <span className="caveat" style={{ marginLeft: "auto" }}>
          admin
        </span>
      </div>
      <dl className="fields" style={{ margin: 0 }}>
        <dt>machine</dt>
        <dd className="mono">{g.name}</dd>
        <dt>state</dt>
        <dd>{g.status}</dd>
        <dt>channel</dt>
        <dd>{g.channel ?? "bulk"}</dd>
        <dt>points</dt>
        <dd className="mono">{Number(g.fetch_points ?? 0).toLocaleString()}</dd>
        <dt>version</dt>
        <dd className="mono">{g.last_seen_sha ?? "—"}</dd>
      </dl>
      <div
        style={{
          padding: "12px 16px",
          display: "flex",
          gap: "10px",
          alignItems: "center",
          flexWrap: "wrap",
          borderTop: "1px solid var(--line-soft)",
        }}
      >
        {next && (
          <button
            className="btn btn--sm"
            onClick={async () => {
              await api.adminGatewayAction(g.gateway_id, next);
              reload();
            }}
          >
            {label ?? next}
          </button>
        )}
        {g.status !== "revoked" && (
          <button
            className="btn btn--sm"
            onClick={async () => {
              const r = await api.adminGatewayAction(
                g.gateway_id,
                "provision_token",
              );
              setStaged(
                r.ok
                  ? { ok: true }
                  : { error: r.data?.error ?? `HTTP ${r.status}` },
              );
              reload();
            }}
          >
            Stage a token
          </button>
        )}
        {staged?.ok && (
          <span className="caveat">
            Token staged — the operator reveals it once, on their own page.
          </span>
        )}
        {staged?.error && (
          <span className="field-error" style={{ margin: 0 }}>
            {staged.error}
          </span>
        )}
      </div>
    </section>
  );
}

export function CollectorPage({ id, navigate, me }) {
  // Stamped once per load rather than read during render:
  // a clock read while rendering makes every re-render a new answer.
  const [now] = useState(() => Date.now());
  const [status, setStatus] = useState(null);
  const [mine, setMine] = useState(null);
  const [detail, setDetail] = useState(null);
  const [revealed, setRevealed] = useState("");
  // The admin row for this collector, when the reader is one. The fleet
  // list used to carry ten columns and every action inline; the actions
  // live here now, on the record, where what you are acting on is on
  // screen (2026-09-10).
  const [fleet, setFleet] = useState(null);
  const [staged, setStaged] = useState(null);

  const loadFleet = useCallback(() => {
    if (!me?.is_admin) return;
    api.adminGateways().then((r) => r.ok && setFleet(r.data.gateways ?? []));
  }, [me?.is_admin]);

  useEffect(() => {
    api.publicStatus().then((r) => r.ok && setStatus(r.data));
    api.myGateways().then((r) => r.ok && setMine(r.data.gateways ?? []));
    loadFleet();
  }, [loadFleet]);

  const name = id ? decodeURIComponent(id) : null;
  const pub = status?.collectors?.find((c) => c.name === name);
  const own = (mine ?? []).find((g) => (g.card_name ?? g.name) === name);
  const admin = (fleet ?? []).find((g) => (g.card_name ?? g.name) === name);

  useEffect(() => {
    if (own && !detail)
      api.gatewayDetail(own.gateway_id).then((r) => r.ok && setDetail(r.data));
  }, [own, detail]);

  if (!status || mine === null)
    return <p style={{ color: "var(--ink-faint)" }}>Loading…</p>;

  if (!pub && !own)
    return (
      <>
        <div className="page__crumb">
          <a onClick={() => navigate("/status/collectors")}>‹ Collectors</a>
        </div>
        <div className="empty">
          <div className="empty__title">No collector by that name</div>
          <p className="empty__body" style={{ marginBottom: 0 }}>
            Collectors are named for a Clash Royale card. A drained one keeps
            its name and its points, but stops appearing in the fleet.
          </p>
        </div>
      </>
    );

  const beat = secsSince(pub?.last_heartbeat_at, now);
  const status_ = pub?.status ?? own?.status ?? "unknown";
  const behind = status_ === "active" && (beat == null || beat > 600);
  const tone = status_ !== "active" ? "warn" : behind ? "warn" : "ok";
  const points = Number(
    own?.fetch_points ?? detail?.gateway?.fetch_points ?? 0,
  );
  const env = revealed
    ? `CR_API_TOKEN=your-clash-royale-key\nELIXIR_API_TOKEN=${revealed}`
    : "";

  return (
    <>
      <div className="page__crumb">
        <a onClick={() => navigate("/status/collectors")}>‹ Collectors</a>
      </div>
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
            {own ? "Yours" : `Run by ${pub?.operator ?? "an operator"}`}
            {own ? ` · ${own.name}` : ""}
            {detail?.gateway?.last_seen_sha
              ? ` · ${detail.gateway.last_seen_sha.slice(0, 7)}`
              : ""}
          </p>
        </div>
        <span className={`chip chip--${tone}`} style={{ marginLeft: "auto" }}>
          <span className="chip__dot" />
          {status_ !== "active" ? status_ : behind ? "behind" : "healthy"} ·
          last {ago(pub?.last_success_at ?? own?.last_success_at, now)}
        </span>
      </div>

      {admin && (
        <Operations
          g={admin}
          staged={staged}
          setStaged={setStaged}
          reload={loadFleet}
        />
      )}

      {own && (
        <div className="stats" style={{ marginBottom: "14px" }}>
          <div className="stats__cell">
            <div className="label">points</div>
            <div className="stats__value">{points.toLocaleString()}</div>
            <div className="stats__note">one per admitted fetch, lifetime</div>
          </div>
          <div className="stats__cell">
            <div className="label">credits</div>
            <div className="stats__value">
              {Number(own.credits ?? Math.floor(points / 10)).toLocaleString()}
            </div>
            <div className="stats__note">
              extra daily calls earned — 10 fetches buys one
            </div>
          </div>
          <div className="stats__cell">
            <div className="label">fetches</div>
            <div className="stats__value">
              {Number(own.fetches_24h ?? pub?.fetches_1h ?? 0).toLocaleString()}
            </div>
            <div className="stats__note">
              {own.fetches_24h != null ? "last 24 hours" : "last hour"}
            </div>
          </div>
        </div>
      )}

      {status_ === "draining" && (
        <div className="callout callout--warn" style={{ marginBottom: "14px" }}>
          <Icon name="circle-dashed" size={17} />
          <span>
            Draining — it keeps its points and its place. Bring it back with
            probation once the machine is reachable.
          </span>
        </div>
      )}

      <Clocks
        heartbeat={pub?.last_heartbeat_at}
        data={pub?.last_success_at ?? own?.last_success_at}
        now={now}
      />

      {own?.provision_ready && !revealed && (
        <section
          className="panel"
          style={{ marginBottom: "14px", borderColor: "var(--line-strong)" }}
        >
          <div className="panel__head">
            <span>Collector token</span>
            <span
              className="footnote"
              style={{ marginLeft: "auto", fontWeight: 400 }}
            >
              staged, waiting for you
            </span>
          </div>
          <div
            style={{
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              gap: "14px",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: "13.5px",
                color: "var(--ink-dim)",
                maxWidth: "52ch",
                textWrap: "pretty",
              }}
            >
              We show it once and never again — reveal it when you are at the
              machine.
            </span>
            <button
              className="btn btn--selected"
              style={{ marginLeft: "auto" }}
              onClick={async () => {
                const r = await api.gatewayEnv(own.gateway_id);
                if (r.ok) setRevealed(r.data.env.trim());
              }}
            >
              Reveal once
            </button>
          </div>
        </section>
      )}

      {revealed && (
        <section className="code" style={{ marginBottom: "14px" }}>
          <div className="code__head">
            <span className="label">collector token</span>
            <span className="footnote">
              shown once — it is gone from us now
            </span>
            <button
              className="btn btn--sm"
              style={{ marginLeft: "auto" }}
              onClick={() => navigator.clipboard?.writeText(env)}
            >
              Copy
            </button>
          </div>
          <pre className="code__body">{env}</pre>
          <div className="panel__foot">
            Paste it into the collector&rsquo;s <code>.env</code> with your own
            Clash Royale key beside it. We kept only its hash; if you lose it,
            ask the owner to re-provision, which invalidates this one.
          </div>
        </section>
      )}

      {own && <Hours daily={detail?.daily} />}

      {own ? (
        detail?.endpoints_7d?.length > 0 && (
          <section className="panel">
            <div className="panel__head">What it fetched</div>
            <div style={{ padding: "6px 0" }}>
              {detail.endpoints_7d.map((e) => {
                const top = Math.max(
                  ...detail.endpoints_7d.map((x) => x.fetches),
                  1,
                );
                return (
                  <div
                    key={e.endpoint}
                    style={{
                      padding: "10px 16px",
                      display: "flex",
                      alignItems: "center",
                      gap: "14px",
                    }}
                  >
                    <span
                      className="mono"
                      style={{
                        flex: "0 0 128px",
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: "var(--ink-body)",
                      }}
                    >
                      {e.endpoint}
                    </span>
                    <span className="meter" style={{ flex: "1 1 auto" }}>
                      <span
                        className="meter__fill"
                        style={{
                          display: "block",
                          width: `${(e.fetches / top) * 100}%`,
                        }}
                      />
                    </span>
                    <span
                      className="mono"
                      style={{
                        flex: "0 0 60px",
                        textAlign: "right",
                        color: "var(--ink)",
                      }}
                    >
                      {e.fetches.toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="panel__foot">
              Seven days. The server chooses what each collector fetches; a
              collector never picks its own targets.
            </div>
          </section>
        )
      ) : (
        <section className="panel">
          <div className="panel__body" style={{ color: "var(--ink-dim)" }}>
            Health and share are public. Endpoint mix, errors and the machine
            label belong to the operator.
          </div>
        </section>
      )}
    </>
  );
}
