import {
  Fresh,
  ago,
  Tag,
  useClock,
  Empty,
  PageHead,
  Table,
} from "@elixir-mcp/ui";
import { useState } from "react";
import { useHistory, useManage } from "../lib/queries.js";
import { MemberSheet } from "../components/MemberSheet.jsx";
import { ActionLog, CopyLine } from "../components/ActionCard.jsx";
import { RoleChip } from "../components/RoleChip.jsx";
import { Policy } from "./Policy.jsx";
import { Scout } from "./Scout.jsx";
import { Awards } from "./Awards.jsx";
import { Settings } from "./Settings.jsx";
import { TooFew } from "../components/TooFew.jsx";
import { CLAN, clanPath } from "../lib/base.js";

const TITLES = {
  board: "Member review",
  history: "Decisions",
  policy: "Policy",
  awards: "Awards",
  scout: "Scout",
  settings: "Clan settings",
  model: "Clan settings",
};

const BUCKET_LABEL = {
  actionable: "Actionable",
  building: "Building",
  held: "Waiting on the record",
  clear: "Clear",
};
const REMOVAL_LABEL = {
  protected: "Protected",
  not_candidate: "Not currently a removal candidate",
  evidence_held: "Waiting on the record",
  eligible: "Eligible",
};

/** Manage: leader and co-leader only (the API refuses everyone else). */
export function Manage({ clan, tab, navigate, who }) {
  const { whenDay, calendar } = useClock();
  const [open, setOpen] = useState(null); // member sheet
  // The judged board, read for every tab but the ones that read their
  // own thing.
  const { state, load, query } = useManage(
    clan.clan_tag,
    !["policy", "scout", "awards", "settings", "model"].includes(tab),
  );

  if (state.signedOut) {
    window.location.assign(`${CLAN}?error=session_expired`);
    return null;
  }
  const head = (
    <PageHead
      title={TITLES[tab] ?? "Manage"}
      aside={
        <>
          <span className="chip">
            <span className="yours">★</span>{" "}
            {clan.acting_as_name ?? <Tag tag={clan.acting_as} />}
            <span style={{ color: "var(--ink-faint)" }}>·</span>
            <RoleChip role={clan.role} label={clan.role_label} />
            <span style={{ color: "var(--ink-faint)" }}>·</span>
            {clan.name ?? <Tag tag={clan.clan_tag} />}
          </span>
          {state.data ? (
            <Fresh
              label="as of"
              seconds={state.data.freshness_seconds}
              ts={state.data.as_of}
            />
          ) : null}
        </>
      }
    />
  );
  // The rail carries the sections now (2026-09-12); nothing to repeat here.
  const tabs = null;
  if (tab === "policy")
    return (
      <>
        {head}
        {tabs}
        <Policy clan={clan} />
      </>
    );
  if (tab === "scout")
    return (
      <>
        {head}
        {tabs}
        <Scout clan={clan} />
      </>
    );
  // The clan's model moved into clan settings; its old address lands there.
  if (tab === "settings" || tab === "model")
    return (
      <>
        {head}
        <Settings clan={clan} />
      </>
    );
  if (tab === "awards")
    return (
      <>
        {head}
        {tabs}
        <Awards clan={clan} />
      </>
    );
  if (state.forbidden)
    return (
      <>
        {head}
        <div className="callout callout--warn" role="alert">
          <span>Manage is for the leader and co-leaders.</span>
        </div>
      </>
    );
  if (state.error === "too_few_members") {
    const d = query.data?.data ?? {};
    return (
      <>
        {head}
        <TooFew members={d.members} min={d.min_members} />
      </>
    );
  }
  if (state.error === "no_policy")
    return (
      <>
        {head}
        <Empty title="No policy yet">
          Nothing in clan management runs until a leader or co-leader sets this
          clan&rsquo;s policy.{" "}
          <a
            href={`${clanPath(clan.clan_tag)}/manage/policy`}
            onClick={(e) => {
              e.preventDefault();
              navigate(`${clanPath(clan.clan_tag)}/manage/policy`);
            }}
          >
            Set up the policy
          </a>
        </Empty>
      </>
    );
  if (state.error)
    return (
      <>
        {head}
        {tabs}
        <div className="callout callout--warn" role="alert">
          <span>
            {state.error === "clan_not_recorded"
              ? "Elixir is not recording this clan yet, so there is nothing to judge."
              : "Elixir did not answer. Try again in a minute."}
          </span>
        </div>
      </>
    );
  if (!state.data)
    return (
      <>
        {head}
        {tabs}
        <p className="page__lede">Reading the record and judging the roster…</p>
      </>
    );
  const d = state.data;
  const evidenceLine = (
    <p className="page-head__note" style={{ margin: "0 0 14px" }}>
      Worked out {ago(d.evaluated_at)} under policy v{d.policy_version}
      {d.boundaries.length
        ? ` over ${d.boundaries.length} weekly reviews (last ${whenDay(d.boundaries.at(-1))})`
        : " with no closed weekly review on record yet"}
      {d.recording_active_since
        ? ` · recording since ${whenDay(d.recording_active_since)}`
        : ""}
      {" · "}
      <button
        type="button"
        className="btn--text"
        onClick={() => load(true)}
        disabled={state.loading}
      >
        {state.loading ? "reading…" : "re-judge now"}
      </button>
    </p>
  );
  const sheet = (m) =>
    open === m.player_tag ? (
      <MemberSheet
        clanTag={clan.clan_tag}
        member={m}
        role={who.role}
        onChange={() => load(true)}
      />
    ) : null;

  if (tab === "history")
    return (
      <>
        {head}
        {tabs}
        <History clan={clan} navigate={navigate} />
      </>
    );
  return (
    <>
      {head}
      {tabs}
      {evidenceLine}
      <BandLine band={d.band} roster={d.roster} />
      {d.policy?.ranks_elder ? (
        <p
          className="page-head__note"
          aria-label="Elder, waiting on the record"
        >
          Elder, waiting on the record: Promotion{" "}
          {
            d.board.filter((m) =>
              ["held", "unknown"].includes(m.judgment.promotion),
            ).length
          }
          {" · "}Demotion{" "}
          {
            d.board.filter((m) =>
              ["held", "unknown"].includes(m.judgment.demotion),
            ).length
          }
          . A member can have held evidence for more than one kind of action.
        </p>
      ) : null}
      {d.policy?.removal ? (
        <p className="page-head__note" aria-label="Removal triage">
          Removal:{" "}
          {Object.entries(REMOVAL_LABEL)
            .map(
              ([status, label]) =>
                `${label} ${d.board.filter((m) => m.removal.triage?.status === status).length}`,
            )
            .join(" · ")}
        </p>
      ) : null}
      <nav aria-label="Board groups" className="mb-4 flex flex-wrap gap-2">
        {Object.entries(BUCKET_LABEL).map(([bucket, label]) => {
          const count = d.board.filter((m) => m.bucket === bucket).length;
          return count ? (
            <a key={bucket} className="chip" href={`#board-${bucket}`}>
              {label} · {count}
            </a>
          ) : null;
        })}
      </nav>
      <p className="page-head__note lg:hidden">
        Scroll a member table sideways to see every column.
      </p>
      {["actionable", "building", "held", "clear"].map((bucket) => {
        const rows = d.board.filter((m) => m.bucket === bucket);
        if (!rows.length) return null;
        return (
          <section
            key={bucket}
            id={`board-${bucket}`}
            aria-labelledby={`board-${bucket}-title`}
            className="mb-6 scroll-mt-4"
          >
            <h2 id={`board-${bucket}-title`} className="label mb-2">
              {BUCKET_LABEL[bucket]} · {rows.length}
            </h2>
            <Table
              region={`${BUCKET_LABEL[bucket]} members`}
              columns={[
                {
                  head: "Member",
                  wrap: true,
                  headClassName: "w-1/5",
                  cell: (m) => (
                    <>
                      <button
                        type="button"
                        className="btn--text"
                        aria-expanded={open === m.player_tag}
                        onClick={() =>
                          setOpen(open === m.player_tag ? null : m.player_tag)
                        }
                      >
                        {m.name ?? <Tag tag={m.player_tag} />}
                      </button>{" "}
                      <span className="tag block">{m.player_tag}</span>
                      {m.hold?.active !== false && m.hold ? (
                        <span
                          className="chip chip--info"
                          style={{ marginLeft: "6px" }}
                          title={m.hold.note ?? undefined}
                        >
                          {m.hold.kind === "away" ? "away" : "hold"}
                          {m.hold.until ? ` · ${calendar(m.hold.until)}` : ""}
                        </span>
                      ) : null}
                    </>
                  ),
                },
                {
                  head: "Role",
                  headClassName: "w-[14%]",
                  cell: (m) => <RoleChip role={m.role} label={m.role} />,
                },
                ...(d.policy?.ranks_elder
                  ? [
                      {
                        head: "Elder",
                        wrap: true,
                        headClassName: "w-[14%]",
                        cell: (m) => elderCell(m),
                      },
                    ]
                  : []),
                ...(d.policy?.removal
                  ? [
                      {
                        head: "Removal",
                        wrap: true,
                        headClassName: "w-[18%]",
                        cell: (m) => removalCell(m),
                      },
                    ]
                  : []),
                {
                  head: "Evidence",
                  wrap: true,
                  headClassName: "w-[17%]",
                  cell: (m) => m.phrase || <span className="nil">—</span>,
                },
                { head: "Judgment", wrap: true, cell: (m) => judgmentCell(m) },
              ]}
              rows={rows}
              rowKey={(m) => m.player_tag}
              rowProps={(m) => ({
                "data-you":
                  m.player_tag === who.player_tag ? "true" : undefined,
              })}
              rowAfter={(m) => (open === m.player_tag ? sheet(m) : null)}
              className="table-fixed"
              minWidth={760}
            />
          </section>
        );
      })}
    </>
  );
}

