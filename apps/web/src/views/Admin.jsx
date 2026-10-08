import { useWrite } from "@elixir-mcp/client";
import { FEEDBACK_ANSWER_STATUSES } from "@elixir-mcp/contracts";
import {
  ago,
  Icon,
  Link,
  LogTable,
  Markdown,
  useClock,
  WriteError,
  noun,
} from "@elixir-mcp/ui";
import { Integrations } from "./Integrations.jsx";
import { useEffect, useState, Fragment } from "react";
import { api } from "../api.js";
import { MailFrame } from "../components/MailFrame.jsx";
import {
  ReleaseKeyCard,
  signatureCounts,
} from "../components/ReleaseSignature.jsx";
import {
  keys,
  useAdminAccounts,
  useAdminCall,
  useAdminEmail,
  useAdminEmailSends,
  useAdminCards,
  useAdminConnections,
  useAdminFeedback,
  useAdminFeedbackItem,
  useAdminGateways,
  useAdminRequests,
  useAdminServiceTokens,
  useAdminUsage,
  useInvalidate,
} from "../lib/queries.js";
import { CONSOLE } from "../lib/console.js";

/**
 * Admin, eight pages.
 *
 * Six of them are the console's one log table with different columns
 * (components/LogTable.jsx) — the same component Activity's three views
 * use, so the console never grows a second table idiom. Collectors and
 * Service tokens keep their own screens: a lifecycle with a different
 * legal move per row, and a one-time secret reveal, are not a log.
 *
 * Each page loads only what it needs. This used to fetch all five admin
 * endpoints on every one of them.
 */

/**
 * How to name a principal in an admin table.
 *
 * These tables read `email_hash` because for a long time every account WAS a
 * person and always had one. Migration 0053 made the column nullable so that
 * agents and integrations -- which belong to a person and have no address of
 * their own -- could exist at all, and every one of these views kept calling
 * .slice() on it. The first agent created blanked EVERY admin page, because a
 * throw inside a render unmounts the whole tree.
 *
 * The guard alone would print a dash, which is worse than nothing in a table
 * whose job is telling you who did what. An agent has a name; use it.
 */
function principalLabel(a) {
  if (a.primary_tag)
    return a.primary_name
      ? `${a.primary_name} ${a.primary_tag}`
      : a.primary_tag;
  // A PERSON is their email hash. Their tokens have names too, and reaching
  // for one made the owner's own row read as "elixir-bot" -- a person
  // labelled with a machine they happen to own.
  if (a.kind && a.kind !== "person") {
    // An agent's name lives on its service_token, not the account row; the
    // slug is the stable fallback if the token was revoked.
    if (a.principal_name) return a.principal_name;
    if (a.public_id) return a.public_id;
  }
  if (a.email_hash) return a.email_hash.slice(0, 10);
  return a.account_id ? a.account_id.slice(0, 8) : "unknown";
}

export function Admin({ me, page = "requests", navigate, itemId }) {
  if (!me?.is_admin)
    return <p className="callout callout--warn">Admins only.</p>;
  if (page === "integrations") return <Integrations />;
  if (page === "accounts")
    return itemId ? (
      <AdminAccountDetail id={itemId} navigate={navigate} />
    ) : (
      <AdminAccounts navigate={navigate} />
    );
  if (page === "usage") return <AdminUsage />;
  if (page === "collectors") return <AdminCollectors navigate={navigate} />;
  if (page === "connections") return <AdminConnections />;
  if (page === "service-tokens") return <AdminServiceTokens />;
  if (page === "feedback")
    return itemId ? (
      <AdminFeedbackItem id={itemId} navigate={navigate} />
    ) : (
      <AdminFeedback navigate={navigate} />
    );
  if (page === "emails")
    return itemId ? (
      <AdminEmailRecord id={itemId} navigate={navigate} />
    ) : (
      <AdminEmails navigate={navigate} />
    );
  if (page === "cards") return <AdminCards />;
  return <AdminRequests />;
}

/** The card catalog with its archetype roles, read-only (design
 *  2026-09-20 §12.4). What is in force and where it came from, the
 *  cards with a role, and the one operational list: cards with no role
 *  that keep turning up as the defining card of a deck named by cost
 *  alone this season - the queue for the research agent that keeps the
 *  vocabulary file. Nothing here edits: the file lives in
 *  cr-agent-api-docs and every entry there carries a public source. */
function AdminCards() {
  const { day } = useClock();
  const data = useAdminCards().data;
  const version = data?.version ?? null;
  const cards = data?.cards ?? [];
  const roleText = (c) => {
    const r = c.role;
    if (!r) return "—";
    const parts = [];
    if (r.win_condition)
      parts.push(
        `win condition${r.tier !== null ? ` (tier ${r.tier})` : ""}: ${r.family?.replace("_", " ")}${r.at_cycle_cost ? `, ${r.at_cycle_cost} at cycle cost` : ""}${r.needs_partner ? ", with a bridge partner" : ""}`,
      );
    if (r.bait_unit) parts.push("bait unit");
    if (r.bridge_partner) parts.push("bridge partner");
    if (r.names_deck) parts.push("names a deck (not a win condition)");
    return parts.join("; ");
  };
  const rows = cards.map((c) => [
    c.name,
    c.kind === "support" ? "tower" : (c.rarity ?? "—"),
    c.elixir_cost === null ? "—" : String(c.elixir_cost),
    roleText(c),
    c.role?.attested_at ? day(c.role.attested_at) : "—",
    c.role?.source
      ? {
          text: "source",
          title: c.role.source,
          // An outside page: LogTable opens it in a new tab.
          href: c.role.source.match(/https?:\/\/\S+/)?.[0],
        }
      : "—",
  ]);
  return (
    <>
      <LogTable
        crumb="Admin"
        title="Cards"
        note={
          version
            ? `Vocabulary ${version.roles_version} from cr-agent-api-docs ${String(version.source_commit).slice(0, 7)}, imported ${ago(version.imported_at)}: ${version.roles} card roles, ${version.aliases} deck aliases. Read-only here; the file is edited in the reference repository, and every entry carries a public source.`
            : "No vocabulary imported yet: every deck is named by its cost alone until the next deploy imports cr-agent-api-docs data/card-roles.json."
        }
        cols={[
          ["CARD", "left"],
          ["RARITY", "left"],
          ["COST", "right"],
          ["ROLE", "left"],
          ["ATTESTED", "left"],
          ["SOURCE", "left"],
        ]}
        rows={rows}
        monoCols={[2, 4]}
        filters={[{ key: "role", label: "Role", col: 3 }]}
        minWidth={820}
        empty="No catalog yet."
        footnote="card joined to card_role. A card with no role is not a win condition, however new; a deck built around one is named by its family alone until a public source names it."
      />
    </>
  );
}

