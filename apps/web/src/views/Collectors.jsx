import { useInitialTime, PageHead, Table, Empty } from "@elixir-mcp/ui";
import { agoExact, Icon, Link, secsSince } from "@elixir-mcp/ui";
import { useMyGateways, usePublicStatus } from "../lib/queries.js";
import {
  ReleaseKeyCard,
  SignatureBadge,
  signatureCounts,
} from "../components/ReleaseSignature.jsx";
import { ADMIN, SETTINGS } from "../lib/settings.js";

/**
 * Admin ▸ Fleet — the whole fleet (every member's under /console/status until
 * 2026-11-12; the public /data page credits each collector to its operator).
 *
 * Health and share are PUBLIC: a collector is named for its Clash Royale
 * card and credited to its operator, and anyone can see whether the
 * fleet is keeping up. Endpoint mix, errors and the machine label belong
 * to the operator and only appear on their own collectors.
 *
 * The two clocks are the point of the detail screen. A heartbeat is any
 * contact with the door, including a poll that found no work; data
 * freshness is the last payload we accepted. A fresh heartbeat with
 * stale data is an IDLE collector, not a broken one, and reading one
 * clock alone cannot tell you which.
 */
function StateChip({ collector, now }) {
  const beat = secsSince(collector.last_heartbeat_at, now);
  const tone =
    collector.status !== "active"
      ? "warn"
      : beat == null || beat > 600
        ? "warn"
        : "ok";
  const label =
    collector.status !== "active"
      ? collector.status
      : beat == null || beat > 600
        ? "behind"
        : "healthy";
  return (
    <span className={`chip chip--${tone}`}>
      <span className="chip__dot" />
      {label}
    </span>
  );
}

export function Fleet({ navigate }) {
  // Stamped once per load rather than read during render:
  // a clock read while rendering makes every re-render a new answer.
  const [now] = useInitialTime();
  const statusQuery = usePublicStatus();
  const status = statusQuery.data ?? null;
  const mine = useMyGateways().data?.gateways ?? null;

  // A failed read is said, not left loading (console audit M2).
  if (!status && statusQuery.isError)
    return (
      <p style={{ color: "var(--ink-faint)" }}>
        This could not be read just now; try again in a moment.
      </p>
    );
  if (!status) return <p style={{ color: "var(--ink-faint)" }}>Loading…</p>;

  const fleet = status.collectors ?? [];
  const todays = fleet.reduce((n, c) => n + (c.fetches_1h ?? 0), 0);
  const mineIds = new Set((mine ?? []).map((g) => g.card_name ?? g.name));
  const runsOne = (mine ?? []).length > 0;

  return (
    <>
      <div className="page__crumb">
        <Link to={`${ADMIN}/service`}>‹ Service</Link>
      </div>
      <PageHead
        title="Collectors"
        sub="Every machine fetching for the record, inside one shared budget."
        aside={
          <>
            {/* Raising a hand is the ONLY way a collector comes to exist, for
            anyone, any number of times (Jamie, 2026-09-11): it lives on
            its own page, and this is the door to it. Once you run one the
            door only changes its word. */}
            {mine !== null && (
              <button
                className="btn btn--primary"
                style={{ marginLeft: "auto" }}
                onClick={() => navigate(`${SETTINGS}/collectors/new`)}
              >
                <Icon name="plus" size={16} />
                {runsOne ? "Run another" : "Run a collector"}
              </button>
            )}
          </>
        }
      />

      {mine !== null && !runsOne && (
        <Empty
          title={<>You don&rsquo;t run one yet</>}
          style={{ maxWidth: "70ch", marginBottom: "18px" }}
        >
          A collector is a machine that fetches for the record on a schedule.
          While it is active it raises your limits to Family, and it wears a
          Clash Royale card of your choosing as its public name.
        </Empty>
      )}

      <ReleaseKeyCard counts={signatureCounts(fleet)} />

      <Table
        columns={[
          {
            head: "Name",
            cell: (c) => (
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                {c.card_icon && (
                  <img
                    src={c.card_icon}
                    alt=""
                    style={{ height: "22px", borderRadius: "3px" }}
                  />
                )}
                {/* Ownership is the one thing gold marks in a table:
                        the name of the one that is yours, with a quiet word
                        beside it — never a tinted row. */}
                <Link
                  style={{
                    fontWeight: 600,
                    color: mineIds.has(c.name) ? "var(--gold)" : undefined,
                  }}
                  to={`${SETTINGS}/collectors/${encodeURIComponent(c.name)}`}
                >
                  {c.name}
                </Link>
                {c.signature && <SignatureBadge state={c.signature} iconOnly />}
                {mineIds.has(c.name) && (
                  <span
                    style={{
                      color: "var(--ink-faint)",
                      fontSize: "11.5px",
                    }}
                  >
                    yours
                  </span>
                )}
              </span>
            ),
          },
          { head: "Run by", cell: (c) => c.operator ?? "—" },
          {
            head: "Yield",
            num: true,
            cellProps: () => ({
              title: "share of the last day's fetches that changed the record",
            }),
            cell: (c) =>
              typeof c.yield_24h === "number"
                ? `${Math.round(c.yield_24h * 100)}%`
                : "—",
          },
          {
            head: "Last fetch",
            cellProps: () => ({ title: "as of when this page loaded" }),
            cell: (c) => agoExact(c.last_success_at, now),
          },
          {
            head: "Share",
            num: true,
            cell: (c) =>
              todays > 0
                ? `${Math.round(((c.fetches_1h ?? 0) / todays) * 100)}%`
                : "—",
          },
          {
            head: "Version",
            cellProps: () => ({
              title: "the client version it last reported",
            }),
            cell: (c) => (
              <span className="version-cell">
                <span className="mono">{c.version ?? "—"}</span>
                {/* A hub from before 0184 sends no state: no badge
                        rather than a wrong one. */}
                {c.signature && <SignatureBadge state={c.signature} />}
              </span>
            ),
          },
          { head: "State", cell: (c) => <StateChip collector={c} now={now} /> },
        ]}
        rows={fleet}
        rowKey={(c) => c.name}
        minWidth={640}
      />
      <p
        className="footnote"
        style={{ margin: "12px 2px 0", maxWidth: "78ch" }}
      >
        Yield is the share of the last day&rsquo;s fetches that changed the
        record; share is of the last hour&rsquo;s fetches. Behind means the
        machine has not reported inside its schedule, which is not the same as
        broken: a collector with nothing due is idle.
      </p>
    </>
  );
}