function BandLine({ band, roster }) {
  if (!band)
    return roster ? (
      <p className="page-head__note mt-0 mb-4">
        Roster {roster.size} ({roster.open_slots} open) · Elders are chosen by
        the leaders
      </p>
    ) : null;
  return (
    <p className="page-head__note" style={{ margin: "0 0 16px" }}>
      Roster {band.roster_size} ({band.open_slots} open) · Elders{" "}
      {band.current_elders} of a {band.floor}–{band.ceil} band, target{" "}
      {band.target} · {band.ranked_population} ranked
    </p>
  );
}

function elderCell(m) {
  if (
    m.judgment.promotion === "not_applicable" &&
    m.judgment.demotion === "not_applicable"
  )
    return <span className="nil">—</span>;
  if (m.role === "elder") {
    if (m.demotion.state !== "none")
      return (
        <span className="chip chip--warn">
          {m.demotion.reason ?? "slipping"} · {m.demotion.weeks} wk
        </span>
      );
    return <span className="chip chip--ok">holding</span>;
  }
  if (m.promotion.state === "eligible")
    return <span className="chip chip--ok">eligible</span>;
  if (m.promotion.state === "building")
    return (
      <span className="chip chip--info">building · {m.promotion.weeks} wk</span>
    );
  return <span className="nil">—</span>;
}