/** Everything sent, every account (Jamie, 2026-09-19: "we can audit
 *  what we send without user feedback"). The same table the person's
 *  Activity → Emails is, with the recipient named by player and public
 *  id and the reports filed about each send counted. */
function AdminEmails() {
  const { stamp: when } = useClock();
  const sends = useAdminEmailSends().data?.sends ?? [];
  const rows = sends.map((m) => [
    when(m.sent_at),
    m.to_player ?? m.public_id ?? "—",
    m.label ?? m.kind,
    {
      text: m.subject ?? "—",
      title: m.subject ?? "",
      href: `${CONSOLE}/admin/emails/${m.send_id}`,
    },
    m.archived ? "kept" : { text: "not kept", tone: "warn" },
    m.reports > 0 ? { text: String(m.reports), tone: "warn" } : "—",
    {
      text: m.send_id.slice(0, 8),
      title: m.send_id,
      href: `${CONSOLE}/admin/emails/${m.send_id}`,
    },
  ]);
  return (
    <LogTable
      crumb="Admin"
      title="Emails sent"
      note="Every product email queued for any account, newest first. Open one to read it as it was sent."
      cols={[
        ["WHEN", "left"],
        ["TO", "left"],
        ["KIND", "left"],
        ["SUBJECT", "left"],
        ["BODY", "left"],
        ["REPORTS", "right"],
        ["EMAIL", "left"],
      ]}
      rows={rows}
      monoCols={[0, 1, 6]}
      filters={[
        { key: "kind", label: "Kind", col: 2 },
        { key: "to", label: "To", col: 1 },
      ]}
      minWidth={820}
      empty="Nothing sent yet."
      footnote="email_send, last 200. TO is the recipient's primary player (or public id); never an address. REPORTS counts feedback filed about that send; EMAIL is the id in its footer."
    />
  );
}

/** One sent email, the maintainer's read: the row and the body. */
function AdminEmailRecord({ id }) {
  const { stamp: when } = useClock();
  const record = useAdminEmail(id);
  const rec = record.data ?? null;
  const back = (
    <div className="page__crumb">
      <Link to={`${CONSOLE}/admin/emails`}>‹ Emails sent</Link>
    </div>
  );
  if (record.isError || (record.isSuccess && !rec?.send))
    return (
      <>
        {back}
        <div className="empty">
          <div className="empty__title">No email by that id</div>
        </div>
      </>
    );
  if (!rec) return <p className="text-ink-faint">Loading…</p>;
  const { send } = rec;
  return (
    <>
      {back}
      <div className="record__head">
        <h1 className="text-[24px] m-0 text-ink">
          {send.subject ?? send.label}
        </h1>
        <span className="chip chip--info">
          <span className="chip__dot" />
          {send.label}
        </span>
      </div>
      <p className="record__sub">
        <span className="mono">{when(send.sent_at)}</span>
        {send.period ? ` · ${send.period}` : ""} ·{" "}
        <span className="mono">{send.send_id}</span>
      </p>
      {rec.html ? (
        <MailFrame html={rec.html} />
      ) : (
        <p className="caveat">
          {rec.archive_error
            ? "Kept, but the archive could not be read back just now."
            : "The body was not kept (sent before 2026-09-19)."}
        </p>
      )}
    </>
  );
}

/** Access requests. Granted by hand, oldest first — the queue is short
 *  and the decision is a judgement, so there is no bulk action. */
function AdminRequests() {
  const { day } = useClock();
  const requests = useAdminRequests().data?.requests ?? [];
  // Approve and deny say when they did not take; the queue refetches
  // only after one that did.
  const decision = useWrite(api.adminDecide, {
    invalidate: [keys.adminRequests],
  });
  const decide = (hash, status) => decision.run(hash, status);

  const rows = requests.map((r) => [
    day(r.created_at),
    r.email_hash ? r.email_hash.slice(0, 10) : "—",
    r.requested_player_tag ?? "—",
    r.request_note ?? "",
    { text: "Approve", action: () => decide(r.email_hash, "approved") },
    { text: "Deny", action: () => decide(r.email_hash, "denied") },
  ]);

  return (
    <LogTable
      crumb="Admin"
      title="Access requests"
      note="Granted by hand, oldest first."
      above={<WriteError error={decision.error} className="field-error mb-3" />}
      cols={[
        ["ASKED", "left"],
        ["ACCOUNT", "left"],
        ["WANTS", "left"],
        ["NOTE", "left"],
        ["", "right"],
        ["", "right"],
      ]}
      rows={rows}
      monoCols={[0, 1, 2]}
      empty="Queue is empty."
      footnote="An address is never shown here, only the first ten characters of its hash — enough to match a person to the email they wrote from, and not reversible."
    />
  );
}

/** Accounts and tiers. The three override columns are read-only and say
 *  so: they are set in the ops lane, and a control here would be a
 *  second way to write them. */
