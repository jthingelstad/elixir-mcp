import { Fresh, Icon, useClock } from "@elixir-mcp/ui";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api.js";
import {
  rootFor,
  scopedKey,
  useConnections,
  useInvalidate,
  useMyPrincipals,
} from "../../lib/queries.js";
import { useScope } from "../../lib/scope.js";
import { CapabilityEditor } from "../../components/CapabilityEditor.jsx";
import { ClanRefs } from "../../components/ClanRefs.jsx";
import { ConnectionQuestions } from "../../components/ConnectionQuestions.jsx";

/**
 * Connections — everything that can call Elixir with your authority.
 *
 * One typed table, not two. An OAuth client you consented to and an
 * agent holding its own key are different mechanisms with the same
 * consequence: they read your record and they spend your daily budget.
 * Splitting them across two screens meant the question "what can reach
 * my data" had two answers and neither was complete.
 *
 * Each row says which DOOR it uses (/mcp is you; /a/<id>/mcp is an
 * agent) and whether it acts AS YOU or FOR A CLAN, because those are the
 * two things that decide what a caller sees.
 *
 * The headline failure gets a callout of its own: a credential that no
 * longer works but is still being presented. It reads nothing, but it
 * will keep trying until somebody stops it, and nothing else on the
 * account would ever mention it.
 */