function removalCell(m) {
  const r = m.removal;
  if (r.triage)
    return (
      <span
        className={`chip ${r.triage.status === "evidence_held" ? "chip--warn" : r.triage.status === "eligible" ? "chip--bad" : ""}`}
        title={r.triage.reason}
      >
        {REMOVAL_LABEL[r.triage.status]}
      </span>
    );
  if (m.judgment.removal === "held")
    return <span className="chip chip--warn">held · activity unknown</span>;
  if (r.days_idle === null) return <span className="nil">unknown</span>;
  const tone =
    r.state === "recommended"
      ? "chip--bad"
      : r.state === "at_risk"
        ? "chip--warn"
        : r.state === "watch"
          ? "chip--info"
          : "";
  return (
    <span className={`chip ${tone}`}>
      {r.state === "none" ? "active" : r.state.replace("_", " ")} ·{" "}
      {Math.floor(r.days_idle)}d{r.shielded ? ` · ${r.shielded}` : ""}
    </span>
  );
}

function judgmentCell(m) {
  if (m.judgment_reasons?.length)
    return (
      <span className="text-ink-faint">{m.judgment_reasons.join(" ")}</span>
    );
  if (
    m.removal.triage?.reason &&
    ["protected", "not_candidate"].includes(m.removal.triage.status)
  )
    return <span className="text-ink-faint">{m.removal.triage.reason}</span>;
  const js = [
    m.judgment.promotion,
    m.judgment.demotion,
    ["protected", "not_candidate"].includes(m.removal.triage?.status)
      ? "not_applicable"
      : m.judgment.removal,
  ].filter((j) => j !== "not_applicable" && j !== "off");
  if (js.includes("unknown"))
    return <span className="caveat">tenure unknown</span>;
  if (js.includes("held")) return <span className="caveat">held</span>;
  return <span className="chip chip--ok">ready</span>;
}

