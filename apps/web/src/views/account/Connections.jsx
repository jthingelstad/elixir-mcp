import { useWrite } from "../../client/index.ts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ConfirmAction,
  Empty,
  ErrorState,
  Fresh,
  Link,
  PageHead,
  Panel,
  Row,
  Rows,
  WriteError,
  useClock,
  useFlash,
} from "@elixir-mcp/ui";
import { useState } from "react";
import { api } from "../../api.js";
import { CapabilityEditor } from "../../components/CapabilityEditor.jsx";
import { ConnectionQuestions } from "../../components/ConnectionQuestions.jsx";
import {
  keys,
  rootFor,
  scopedKey,
  useConnections,
  useInvalidate,
  useMyPrincipals,
} from "../../lib/queries.js";
import { useScope } from "../../lib/scope.js";
import { SETTINGS } from "../../lib/settings.js";
import { NewAgent } from "./Agents.jsx";
import { TimelineDiscordState } from "./TimelineDiscord.jsx";
import { RssLinkPanel } from "./RssLink.jsx";
import { Facts } from "./parts.jsx";

/**
 * Connections & agents: the apps and agents that can act with your
 * authority. Apps you connected act as you; an agent acts for a clan with
 * its own key. An agent's own Connections tab is the same list of clients,
 * without the agents, the questions or a new key.
 *
 * The headline failure gets a callout of its own: a credential that no
 * longer works but is still being presented. It reads nothing, but it will
 * keep trying until somebody stops it, and nothing else on the account
 * would ever mention it.
 */
const from = (u) =>
  u?.ip ? `from ${u.ip}${u.country ? ` (${u.country})` : ""}` : null;