function AdminAccounts() {
  // settable_roles is read by the record page, which is where a tier is
  // now changed; the list only has to find an account.
  const accounts = useAdminAccounts().data?.accounts ?? [];

  // Six columns became four, then five. The ops-lane overrides, the
  // collector flag and the tier prompt moved to the record page: a list
  // is for finding an account, and everything you can DO to one belongs
  // where you have opened it and can see what you are changing.
  //
  // PEOPLE ONLY (Jamie, 2026-09-10). An agent or an integration is an
  // account in the schema (0053) but not a signup: they arrive when
  // somebody creates one, they have no email and no tier of their own,
  // and listing them beside their owners made the queue of actual humans
  // impossible to read. They are counted here and named on the record.
  const rows = accounts
    .filter((a) => !a.owned_by_account_id)
    .map((a) => [
      {
        text: a.email ?? principalLabel(a),
        title: a.account_id,
        href: `${CONSOLE}/admin/accounts/${a.account_id}`,
      },
      a.status,
      {
        text: a.role + (a.pending_role_request ? " · upgrade requested" : ""),
        tone: a.pending_role_request ? "warn" : undefined,
      },
      `${a.players_tracked ?? 0} ${noun(a.players_tracked ?? 0, "player")} · ${a.clans_tracked ?? 0} ${noun(a.clans_tracked ?? 0, "clan")}`,
      a.children ? String(a.children) : "—",
    ]);

  return (
    <LogTable
      crumb="Admin"
      title="Accounts"
      note="Everyone with a door. Tiers set what we record and the daily call budget — never read access."
      cols={[
        ["ACCOUNT", "left"],
        ["STATUS", "left"],
        ["TIER", "left"],
        ["TRACKING", "left"],
        ["AGENTS & INTEGRATIONS", "right"],
      ]}
      rows={rows}
      monoCols={[0]}
      filters={[
        { key: "tier", label: "Tier", col: 2 },
        { key: "status", label: "Status", col: 1 },
      ]}
      minWidth={620}
      empty="No accounts yet."
      footnote="People only. An agent or an integration is an account too, owned by whoever created it — the last column counts them, and the record page names them. An account is named by the address it signs in with; open one to change its tier or read its overrides. Upgrade requests land in Feedback and are flagged in the tier column."
    />
  );
}

/** Usage across accounts. The shared FETCH budget is a service-wide
 *  number and lives on Status; this is the per-account call side. */
function AdminUsage() {
  const { day } = useClock();
  const { data: usage = null } = useAdminUsage();

  const rows = (usage?.accounts ?? []).map((a) => [
    principalLabel(a) + (a.kind && a.kind !== "person" ? ` (${a.kind})` : ""),
    String(a.calls_7d ?? 0),
    String(a.calls_today ?? 0),
    a.errors_7d ? String(a.errors_7d) : "0",
    a.mcp_daily_quota == null ? "tier default" : String(a.mcp_daily_quota),
    a.last_call ? day(a.last_call) : "never",
  ]);

  const busiest = (usage?.tools ?? [])
    .slice(0, 5)
    .map((t) => `${t.tool} (${t.calls.toLocaleString()})`)
    .join(", ");

  return (
    <LogTable
      crumb="Admin"
      title="Usage across accounts"
      note="Seven days. The shared fetch budget is on Status."
      cols={[
        ["ACCOUNT", "left"],
        ["CALLS 7D", "right"],
        ["TODAY", "right"],
        ["ERRORS 7D", "right"],
        ["DAILY QUOTA", "right"],
        ["LAST CALL", "left"],
      ]}
      rows={rows}
      monoCols={[0, 5]}
      empty="No calls in the last seven days."
      footnote={
        busiest
          ? `Busiest tools over the same seven days: ${busiest}.`
          : undefined
      }
    />
  );
}

/** One account, admin lane: what it is, what it may do, and the one
 *  thing an admin changes. The tier used to be a window.prompt from the
 *  list — a control with no context, on a row you had to count columns
 *  to read. Facts first, then the change, on a page that shows what you
 *  are changing. */
