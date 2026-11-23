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
import { api } from "../../api.js";
import { CapabilityEditor } from "../../components/CapabilityEditor.jsx";
import { ConnectionQuestions } from "../../components/ConnectionQuestions.jsx";
import { keys, useConnections, useInvalidate } from "../../lib/queries.js";
import { SETTINGS } from "../../lib/settings.js";
import { TimelineDiscordState } from "./TimelineDiscord.jsx";
import { RssLinkPanel } from "./RssLink.jsx";
import { Facts } from "./parts.jsx";

/**
 * Connections: the apps that can act with your authority, as you.
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
          ? "A revoked key is still being presented: it reads nothing, and keeps trying until whatever holds it is stopped or re-keyed."
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

function ClientRow({ client: c, disconnect, onSaved }) {
  const { whenDay } = useClock();
  const name = c.client_name ?? "A client";
  const place = from(c.usage);
  return (
    <Row
      title={
        <>
          {name} <span className="hint">As you</span>
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
              const r = await api.setConnectionScope(c.family_id, next);
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
  const read = useConnections();
  const conns = read.data;
  const refusals = conns?.refusals ?? [];
  const clients = conns?.connections ?? [];
  const [copied, flash] = useFlash();

  const invalidate = useInvalidate();
  // A dismissed refusal also clears the rail's alert dot, which reads the
  // account's `me`: invalidate both.
  const load = () => {
    invalidate(keys.connections);
    invalidate(keys.me);
  };
  const disconnect = useWrite((familyId) => api.revokeConnection(familyId), {
    invalidate: () => load(),
  });
  // Dismissing is optimistic, and the read is refetched afterwards either
  // way, so a failed dismissal brings the row back.
  const queryClient = useQueryClient();
  const dismiss = useMutation({
    mutationFn: (body) => api.dismissRefusal(body),
    onMutate: (body) => {
      queryClient.setQueryData(keys.connections, (prev) =>
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

  const url = "https://elixir.poapkings.com/mcp";
  const copy = (
    <button
      type="button"
      className="btn btn--sm"
      onClick={() => {
        navigator.clipboard?.writeText(url);
        flash();
      }}
    >
      {copied ? "Copied" : "Copy /mcp address"}
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
          <a className="btn btn--sm" href="/docs/quickstart">
            Quickstart
          </a>
        </span>
      }
    >
      Add <span className="mono break-all">{url}</span> as a remote MCP server
      in your client. The sign-in uses the same email as this account, and what
      it may do is yours to set on the consent screen.
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

  return (
    <div className="st-page">
      <PageHead
        title="Connections"
        sub="The apps that can act with your authority."
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
                disconnect={disconnect}
                onSaved={load}
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
      <DiscordPanel me={me} />
      <RssLinkPanel />
      <p className="st-foot">
        A client signed in as you sees your players, your clans and your news.
      </p>
    </div>
  );
}