function Refusal({ r, onDismiss }) {
  const key = r.kind === "service_token";
  return (
    <div className="callout callout--warn">
      <span>
        <strong>
          {key
            ? "An old key is still trying to connect."
            : "A client you disconnected may still be running."}
        </strong>{" "}
        {r.attempts} refused {r.attempts === 1 ? "attempt" : "attempts"}
        {r.ip ? (
          <>
            {" from "}
            <span className="mono">{r.ip}</span>
            {r.country ? ` (${r.country})` : ""}
          </>
        ) : null}
        {r.last_seen ? (
          <>
            , last <Fresh ts={r.last_seen} />
          </>
        ) : null}
        .{" "}
        {key
          ? "A revoked or suspended agent key is still being presented: it reads nothing, and keeps trying until whatever holds it is stopped or re-keyed."
          : "It reads nothing, and keeps trying until it is stopped."}
      </span>
      {/* Dismissing is per row, one credential, one source, one day: it says
          "I have seen today's", and one still happening tomorrow says so
          again. */}
      <button
        type="button"
        className="btn btn--sm"
        title="It returns if it is presented again another day."
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}

function ClientRow({ client: c, scope, disconnect, onSaved, acts }) {
  const { whenDay } = useClock();
  const name = c.client_name ?? "A client";
  const place = from(c.usage);
  return (
    <Row
      title={
        <>
          {name} <span className="hint">{acts}</span>
        </>
      }
      detail={
        <>
          Connected {whenDay(c.created_at)}
          {place ? ` ${place}` : " from an address not seen"}.{" "}
          {c.usage?.at ? (
            <>
              Last call <Fresh ts={c.usage.at} />.{" "}
              {(c.usage.calls_7d ?? 0).toLocaleString()} calls, 7 days.
            </>
          ) : (
            "No calls."
          )}
        </>
      }
      right={
        <span className="st-row-actions">
          <CapabilityEditor
            name={name}
            scope={c.scope ?? "cr:read"}
            onSave={async (next) => {
              const r = await api.setConnectionScope(c.family_id, next, scope);
              if (r.ok) onSaved();
              return r;
            }}
          />
          <ConfirmAction
            label="Disconnect"
            title={`Disconnect ${name}?`}
            body="It stops reading your record at once. Anything still running keeps trying, and is refused. You can connect it again at any time."
            confirm="Disconnect"
            run={() => disconnect.run(c.family_id)}
          />
        </span>
      }
    />
  );
}

function AgentRow({ agent: a }) {
  const { whenDay } = useClock();
  const clan = (a.clans ?? [])[0];
  const key = (a.tokens ?? []).find((k) => !k.revoked_at);
  const active = a.status === "approved";
  return (
    <Row
      title={
        <>
          {a.name ?? a.public_id}{" "}
          <span className={active ? "chip chip--ok" : "chip chip--warn"}>
            {active ? "Active" : "Suspended"}
          </span>
        </>
      }
      detail={
        <>
          {clan ? `Acts for ${clan.name ?? clan.clan_tag}.` : "Acts as you."}{" "}
          {a.last_call_at ? (
            <>
              Last call <Fresh ts={a.last_call_at} />.
            </>
          ) : (
            "No calls yet."
          )}{" "}
          {(a.calls_7d ?? 0).toLocaleString()} calls, 7 days.
          {key?.created_at ? ` Key made ${whenDay(key.created_at)}.` : ""}
        </>
      }
      right="Open ›"
      href={`${SETTINGS}/agents/${a.public_id}/overview`}
    />
  );
}

function DiscordPanel({ me }) {
  return (
    <Panel
      title="Discord"
      titleAs="h2"
      action={
        <Link className="btn btn--sm" to={`${SETTINGS}/connections/discord`}>
          Manage Discord
        </Link>
      }
    >
      <Facts
        rows={[
          me?.features?.discord_login || me?.discord
            ? [
                "Your Discord",
                me?.discord
                  ? `Connected as ${me.discord.username}`
                  : "Not connected.",
              ]
            : null,
          ["Timeline to Discord", <TimelineDiscordState key="state" />],
        ]}
      />
    </Panel>
  );
}

export function Connections({ me, navigate }) {
  const scope = useScope();
  const read = useConnections();
  const conns = read.data;
  const refusals = conns?.refusals ?? [];
  const clients = conns?.connections ?? [];
  const principals = useMyPrincipals();
  const everyAgent = scope ? [] : (principals.data?.agents ?? []);
  const agents = everyAgent.filter((a) => !a.removed_at);
  const removed = everyAgent.filter((a) => a.removed_at);
  const [copied, flash] = useFlash();
  const [adding, setAdding] = useState(false);

  const invalidate = useInvalidate();
  // A dismissed refusal also clears the rail's alert dot, which reads the
  // account's `me`: invalidate both.
  const load = () => {
    invalidate(scopedKey(scope, "connections"));
    invalidate(rootFor(scope));
  };
  const disconnect = useWrite(
    (familyId) => api.revokeConnection(familyId, scope),
    { invalidate: () => load() },
  );
  const restore = useWrite(api.setPrincipalRemoved, {
    invalidate: [keys.me],
  });
  // Dismissing is optimistic, and the read is refetched afterwards either
  // way, so a failed dismissal brings the row back.
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

  const door = scope ? `/a/${scope}/mcp` : "/mcp";
  const url = `https://elixir.poapkings.com${door}`;
  const copy = (
    <button
      type="button"
      className="btn btn--sm"
      onClick={() => {
        navigator.clipboard?.writeText(url);
        flash();
      }}
    >
      {copied ? "Copied" : scope ? "Copy its address" : "Copy /mcp address"}
    </button>
  );

  if (read.isError && !conns)
    return (
      <ErrorState
        title="Your connections could not be read just now"
        onRetry={read.refetch}
        busy={read.isFetching}
      >
        Nothing has changed. Try again in a moment.
      </ErrorState>
    );

  const empty = conns && clients.length === 0 && (
    <Empty
      title="Nothing connected yet"
      titleAs="h2"
      action={
        <span className="st-actions">
          {copy}
          {scope ? null : (
            <a className="btn btn--sm" href="/docs/quickstart">
              Quickstart
            </a>
          )}
        </span>
      }
    >
      Add <span className="mono break-all">{url}</span> as a remote MCP server
      in your client.
      {scope
        ? null
        : " The sign-in uses the same email as this account, and what it may do is yours to set on the consent screen."}
    </Empty>
  );

  const callouts = (
    <>
      {refusals.map((r) => (
        <Refusal
          key={r.refusal_id}
          r={r}
          onDismiss={() => dismiss.mutate({ refusal_id: r.refusal_id })}
        />
      ))}
      {refusals.length > 1 ? (
        <p className="m-0">
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => dismiss.mutate({ all: true })}
          >
            Dismiss all {refusals.length}
          </button>{" "}
          <span className="hint">
            Each returns if it is presented again another day.
          </span>
        </p>
      ) : null}
      <WriteError error={disconnect.error} className="field-error" />
    </>
  );

  if (scope)
    return (
      <div className="st-page">
        {callouts}
        <div className="st-group">
          <p className="m-0">
            Every client connected as this agent. All of it spends your daily
            budget.
          </p>
          {clients.length ? copy : null}
        </div>
        {clients.length ? (
          <Panel title="Connected" titleAs="h2">
            <Rows>
              {clients.map((c) => (
                <ClientRow
                  key={c.family_id}
                  client={c}
                  scope={scope}
                  disconnect={disconnect}
                  onSaved={load}
                  acts="For a clan"
                />
              ))}
            </Rows>
          </Panel>
        ) : (
          empty
        )}
      </div>
    );

  return (
    <div className="st-page">
      <PageHead
        title="Connections & agents"
        sub="The apps and agents that can act with your authority."
        aside={clients.length ? copy : null}
      />
      {callouts}
      {conns && clients.length === 0 ? (
        empty
      ) : (
        <Panel
          title="Apps you connected"
          titleAs="h2"
          action={<span className="hint">{clients.length} active</span>}
        >
          <Rows>
            {clients.map((c) => (
              <ClientRow
                key={c.family_id}
                client={c}
                scope={null}
                disconnect={disconnect}
                onSaved={load}
                acts="As you"
              />
            ))}
          </Rows>
        </Panel>
      )}
      <ConnectionQuestions
        claimsKey={(me?.claims ?? [])
          .map((c) => `${c.player_tag}:${c.is_primary}`)
          .join(",")}
        navigate={navigate}
      />
      <Panel
        title="Your agents"
        titleAs="h2"
        action={
          <button
            type="button"
            className="btn btn--sm"
            aria-expanded={adding}
            onClick={() => setAdding(!adding)}
          >
            New agent
          </button>
        }
      >
        <p className="panel__body m-0 text-ink-faint">
          An agent acts for a clan rather than for you, with its own key and its
          own news feed. What it does never lands in your history. It spends
          your daily calls.
        </p>
        {adding ? (
          <NewAgent
            limit={me?.entitlements?.agents?.limit}
            onClose={() => setAdding(false)}
          />
        ) : null}
        {principals.data && agents.length === 0 ? (
          <p className="panel__body m-0 text-ink-faint">
            No agents yet. An agent is for a clan you already record. It answers
            your clanmates without any of them signing in.
          </p>
        ) : (
          <Rows>
            {agents.map((a) => (
              <AgentRow key={a.account_id ?? a.public_id} agent={a} />
            ))}
          </Rows>
        )}
        {removed.length > 0 ? (
          <details className="panel__body">
            <summary>Removed agents ({removed.length})</summary>
            <p className="text-ink-faint">
              Suspended and out of view. It keeps its address and everything it
              has learned.
            </p>
            <WriteError error={restore.error} className="field-error" />
            <Rows>
              {removed.map((a) => (
                <Row
                  key={a.account_id}
                  title={
                    <Link to={`${SETTINGS}/agents/${a.public_id}/settings`}>
                      {a.name ?? a.public_id}
                    </Link>
                  }
                  right={
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={restore.busy}
                      onClick={() => restore.run(a.account_id, false)}
                    >
                      Restore
                    </button>
                  }
                />
              ))}
            </Rows>
          </details>
        ) : null}
      </Panel>
      <DiscordPanel me={me} />
      <RssLinkPanel />
      <p className="st-foot">
        A client signed in as you sees your players, your clans and your news.
        An agent sees what its own key allows and, if it is a clan&rsquo;s
        agent, that clan.
      </p>
    </div>
  );
}