export function Connections({ me, navigate }) {
  const { day } = useClock();
  // On an agent's console (2026-09-23) this page is the agent's: the
  // clients connected AS it, the refusals of its key, and its own door.
  // Yours lists your clients and one row per agent you own, each opening
  // its console.
  const scope = useScope();
  const conns = useConnections().data;
  const connections = conns?.connections ?? null;
  const refusals = conns?.refusals ?? [];
  const principals = useMyPrincipals().data?.agents ?? null;
  const agents = scope ? [] : principals;
  const [copied, setCopied] = useState(false);

  const invalidate = useInvalidate();
  // A dismissed refusal also clears the rail's alert dot, which reads
  // the console's `me`: invalidate both.
  const load = () => {
    invalidate(scopedKey(scope, "connections"));
    invalidate(rootFor(scope));
  };
  // Dismissing is optimistic - the row goes as you click - and the
  // read is refetched afterwards either way, so a failed dismissal
  // brings the row back rather than leaving a lie on screen.
  const queryClient = useQueryClient();
  const dismiss = useMutation({
    mutationFn: (body) => api.dismissRefusal(body, scope),
    onMutate: (body) => {
      queryClient.setQueryData(scopedKey(scope, "connections"), (prev) =>
        prev
          ? {
              ...prev,
              refusals: body.all
                ? []
                : (prev.refusals ?? []).filter(
                    (x) => x.refusal_id !== body.refusal_id,
                  ),
            }
          : prev,
      );
    },
    onSettled: load,
  });

  // The door this console's account connects at.
  const door = scope ? `/a/${scope}/mcp` : "/mcp";
  const url = `${window.location.origin}${door}`;
  const clients = connections ?? [];
  // Each agent you own is one row: a client connected as it is listed on
  // its console, not here.
  const keyed = agents ?? [];
  const total = clients.length + keyed.length;

  return (
    <>
      <div style={{ marginBottom: "18px" }}>
        <h1 className="page__title">Connections</h1>
        <p className="page__lede">
          {scope
            ? "Every client connected as this agent. All of it spends your daily budget."
            : "Everything that can call Elixir with your authority. All of it spends your daily budget."}
        </p>
      </div>

      {refusals.map((r, i) => (
        <div
          key={i}
          className="callout callout--warn"
          style={{ marginBottom: "14px", alignItems: "center" }}
        >
          <Icon name="circle-dashed" size={17} />
          <span>
            <span className="mono">{r.reason}</span> · {r.attempts}{" "}
            {r.attempts === 1 ? "refused attempt" : "refused attempts"}
            {r.ip ? (
              <>
                {" from "}
                <span className="mono">{r.ip}</span>
                {r.country ? ` (${r.country})` : ""}
              </>
            ) : null}
            {r.last_seen ? (
              <>
                {", last "}
                <Fresh ts={r.last_seen} />
              </>
            ) : null}
            .{" "}
            {r.kind === "service_token"
              ? "A revoked or suspended agent key, or a service token, is still being presented: it reads nothing, and keeps trying until whatever holds it is stopped or re-keyed."
              : "Usually a client you disconnected that is still running: it reads nothing, and keeps trying until it is stopped."}
          </span>
          {/* An alert you cannot acknowledge teaches you to ignore
              alerts. Dismissing is per row — one credential, one source,
              one day — so it says "I have seen today's", and a refusal
              that is still happening tomorrow says so again. */}
          <a
            style={{ marginLeft: "auto", flex: "none", fontSize: "13px" }}
            title="Dismiss. It returns if the credential is presented again another day."
            onClick={() => dismiss.mutate({ refusal_id: r.refusal_id })}
          >
            Dismiss
          </a>
        </div>
      ))}
      {refusals.length > 1 && (
        <p style={{ margin: "-6px 0 14px", fontSize: "13px" }}>
          <a onClick={() => dismiss.mutate({ all: true })}>
            Dismiss all {refusals.length}
          </a>
        </p>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexWrap: "wrap",
          padding: "0 0 13px",
        }}
      >
        <span style={{ fontSize: "14px", fontWeight: 600 }}>
          {total} with access
        </span>
        {!scope && (
          <button
            className="btn"
            style={{ marginLeft: "auto" }}
            onClick={() => navigate("/account/agents")}
          >
            <Icon name="plus" size={16} />
            New agent
          </button>
        )}
        <button
          className={"btn btn--primary" + (scope ? " ml-auto" : "")}
          onClick={() => {
            navigator.clipboard?.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : `Copy ${scope ? "its" : "/mcp"} URL`}
        </button>
      </div>

      {connections !== null && total === 0 ? (
        <div className="empty">
          <div className="empty__title">Nothing connected yet</div>
          <p className="empty__body">
            Add <span className="mono">{url}</span> as a remote MCP server in
            your client. The sign-in uses the same email as this account, and
            what it may do is yours to set on the consent screen.
          </p>
          <a className="btn" href="/docs/quickstart">
            Quickstart <Icon name="arrow-right" size={15} />
          </a>
        </div>
      ) : (
        <div className="table__scroll" tabIndex={0}>
          <table className="table" style={{ minWidth: "760px" }}>
            <thead>
              <tr>
                <th>CALLER</th>
                <th>ACTS</th>
                <th>MAY DO</th>
                <th>LAST CALL</th>
                <th style={{ textAlign: "right" }}>7D</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                // On an agent's console every client acts as the agent.
                const agent = scope
                  ? { kind: "agent", public_id: scope }
                  : c.principal;
                return (
                  <tr key={c.family_id}>
                    <td>
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "9px",
                        }}
                      >
                        <span
                          style={{
                            color: "var(--accent-bright)",
                            display: "flex",
                          }}
                        >
                          <Icon name="plug" size={16} />
                        </span>
                        <span style={{ fontWeight: 600, fontSize: "14px" }}>
                          {c.client_name ?? "client"}
                        </span>
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: "12px",
                          color: "var(--ink-faint)",
                          marginTop: "3px",
                        }}
                      >
                        connected {day(c.created_at)}
                        {c.usage?.ip ? ` · ${c.usage.ip}` : ""}
                        {c.usage?.country ? ` (${c.usage.country})` : ""}
                      </span>
                    </td>
                    <td>
                      <span
                        className="btn btn--sm"
                        style={{ cursor: "default" }}
                      >
                        {agent ? "for a clan" : "as you"}
                      </span>
                      <span
                        className="mono"
                        style={{
                          display: "block",
                          color: "var(--ink-faint)",
                          marginTop: "4px",
                        }}
                      >
                        {agent
                          ? `/${agent.kind === "agent" ? "a" : "i"}/${agent.public_id}/mcp`
                          : "/mcp"}
                      </span>
                    </td>
                    <td style={{ whiteSpace: "normal" }}>
                      <CapabilityEditor
                        scope={c.scope ?? "cr:read"}
                        onSave={async (next) => {
                          const r = await api.setConnectionScope(
                            c.family_id,
                            next,
                            scope,
                          );
                          if (r.ok) load();
                          return r;
                        }}
                      />
                      <span
                        style={{
                          display: "block",
                          fontSize: "12px",
                          color: "var(--ink-faint)",
                        }}
                      >
                        granted at sign-in
                      </span>
                    </td>
                    <td>
                      {/* When it last CALLED, not when it last collected a
                          token: a client that refreshes on a timer looks
                          busy by the second measure and may have done
                          nothing for weeks. */}
                      <Fresh ts={c.usage?.at ?? c.last_token_at} />
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {c.usage?.calls_7d ?? 0}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn btn--sm"
                        onClick={async () => {
                          await api.revokeConnection(c.family_id, scope);
                          load();
                        }}
                      >
                        Disconnect
                      </button>
                    </td>
                  </tr>
                );
              })}
              {keyed.map((a) => (
                <tr key={a.account_id ?? a.public_id}>
                  <td>
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "9px",
                      }}
                    >
                      <span
                        style={{
                          color:
                            a.status === "approved"
                              ? "var(--accent-bright)"
                              : "var(--warn)",
                          display: "flex",
                        }}
                      >
                        <Icon name="shield-check" size={16} />
                      </span>
                      <a
                        style={{ fontWeight: 600, fontSize: "14px" }}
                        onClick={() =>
                          navigate(`/agent/${a.public_id}/overview`)
                        }
                      >
                        {a.name ?? a.public_id}
                      </a>
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: "12px",
                        color:
                          a.status === "approved"
                            ? "var(--ink-faint)"
                            : "var(--warn)",
                        marginTop: "3px",
                      }}
                    >
                      {a.status === "approved"
                        ? "agent · its own key"
                        : "suspended · key reads as invalid"}
                    </span>
                  </td>
                  <td>
                    <span className="btn btn--sm" style={{ cursor: "default" }}>
                      {(a.clans ?? []).length > 0 ? "for a clan" : "as you"}
                    </span>
                    <span
                      className="mono"
                      style={{
                        display: "block",
                        color: "var(--ink-faint)",
                        marginTop: "4px",
                      }}
                    >
                      /a/{a.public_id}/mcp
                    </span>
                  </td>
                  <td style={{ whiteSpace: "normal" }}>
                    <ClanRefs
                      clans={a.clans}
                      navigate={navigate}
                      empty="your record"
                    />
                    <span
                      style={{
                        display: "block",
                        fontSize: "12px",
                        color: "var(--ink-faint)",
                      }}
                    >
                      set on the agent
                    </span>
                  </td>
                  <td>
                    <Fresh ts={a.last_call_at} />
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {a.calls_7d ?? 0}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="btn btn--sm"
                      onClick={() => navigate(`/agent/${a.public_id}/overview`)}
                    >
                      Open
                    </button>
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
        A client signed in as you sees your players, your clans and your feed.
        An agent sees what its own key allows and, if it is a clan&rsquo;s
        agent, that clan — which is what makes the two different.
      </p>

      {/* The first-answer questions are about YOU; an agent's console
          has no person to ask them about. */}
      {!scope && (
        <div style={{ marginTop: "24px" }}>
          <ConnectionQuestions
            claimsKey={(me?.claims ?? [])
              .map((c) => `${c.player_tag}:${c.is_primary}`)
              .join(",")}
            navigate={navigate}
          />
        </div>
      )}
    </>
  );
}