const EVENT_LABEL = {
  member_joined: "joined",
  member_left: "left",
  role_changed: "role changed",
};
const CLASS_LABEL = {
  member_kicked: "kicked",
  member_left: "left",
  ignored: "ignored",
};

function History({ clan, navigate }) {
  const { whenDay, calendar } = useClock();
  const { data, isError } = useHistory(clan.clan_tag);
  if (isError)
    return (
      <div className="callout callout--warn" role="alert">
        <span>
          History could not be read. Check your clan access or try again.
        </span>
      </div>
    );
  if (!data) return <p className="page__lede">Loading…</p>;
  const timeline = data.timeline ?? [];
  return (
    <>
      <div className="label" style={{ margin: "0 0 8px" }}>
        Recent membership changes
        {data.timeline_since
          ? ` · roster recording since ${whenDay(data.timeline_since)}`
          : ""}
      </div>
      <p className="page-head__note">
        This is the recent roster-event window, with up to twenty recorded
        changes. Earlier changes are not listed here; the recording start is not
        the beginning of this list.
      </p>
      {timeline.length === 0 ? (
        <p className="page__lede" style={{ margin: "0 0 18px" }}>
          No join, leave or role change in the recent roster-event window.
        </p>
      ) : (
        <Table
          columns={[
            { head: "When", cell: (e) => whenDay(e.at) },
            {
              head: "Member",
              cell: (e) => (
                <>
                  {e.name ?? <Tag tag={e.player_tag} />}{" "}
                  <span className="tag">{e.player_tag}</span>
                </>
              ),
            },
            {
              head: "What",
              cell: (e) => (
                <>
                  {EVENT_LABEL[e.type] ?? e.type}
                  {e.type === "role_changed" && e.role_after
                    ? `: ${e.role_before ?? "?"} → ${e.role_after}`
                    : ""}
                </>
              ),
            },
            {
              head: "What the record says",
              cell: (e) => (
                <>
                  {e.type !== "member_left" ? (
                    <span className="nil">—</span>
                  ) : e.classification ? (
                    <span
                      className={`chip ${e.classification === "member_kicked" ? "chip--warn" : "chip--ok"}`}
                    >
                      {CLASS_LABEL[e.classification]}
                    </span>
                  ) : (
                    <span className="chip chip--info">
                      unanswered (Actions)
                    </span>
                  )}
                  {e.note ? (
                    <div className="page-head__note mt-1 whitespace-normal">
                      {e.note}
                    </div>
                  ) : null}
                </>
              ),
            },
            {
              head: "In-game",
              wrap: true,
              cellProps: () => ({ style: { minWidth: "260px" } }),
              cell: (e) =>
                e.copy ? (
                  <CopyLine text={e.copy} />
                ) : (
                  <span className="nil">—</span>
                ),
            },
          ]}
          rows={timeline}
          rowKey={(e) => `${e.type}-${e.player_tag}-${e.at}`}
        />
      )}
      <div className="label" style={{ margin: "0 0 8px" }}>
        Actions
      </div>
      <Table
        columns={[
          {
            head: "#",
            className: "mono",
            cell: (c) =>
              Number.isInteger(c.number) && c.audience?.kind !== "member" ? (
                <a
                  href={`${clanPath(clan.clan_tag)}/actions/${c.number}`}
                  onClick={(e) => {
                    if (!navigate) return;
                    e.preventDefault();
                    navigate(`${clanPath(clan.clan_tag)}/actions/${c.number}`);
                  }}
                >
                  #{c.number}
                </a>
              ) : Number.isInteger(c.number) ? (
                `#${c.number}`
              ) : null,
          },
          { head: "Raised", cell: (c) => whenDay(c.raised_at) },
          {
            head: "Member",
            cell: (c) => (
              <>
                {c.player_name ?? <Tag tag={c.player_tag} />}{" "}
                <span className="tag">{c.player_tag}</span>
              </>
            ),
          },
          { head: "Action", cell: (c) => c.label },
          {
            head: "Outcome",
            cell: (c) => (
              <>
                <span
                  className={`chip ${c.status === "done" ? "chip--ok" : c.status === "declined" ? "chip--warn" : ""}`}
                >
                  {c.status === "done" ? "completed" : c.status}
                </span>
                {c.outcome?.verified_at ? (
                  <span className="chip chip--ok" style={{ marginLeft: "6px" }}>
                    {c.outcome.delay_hours != null
                      ? `confirmed ${Math.round(c.outcome.delay_hours)} h after completion`
                      : "verified"}
                  </span>
                ) : null}
                {c.outcome?.flagged_at ? (
                  <span
                    className="chip chip--bad"
                    style={{ marginLeft: "6px" }}
                  >
                    no change seen
                  </span>
                ) : null}
              </>
            ),
          },
          {
            head: "Decided by",
            cell: (c) => (
              <>
                {c.decided_by ? (
                  <>
                    {c.decided_by_name ?? ""}{" "}
                    <span className="tag">{c.decided_by}</span>
                  </>
                ) : (
                  <span className="nil">—</span>
                )}
                {c.decided_at ? ` · ${whenDay(c.decided_at)}` : ""}
              </>
            ),
          },
          {
            head: "Detail",
            wrap: true,
            cell: (c) => (
              <>
                {c.decline_reason ? c.decline_reason.replaceAll("_", " ") : ""}
                {c.decision_note ? ` · ${c.decision_note}` : ""}
                {c.withdraw_reason ?? ""}
                <details className="mt-1">
                  <summary className="page-head__note cursor-pointer">
                    Log · {(c.log ?? []).length}
                  </summary>
                  <div className="mt-2 min-[760px]:min-w-[320px]">
                    <ActionLog action={c} clan={clan} />
                  </div>
                </details>
              </>
            ),
          },
        ]}
        rows={data.cards}
        rowKey={(c) => c.card_id}
        empty={"No action taken yet."}
      />
      {data.holds.length ? (
        <>
          <div className="label" style={{ margin: "18px 0 8px" }}>
            Holds
          </div>
          <ul style={{ margin: 0, paddingLeft: "18px" }}>
            {data.holds.map((h) => (
              <li key={h.player_tag}>
                {h.player_name ?? ""}{" "}
                <span className="tag">{h.player_tag}</span>{" "}
                {h.kind === "away" ? "away " : ""}
                {h.until ? `until ${calendar(h.until)}` : "open-ended"} · set by{" "}
                {h.by_name ?? h.by} on {whenDay(h.set_at)}
                {h.note ? ` · ${h.note}` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