function AdminAccountDetail({ id }) {
  const { day } = useClock();
  const query = useAdminAccounts();
  const accounts = query.data?.accounts ?? null;
  const settable = query.data?.settable_roles ?? [];
  const [role, setRole] = useState("");
  const [saved, setSaved] = useState("");
  const invalidate = useInvalidate();
  const load = () => invalidate(keys.adminAccounts);

  const a = (accounts ?? []).find((x) => String(x.account_id) === String(id));
  useEffect(() => {
    if (a) setRole(a.role);
  }, [a]);

  if (accounts === null)
    return <p style={{ color: "var(--ink-faint)" }}>Loading…</p>;
  if (!a)
    return (
      <div className="panel">
        <div className="panel__body">
          No account {id}.{" "}
          <Link to={`${CONSOLE}/admin/accounts`}>All accounts ›</Link>
        </div>
      </div>
    );

  // An agent or an integration is an account owned by the person who
  // created it (0053). Both directions are useful here: what this
  // account runs, and — if you opened one of those — whose it is.
  const children = (accounts ?? []).filter(
    (x) => x.owned_by_account_id === a.account_id,
  );
  const parent = a.owned_by_account_id
    ? (accounts ?? []).find((x) => x.account_id === a.owned_by_account_id)
    : null;

  const facts = [
    ["Email", a.email ?? "— (predates the address being kept)"],
    ["Account id", a.account_id],
    ["Kind", a.kind ?? "person"],
    ["Public id", a.public_id ?? "—"],
    ["Principal name", a.principal_name ?? "—"],
    ["Status", a.status],
    ["Created", day(a.created_at)],
    [
      "Tracking",
      `${a.players_tracked ?? 0} ${noun(a.players_tracked ?? 0, "player")} · ${a.clans_tracked ?? 0} ${noun(a.clans_tracked ?? 0, "clan")}`,
    ],
    ["Runs a collector", a.operator ? "yes" : "no"],
    [
      "Overrides · ops only",
      [
        a.max_player_recordings != null && `players ${a.max_player_recordings}`,
        a.mcp_daily_quota != null && `calls ${a.mcp_daily_quota}`,
        a.live_daily_quota != null && `live ${a.live_daily_quota}`,
      ]
        .filter(Boolean)
        .join(" · ") || "none",
    ],
  ];

  return (
    <>
      <p style={{ margin: "0 0 10px" }}>
        <Link
          className="mono"
          style={{ fontSize: "12px" }}
          to={`${CONSOLE}/admin/accounts`}
        >
          ‹ All accounts
        </Link>
      </p>
      <section className="panel" style={{ maxWidth: "680px" }}>
        <div className="panel__head">
          <span className="panel-title">{a.email ?? principalLabel(a)}</span>
          {a.is_owner && <span className="chip chip--info">owner</span>}
          {a.pending_role_request && (
            <span className="chip chip--warn">upgrade requested</span>
          )}
        </div>
        {/* .fields is the console's one key/value list (Agents, Explore
            and the collector record all use it) — a flat dl, no wrapper
            divs, because the grid is two columns of the SAME list. */}
        <dl className="fields" style={{ margin: 0 }}>
          {facts.map(([k, v]) => (
            <Fragment key={k}>
              <dt>{k}</dt>
              <dd className={k === "Email" ? undefined : "mono"}>{v}</dd>
            </Fragment>
          ))}
        </dl>
        <div
          className="panel__body"
          style={{
            borderTop: "1px solid var(--line-soft)",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          <label className="field-label" htmlFor="account-tier">
            Tier
          </label>
          <select
            id="account-tier"
            value={role}
            disabled={!settable.includes(a.role)}
            onChange={(e) => setRole(e.target.value)}
          >
            {[...new Set([a.role, ...settable])].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            className="btn btn--sm"
            disabled={!settable.includes(a.role) || role === a.role}
            onClick={async () => {
              const r = await api.adminSetRole(a.account_id, role);
              setSaved(r.ok ? "Tier saved." : "That did not work.");
              if (r.ok) load();
            }}
          >
            Save tier
          </button>
          {saved && <span className="caveat">{saved}</span>}
          {!settable.includes(a.role) && (
            <span className="caveat">
              This account&rsquo;s tier is not yours to set.
            </span>
          )}
        </div>
        <div
          className="panel__body"
          style={{ borderTop: "1px solid var(--line-soft)" }}
        >
          <p className="footnote" style={{ margin: 0 }}>
            A tier sets what we RECORD for an account and its daily call budget.
            It never changes what the account can read — every recorded fact is
            readable by every account. Overrides are set in the ops lane,
            deliberately not here.
          </p>
        </div>
      </section>

      {/* What this account RUNS. An agent or an integration is an account
          of its own (0053) with its own door and its own connections, so
          it needs to be reachable — it is simply not a signup, which is
          why the list does not carry them. */}
      {children.length > 0 && (
        <section
          className="panel"
          style={{ maxWidth: "680px", marginTop: "14px" }}
        >
          <div className="panel__head">
            <span className="panel-title">Agents and integrations</span>
            <span className="caveat" style={{ marginLeft: "auto" }}>
              {children.length} owned by this account
            </span>
          </div>
          <dl className="fields" style={{ margin: 0 }}>
            {children.map((c) => (
              <Fragment key={c.account_id}>
                <dt>{c.kind ?? "principal"}</dt>
                <dd>
                  <Link to={`${CONSOLE}/admin/accounts/${c.account_id}`}>
                    {c.principal_name ??
                      c.public_id ??
                      c.account_id.slice(0, 8)}
                  </Link>
                  <span style={{ color: "var(--ink-faint)" }}>
                    {" · "}
                    {c.status}
                    {c.public_id ? ` · ${c.public_id}` : ""}
                  </span>
                </dd>
              </Fragment>
            ))}
          </dl>
        </section>
      )}

      {parent && (
        <p className="footnote" style={{ margin: "14px 0 0" }}>
          This {a.kind ?? "principal"} belongs to{" "}
          <Link to={`${CONSOLE}/admin/accounts/${parent.account_id}`}>
            {parent.email ?? principalLabel(parent)}
          </Link>{" "}
          — it spends their entitlements and their daily budget.
        </p>
      )}
    </>
  );
}

/**
 * Every account's live connections, and the power to end one.
 *
 * Jamie opened Service tokens looking for this and found something else
 * (2026-09-10): a service token is an owner-issued headless credential
 * bound to one account, one per consuming service. THIS is "who is
 * connected, and can I stop it" — the same rows each holder sees under
 * Account > Connections, across every account, with the address that
 * holds them.
 */
function AdminConnections() {
  const { day } = useClock();
  const rows = useAdminConnections().data?.connections ?? [];
  const revoke = useWrite(api.adminRevokeConnection, {
    invalidate: [keys.adminConnections],
  });

  const table = rows.map((c) => [
    {
      text:
        c.email ??
        (c.kind && c.kind !== "person"
          ? `${c.public_id ?? "principal"} (${c.kind})`
          : (c.account_id ?? "").slice(0, 8)),
      title: c.account_id,
    },
    c.client_name ?? "—",
    String(c.calls_7d ?? 0),
    c.last_call_at ? day(c.last_call_at) : "never",
    day(c.absolute_expires_at),
    {
      text: "Revoke",
      action: async () => {
        // Somebody else's credential: the confirmation names whose, and
        // what stops working, because "Revoke" on a table row is the
        // easiest destructive click in the console to make by accident.
        const whose = c.email ?? c.public_id ?? "this account";
        if (
          !window.confirm(
            `Revoke ${c.client_name ?? "this connection"} for ${whose}? It stops reading on its next call, and they will have to connect it again.`,
          )
        )
          return;
        await revoke.run(c.family_id);
      },
    },
  ]);

  return (
    <LogTable
      crumb="Admin"
      title="Connections"
      note="Every live OAuth connection, whoever holds it. Revoking one ends it on its next call and lands on that account's own event log."
      above={<WriteError error={revoke.error} className="field-error mb-3" />}
      cols={[
        ["ACCOUNT", "left"],
        ["CLIENT", "left"],
        ["CALLS 7D", "right"],
        ["LAST CALL", "left"],
        ["EXPIRES", "left"],
        ["", "right"],
      ]}
      rows={table}
      monoCols={[0, 3, 4]}
      filters={[{ key: "client", label: "Client", col: 1 }]}
      minWidth={820}
      empty="No live connections."
      footnote="A service token is a different thing: owner-issued, headless, bound to one account, and listed under Service tokens."
    />
  );
}

const FEEDBACK_AREA_LABEL = {
  mcp: "MCP",
  api: "JSON API",
  console: "Console",
  ladder: "Ladder",
  clan: "Elixir Clan",
  mail: "Email",
  docs: "Docs",
  recorder: "Recorder",
};

/** The one queue (0204): every part of Elixir in one list, filtered by
 *  area on the server, with each area's count and how many still wait
 *  for words. Unanswered, oldest first is the backlog's order; the
 *  answer is on the item, because answering means reading it. */
function AdminFeedback() {
  const { day } = useClock();
  const [area, setArea] = useState("");
  const [unanswered, setUnanswered] = useState(true);
  const [cursor, setCursor] = useState([]);
  const q = {
    area: area || undefined,
    unanswered: unanswered ? "1" : undefined,
    order: unanswered ? "oldest" : undefined,
    ...(cursor.at(-1) ?? {}),
  };
  const query = useAdminFeedback(q);
  const feedback = query.data?.feedback ?? [];
  const areas = query.data?.areas ?? [];
  const next = query.data?.next ?? null;
  const pick = (value) => {
    setArea(value);
    setCursor([]);
  };

  const rows = feedback.map((f) => [
    {
      text: `fb_${f.feedback_id}`,
      href: `${CONSOLE}/admin/feedback/${f.feedback_id}`,
    },
    day(f.created_at),
    f.from_player ??
      (f.account_kind === "agent" ? `agent ${f.account_public_id}` : "—"),
    FEEDBACK_AREA_LABEL[f.area] ?? f.area ?? "",
    f.category ?? "",
    {
      text: f.message.length > 80 ? f.message.slice(0, 80) + "…" : f.message,
      title: f.message,
    },
    {
      text: f.status + (f.response ? " · answered" : ""),
      tone: f.status === "new" ? "accent-bright" : undefined,
    },
  ]);

  return (
    <LogTable
      crumb="Admin"
      title="Feedback queue"
      note="Every door files here: MCP, the JSON API, the Console, Ladder, Elixir Clan, the docs and the email footer."
      loading={query.isPending}
      error={query.isError ? "The queue could not be read just now." : null}
      above={
        <div
          style={{
            display: "flex",
            gap: "6px",
            flexWrap: "wrap",
            alignItems: "center",
            marginBottom: "12px",
          }}
        >
          <button
            type="button"
            className={`btn btn--sm${area ? "" : " btn--primary"}`}
            onClick={() => pick("")}
          >
            All
          </button>
          {areas.map((a) => (
            <button
              key={a.area}
              type="button"
              className={`btn btn--sm${area === a.area ? " btn--primary" : ""}`}
              onClick={() => pick(a.area)}
              title={`${a.total} shown by this filter, ${a.unanswered} without words`}
            >
              {FEEDBACK_AREA_LABEL[a.area] ?? a.area}{" "}
              <span className="mono">
                {unanswered ? a.unanswered : a.total}
              </span>
            </button>
          ))}
          <label
            style={{
              marginLeft: "auto",
              display: "flex",
              gap: "6px",
              alignItems: "center",
              fontSize: "13px",
            }}
          >
            <input
              type="checkbox"
              checked={unanswered}
              onChange={(e) => {
                setUnanswered(e.target.checked);
                setCursor([]);
              }}
            />
            Unanswered, oldest first
          </label>
        </div>
      }
      cols={[
        ["ID", "left"],
        ["WHEN", "left"],
        ["FROM", "left"],
        ["AREA", "left"],
        ["CATEGORY", "left"],
        ["SAID", "left"],
        ["STATE", "left"],
      ]}
      rows={rows}
      monoCols={[0, 1, 2]}
      filters={[
        { key: "state", label: "State", col: 6 },
        { key: "category", label: "Category", col: 4 },
      ]}
      minWidth={880}
      empty={
        unanswered
          ? "Nothing waits for an answer here."
          : "No feedback here yet."
      }
      footnote={
        <span className="flex items-center gap-[10px]">
          {cursor.length > 0 && (
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setCursor(cursor.slice(0, -1))}
            >
              ‹ Back
            </button>
          )}
          {next && (
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setCursor([...cursor, next])}
            >
              {unanswered ? "Newer ›" : "Older ›"}
            </button>
          )}
          <span>
            Every item gets an answer: it lands in the filer's feed, and a
            person is emailed it. Open one to answer it.
          </span>
        </span>
      }
    />
  );
}

/**
 * The collector fleet, admin lane — a LIST now, not a console.
 *
 * It carried ten columns and every lifecycle action inline, so the row
 * you were about to act on was the hardest thing on the page to read
 * (Jamie, 2026-09-10). Five columns, and the name opens the collector's
 * own record — the SAME record the status page opens, with the
 * operations panel on it for whoever may act. One collector, one page.
 */
const SIGNATURE_LABEL = {
  signed: "signed",
  dev_build: "dev build",
  unverified: "unverified",
  mismatch: "MISMATCH",
};
const SIGNATURE_TONE = { signed: "ok", mismatch: "bad", dev_build: "accent" };

function AdminCollectors() {
  const { stamp } = useClock();
  const gateways = useAdminGateways().data?.gateways ?? [];

  const rows = gateways.map((g) => [
    {
      text: g.card_name ?? g.name ?? "unnamed",
      title: g.name,
      href: `${CONSOLE}/status/collectors/${encodeURIComponent(g.card_name ?? g.name)}`,
    },
    g.owner_account_id
      ? (g.owner_player_name ?? g.owner_email_hash?.slice(0, 10) ?? "claimed")
      : "unowned",
    {
      text: g.status,
      tone:
        g.status === "active"
          ? "ok"
          : g.status === "revoked"
            ? undefined
            : "warn",
    },
    {
      text: ago(g.last_heartbeat_at),
      title: g.last_heartbeat_at
        ? stamp(g.last_heartbeat_at, { year: true, seconds: true })
        : "never",
    },
    String(g.fetches_last_hour ?? 0),
    // What the fetches were worth: the share that changed
    // the record, what the edge filter dropped before the wire, and door
    // calls per admitted fetch (1.0 is perfect; long-polling was ~2.7).
    typeof g.yield_24h === "number" || typeof g.yield_24h === "string"
      ? `${Math.round(Number(g.yield_24h) * 100)}%`
      : "—",
    typeof g.edge_filtered_24h === "number" ||
    typeof g.edge_filtered_24h === "string"
      ? `${Math.round(Number(g.edge_filtered_24h) * 100)}%`
      : "—",
    g.door_calls_hour && g.fetches_last_hour
      ? (g.door_calls_hour / (2 * g.fetches_last_hour)).toFixed(1)
      : "—",
    // Signed release (0184): the reported binary hash against the named
    // one for its version. A mismatch is the loud one.
    {
      text: `${SIGNATURE_LABEL[g.signature] ?? "unverified"} · ${g.last_seen_sha ?? "—"}`,
      tone: SIGNATURE_TONE[g.signature],
      title: g.binary_sha256
        ? `binary ${g.binary_sha256}\ntrusts ${g.release_key_fingerprints ?? "no key reported"}`
        : "sends no binary hash (an older client)",
    },
  ]);
  const mismatched = gateways.filter(
    (g) => g.signature === "mismatch" && g.status !== "revoked",
  );

  return (
    <LogTable
      crumb="Admin"
      title="Collector fleet"
      note="Lifecycle is forward-only: pending, then probation once the key is issued and it is heartbeating, then active. Open one to act on it."
      cols={[
        ["COLLECTOR", "left"],
        ["OPERATOR", "left"],
        ["STATE", "left"],
        ["HEARTBEAT", "left"],
        ["FETCHES 1H", "right"],
        ["YIELD 24H", "right"],
        ["EDGE FILTER", "right"],
        ["CALLS/FETCH", "right"],
        ["RELEASE", "left"],
      ]}
      rows={rows}
      monoCols={[3, 4, 5, 6, 7]}
      above={
        <>
          {mismatched.length > 0 && (
            <div className="callout callout--bad mb-[18px]" role="alert">
              <Icon name="shield-x" size={18} />
              <div>
                <strong>
                  {mismatched.length === 1
                    ? "A collector is not running a signed release"
                    : `${mismatched.length} collectors are not running a signed release`}
                </strong>
                : {mismatched.map((g) => g.card_name ?? g.name).join(", ")}.
                Each reports a binary hash that is not the named one for its
                version. Either it runs a local build under a release&rsquo;s
                version, or something is wrong with the machine. Hover the
                Release cell for the hash, and ask the operator.
              </div>
            </div>
          )}
          <ReleaseKeyCard counts={signatureCounts(gateways)} />
        </>
      }
      filters={[{ key: "state", label: "State", col: 2 }]}
      minWidth={960}
      empty="No collectors yet."
      footnote="Heartbeat is any contact with the door, including check-ins that found no work — a fresh heartbeat with stale data is an idle collector, not a broken one. Yield is the share of the last day's fetches that changed the record; edge filter is the share of battle-log entries the collector dropped before the wire; calls/fetch normalizes door calls against each admitted fetch's required lease and submit pair this hour (1.0 is perfect). Operators bring their own CR key; approval issues the collector token."
    />
  );
}

/** The person-bound service keys issued before 2026-09-27, to watch and
 *  revoke. None is issued any more: a headless caller is an
 *  agent with its own key, or a product on Integrations. */
function AdminServiceTokens() {
  const { day } = useClock();
  const svcTokens = useAdminServiceTokens().data?.tokens ?? [];
  const revokeToken = useWrite(api.adminServiceTokenAction, {
    invalidate: [keys.adminServiceTokens],
  });

  return (
    <>
      <div>
        <p className="page__crumb">Admin · owner only</p>
        <h1 className="page__title">Service tokens</h1>
        <p className="page__lede">
          Headless keys issued by hand before 2026-09-27, each acting as the
          account it is bound to. No new ones are issued: a bot or service gets
          its own identity as an agent (Account &rarr; Agents) or an integration
          (<a href={`${CONSOLE}/admin/integrations`}>Integrations</a>). Revoke
          any still listed here once its caller has moved. Calls audit as{" "}
          <code>svc:&lt;name&gt;</code>.
        </p>
      </div>
      <WriteError error={revokeToken.error} className="field-error mb-3" />
      {svcTokens.length === 0 ? (
        <div className="empty">
          <div className="empty__title">No service tokens</div>
          <p className="empty__body" style={{ marginBottom: 0 }}>
            Every headless caller has its own identity, as an agent or an
            integration. Nothing here to revoke.
          </p>
        </div>
      ) : (
        <div className="table__scroll" tabIndex={0}>
          <table className="table" style={{ minWidth: "620px" }}>
            <thead>
              <tr>
                <th>NAME</th>
                <th>ACTS AS</th>
                <th>CREATED</th>
                <th>LAST USED</th>
                <th className="num">CALLS 7D</th>
                <th>STATE</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {svcTokens.map((t) => (
                <tr key={t.token_id}>
                  <td className="mono">{t.name}</td>
                  {/* Whose entitlements it spends. Every token is the
                      owner's today, and the column is here because that
                      is a fact about the credential, not a given. */}
                  <td>
                    {t.account_email ?? "—"}
                    {t.account_role ? (
                      <span
                        style={{ color: "var(--ink-faint)", fontSize: "12px" }}
                      >
                        {" "}
                        · {t.account_role}
                      </span>
                    ) : null}
                  </td>
                  <td className="mono">{day(t.created_at)}</td>
                  <td className="mono">{ago(t.last_used_at)}</td>
                  <td className="num">{t.calls_7d}</td>
                  <td>
                    {/* Dot and ink on one value: live is fine, revoked
                        is over and carries no tone. */}
                    <span
                      className={"chip " + (t.revoked_at ? "" : "chip--ok")}
                    >
                      <span className="chip__dot" />
                      {t.revoked_at ? "revoked" : "live"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {!t.revoked_at && (
                      <button
                        className="btn btn--sm btn--danger"
                        disabled={revokeToken.busy}
                        onClick={() =>
                          revokeToken.run({ revoke_token_id: t.token_id })
                        }
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p
        className="footnote"
        style={{ margin: "14px 2px 0", maxWidth: "78ch" }}
      >
        A token is shown once, at creation. Revoking is final: a revoked token
        still being presented shows up on Connections as a refusal, not as a
        call.
      </p>
    </>
  );
}

/** The call a report is about, read over the admin lane so the maintainer
 *  sees what the filer saw — the arguments and the answer, not a
 *  description of them. Attached by the console's Report this call button
 *  and by elixir_send_feedback's request_id (contract 1.1.0). */
function AttachedCall({ requestId }) {
  const { stamp } = useClock();
  const call = useAdminCall(requestId);
  const record = call.data ?? null;
  const missing = call.isError;

  return (
    <div
      className="panel__body"
      style={{ borderTop: "1px solid var(--line-soft)" }}
    >
      <div
        className="mono"
        style={{
          fontSize: "11px",
          color: "var(--ink-faint)",
          marginBottom: "6px",
        }}
      >
        THE CALL · {requestId}
      </div>
      {missing && (
        <p className="caveat" style={{ margin: 0 }}>
          That call is no longer in the log — audit rows are pruned, the report
          is kept.
        </p>
      )}
      {record && (
        <>
          <p style={{ margin: "0 0 8px", fontSize: "13px" }}>
            <span className="mono">{record.call?.tool}</span> ·{" "}
            {record.call?.duration_ms ?? "—"} ms ·{" "}
            {stamp(record.call?.created_at, { year: true })}
            {record.call?.error_code ? ` · ${record.call.error_code}` : ""}
          </p>
          <pre
            className="mono"
            style={{
              fontSize: "11.5px",
              overflowX: "auto",
              maxHeight: "260px",
              margin: 0,
            }}
          >
            {JSON.stringify(record.request ?? record.call?.args ?? {}, null, 2)}
          </pre>
        </>
      )}
    </div>
  );
}

/** The email a report is about (0139), read over the admin lane so the
 *  maintainer reads what the filer was sent — the mail itself, not a
 *  description of it. Attached by the record's and the footer's
 *  "report a problem with this email". */
function AttachedEmail({ sendId }) {
  const { stamp: when } = useClock();
  const mail = useAdminEmail(sendId);
  const rec = mail.data ?? null;
  return (
    <div
      className="panel__body"
      style={{ borderTop: "1px solid var(--line-soft)" }}
    >
      <div className="mono text-[11px] text-ink-faint mb-[6px]">
        THE EMAIL ·{" "}
        <Link to={`${CONSOLE}/admin/emails/${sendId}`}>{sendId}</Link>
      </div>
      {mail.isError && (
        <p className="caveat m-0">That send is no longer in the ledger.</p>
      )}
      {rec?.send && (
        <p className="m-0 mb-2 text-[13px]">
          {rec.send.label} · {when(rec.send.sent_at)}
          {rec.send.subject ? ` · ${rec.send.subject}` : ""}
        </p>
      )}
      {rec?.html && <MailFrame html={rec.html} />}
      {rec?.send && !rec.html && (
        <p className="caveat m-0">
          {rec.archive_error
            ? "Kept, but the archive could not be read back just now."
            : "The body was not kept (sent before 2026-09-19)."}
        </p>
      )}
    </div>
  );
}

/** Who filed it through what (0204): the principal, the client, and an
 *  agent's person when it relayed theirs. */
function viaLine(item) {
  const v = item.via ?? {};
  return [
    item.from_player ??
      (item.account_kind === "agent"
        ? `agent ${item.account_public_id}`
        : "unknown filer"),
    `via ${item.surface}`,
    v.client_name ? v.client_name : null,
    v.on_behalf_of
      ? `for ${v.on_behalf_of}${v.player_tag ? ` (${v.player_tag})` : ""}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

const POINTER_LABEL = {
  player: "Player",
  clan: "Clan",
  clan_action: "Clan action",
  award: "Award",
  policy: "Policy",
};

/** One feedback item, admin lane: the record, what it points at (each
 *  call and email read over the admin lane), its thread, and the answer:
 *  a status, the words the filer reads, and what shipped. The answer is
 *  a compare-and-set on the item as read, so two answers cannot cross. */
function AdminFeedbackItem({ id, navigate }) {
  const { day } = useClock();
  const query = useAdminFeedbackItem(id);
  const item = query.data?.feedback ?? null;
  const [response, setResponse] = useState("");
  const [status, setStatus] = useState("");
  const [shipped, setShipped] = useState("");
  const [saved, setSaved] = useState("");
  const [failed, setFailed] = useState("");
  const invalidate = useInvalidate();
  // The form starts from the saved answer, unless the operator is
  // mid-edit: a background reload must not eat typing.
  useEffect(() => {
    if (!item) return;
    setResponse((prev) => prev || item.response || "");
    setShipped((prev) => prev || item.shipped_in || "");
    setStatus((prev) => prev || (item.status === "new" ? "seen" : item.status));
  }, [item]);
  if (query.isError)
    return (
      <div className="panel">
        <div className="panel__body">
          No feedback item #{id}.{" "}
          <Link to={`${CONSOLE}/admin/feedback`}>All feedback ›</Link>
        </div>
      </div>
    );
  if (!item) return <p style={{ color: "var(--ink-faint)" }}>Loading…</p>;
  const refs = item.refs ?? [];
  const calls = refs.filter((r) => r.kind === "call");
  const emails = refs.filter((r) => r.kind === "email");
  const pointers = refs.filter((r) => r.kind !== "call" && r.kind !== "email");
  const thread = [
    ...(item.follows_id
      ? [{ feedback_id: item.follows_id, rel: "follows" }]
      : []),
    ...(item.thread ?? [])
      .filter((t) => String(t.feedback_id) !== String(item.follows_id))
      .map((t) => ({ ...t, rel: "reply" })),
  ];
  const answer = async () => {
    setSaved("");
    setFailed("");
    const r = await api.answerFeedback({
      feedback_id: item.feedback_id,
      status,
      response: response.trim() || undefined,
      shipped_in: shipped.trim(),
      expected: {
        status: item.status,
        response: item.response ?? null,
        responded_at: item.responded_at ?? null,
      },
    });
    if (r.ok) {
      setSaved(
        r.data?.answered
          ? "Answered. The filer is told."
          : "Saved. A status alone is not news to the filer.",
      );
      invalidate(keys.adminFeedback);
    } else if (r.status === 409) {
      setFailed(r.data?.message ?? "The item changed; reload it.");
      invalidate(keys.adminFeedbackItem(id));
    } else setFailed(r.data?.message ?? "That answer was not saved.");
  };
  const block = {
    borderTop: "1px solid var(--line-soft)",
  };
  const heading = {
    fontSize: "11px",
    color: "var(--ink-faint)",
    marginBottom: "6px",
  };
  return (
    <>
      <p style={{ margin: "0 0 10px" }}>
        <Link
          className="mono"
          style={{ fontSize: "12px" }}
          to={`${CONSOLE}/admin/feedback`}
        >
          ‹ All feedback
        </Link>
      </p>
      <section className="panel" style={{ maxWidth: "720px" }}>
        <div className="panel__head">
          <span className="mono" style={{ color: "var(--ink-faint)" }}>
            fb_{item.feedback_id}
          </span>
          <span className="tag-chip">
            {FEEDBACK_AREA_LABEL[item.area] ?? item.area}
          </span>
          <span className="tag-chip">{item.category}</span>
          <span
            className={`chip ${item.status === "done" ? "chip--ok" : item.status === "new" ? "chip--warn" : "chip--info"}`}
          >
            {item.status}
          </span>
          <span
            className="mono"
            style={{
              marginLeft: "auto",
              fontSize: "11px",
              color: "var(--ink-faint)",
            }}
          >
            {viaLine(item)} · {day(item.created_at)}
          </span>
        </div>
        {/* Feedback is written in Markdown at every door, so it renders as
            Markdown where it is read. */}
        <div
          className="panel__body"
          style={{ fontSize: "13px", lineHeight: 1.6 }}
        >
          <Markdown text={item.message} />
        </div>
        {thread.length > 0 && (
          <div className="panel__body" style={block}>
            <div className="mono" style={heading}>
              THREAD
            </div>
            <p className="m-0 text-[13px]">
              {thread
                .map((t) => (
                  <Link
                    key={t.feedback_id}
                    className="mono"
                    to={`${CONSOLE}/admin/feedback/${t.feedback_id}`}
                  >
                    {t.rel === "follows" ? "replies to " : "replied in "}fb_
                    {t.feedback_id}
                  </Link>
                ))
                .flatMap((el, i) => (i ? [" · ", el] : [el]))}
            </p>
          </div>
        )}
        {pointers.length > 0 && (
          <div className="panel__body" style={block}>
            <div className="mono" style={heading}>
              ABOUT
            </div>
            <p className="m-0 text-[13px]">
              {pointers
                .map((r) => (
                  <span key={`${r.kind}${r.ref}`}>
                    {POINTER_LABEL[r.kind] ?? r.kind}{" "}
                    <span className="mono">{r.ref}</span>
                  </span>
                ))
                .flatMap((el, i) => (i ? [" · ", el] : [el]))}
            </p>
          </div>
        )}
        {calls.map((r) => (
          <AttachedCall key={r.ref} requestId={r.ref} />
        ))}
        {emails.map((r) => (
          <AttachedEmail key={r.ref} sendId={r.ref} navigate={navigate} />
        ))}
        {item.context && (
          <div className="panel__body" style={block}>
            <div className="mono" style={heading}>
              CONTEXT
            </div>
            <pre
              className="mono"
              style={{
                fontSize: "11.5px",
                overflowX: "auto",
                margin: 0,
              }}
            >
              {JSON.stringify(item.context, null, 2)}
            </pre>
          </div>
        )}
        <div
          className="panel__body"
          style={{
            ...block,
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <label>
            <span className="field-label">The answer</span>
            <textarea
              rows={5}
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              placeholder="The filer reads this: in their feed, on their page, and by email for a person."
              style={{ width: "100%" }}
            />
          </label>
          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <select
              className="select"
              aria-label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {FEEDBACK_ANSWER_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
            <input
              className="input mono w-[160px]"
              aria-label="Shipped in"
              placeholder="shipped in (11.3.0)"
              value={shipped}
              onChange={(e) => setShipped(e.target.value)}
            />
            <button
              className="btn btn--primary"
              disabled={!status}
              onClick={answer}
            >
              {response.trim() && response.trim() !== (item.response ?? "")
                ? "Send answer"
                : "Save status"}
            </button>
            {saved && (
              <span style={{ fontSize: "12px", color: "var(--ink-faint)" }}>
                {saved}
              </span>
            )}
          </div>
          {failed && <p className="field-error">{failed}</p>}
        </div>
      </section>
    </>
  );
}
