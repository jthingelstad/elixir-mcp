import { useWrite } from "@elixir-mcp/client";
import {
  ConfirmAction,
  Empty,
  Fresh,
  Link,
  PageHead,
  Panel,
  Row,
  Rows,
  Tabs,
  WriteError,
  useFlash,
} from "@elixir-mcp/ui";
import { STANDARD_OAUTH_SCOPES } from "@elixir-mcp/contracts";
import { useEffect, useState } from "react";

import { api } from "../../api.js";
import { CapabilityEditor } from "../../components/CapabilityEditor.jsx";
import { ClanRefs } from "../../components/ClanRefs.jsx";
import {
  keys,
  useInvalidate,
  useMyPrincipals,
  usePrincipalIdentities,
  useMyFeedback,
} from "../../lib/queries.js";
import { AGENT_TABS, SETTINGS } from "../../lib/settings.js";
import { TimelineDiscordState } from "./TimelineDiscord.jsx";
import { Crumb, Facts, Note } from "./parts.jsx";

const STATUS = (agent) =>
  agent.removed_at
    ? ["Removed", "chip chip--warn"]
    : agent.status !== "approved"
      ? ["Suspended", "chip chip--warn"]
      : ["Active", "chip chip--ok"];

/** Nothing here on your account: said once, for a page and a tab alike. */
export function NoAgent() {
  return (
    <Empty
      title="No agent here on your account"
      titleAs="h1"
      action={
        <Link className="btn" to={`${SETTINGS}/connections`}>
          Connections &amp; agents
        </Link>
      }
    />
  );
}

/**
 * An agent's page in Settings: its name and state over five tabs. The
 * switcher that made each agent a console of its own is gone, so an agent
 * is a record you open, with the same views yours are behind its tabs.
 */
export function AgentFrame({ publicId, tab, navigate, children }) {
  const principals = useMyPrincipals();
  const agent =
    (principals.data?.agents ?? []).find((a) => a.public_id === publicId) ??
    null;
  if (principals.isFetched && !agent) return <NoAgent />;
  if (!agent)
    return (
      <p className="text-ink-faint" role="status">
        Reading this agent.
      </p>
    );
  const [word, chip] = STATUS(agent);
  return (
    <div className="st-page">
      <Crumb to={`${SETTINGS}/connections`}>Connections &amp; agents</Crumb>
      <PageHead
        title={
          <>
            {agent.name ?? agent.public_id} <span className={chip}>{word}</span>
          </>
        }
        sub={
          <>
            {(agent.clans ?? []).length > 0 ? (
              <>
                Acts for <ClanRefs clans={agent.clans} />.
              </>
            ) : (
              "Acts as you."
            )}{" "}
            An agent&rsquo;s name is its key&rsquo;s name, and it calls at its
            own door.
          </>
        }
      />
      <Tabs
        label="This agent"
        value={tab}
        wrap
        items={AGENT_TABS.map((t) => ({
          key: t.slug,
          label: t.label,
          href: `${SETTINGS}/agents/${publicId}/${t.slug}`,
        }))}
        onSelect={(key) => navigate?.(`${SETTINGS}/agents/${publicId}/${key}`)}
      />
      {children(agent)}
    </div>
  );
}

function liveKey(agent) {
  return (agent.tokens ?? []).find((k) => !k.revoked_at) ?? null;
}

/** Shown once; the hash is all that is kept. */
function KeyOnce({ title, note, token, url, onDone }) {
  const [copied, flash] = useFlash();
  return (
    <div className="st-inset" role="status">
      <p className="m-0">
        <strong>{title}</strong> {note}
      </p>
      <code className="st-code">{token}</code>
      {url ? (
        <>
          <p className="m-0">Its address</p>
          <code className="st-code">{url}</code>
        </>
      ) : null}
      <div className="st-actions">
        <button
          type="button"
          className="btn btn--sm btn--primary"
          onClick={() => {
            navigator.clipboard?.writeText(token);
            flash();
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="btn btn--sm" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

const useRotate = () =>
  useWrite(api.rotatePrincipalToken, { invalidate: [keys.principals] });

const ISSUE = {
  title: "Issue a new key?",
  body: "The previous key stops working the moment this one is issued. The new one is shown once.",
  confirm: "Issue a new key",
};

function IssueKey({ agent, onMinted, className }) {
  const rotate = useRotate();
  return (
    <ConfirmAction
      {...ISSUE}
      label="Issue a new key"
      className={className}
      run={() => rotate.run(agent.account_id)}
      onDone={(r) => {
        if (r?.ok) onMinted(r.data.token);
      }}
    />
  );
}

/** Overview: how the agent is doing, what is refusing it, and where to
 *  connect it. */
export function AgentOverview({ agent }) {
  // The scope is this agent's, and reading an agent's list marks nothing seen.
  const feedback = useMyFeedback();
  const feedbackCount = feedback.data?.total ?? null;
  const [minted, setMinted] = useState(null);
  const [copied, flash] = useFlash();
  const key = liveKey(agent);
  // A refused call never reaches the log, so a runtime still presenting the
  // previous key looks quiet rather than broken. The only visible difference
  // is that the current key has no first use.
  const neverUsed = Boolean(key && !key.last_used_at);
  const url = `${window.location.origin}/a/${agent.public_id}/mcp`;
  const seen = agent.last_seen;
  const base = `${SETTINGS}/agents/${agent.public_id}`;
  return (
    <>
      {(agent.refusals_7d ?? []).map((r, i) => (
        <div key={i} className="callout callout--warn">
          <span>
            <strong>
              Refused attempts in the last 7 days: something is still presenting
              a credential for this agent.
            </strong>{" "}
            {r.attempts} {r.attempts === 1 ? "attempt" : "attempts"}
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
            . A revoked key still in use means a runtime somewhere is holding
            it. It reads nothing.
          </span>
        </div>
      ))}
      {neverUsed ? (
        <div className="callout callout--warn">
          <span>
            The current key has never been used since it was issued{" "}
            {key.created_at ? <Fresh ts={key.created_at} /> : null}. If
            something was running before, it is still presenting the old key and
            being refused. A refused call never reaches this page, so a quiet
            agent and a broken one look the same here.
          </span>
        </div>
      ) : null}
      {!key ? (
        <div className="callout callout--warn">
          <span>
            <strong>No live key.</strong> This agent cannot sign in until you
            issue one. Its identity, its clan and everything it has learned are
            untouched. A new key picks up where the old one left off.
          </span>
          <IssueKey agent={agent} onMinted={setMinted} />
        </div>
      ) : null}
      {minted ? (
        <KeyOnce
          title="A new key."
          note="Copy this key now. It is shown once and never again: only its hash is stored. The previous key stopped working the moment this one was issued."
          token={minted}
          onDone={() => setMinted(null)}
        />
      ) : null}
      <Panel title="This agent" titleAs="h2">
        <Facts
          rows={[
            [
              "Clan",
              <ClanRefs key="c" clans={agent.clans} empty="Your record" />,
            ],
            ["Name", agent.name ?? agent.public_id],
            [
              "Key",
              key ? (
                <>
                  {key.created_at ? (
                    <>
                      Made <Fresh ts={key.created_at} />.
                    </>
                  ) : null}{" "}
                  {key.last_used_at ? (
                    <>
                      Last used <Fresh ts={key.last_used_at} />.
                    </>
                  ) : (
                    "Never used."
                  )}
                </>
              ) : (
                "No live key"
              ),
            ],
            [
              "Last successful call",
              agent.last_call_at ? (
                <Fresh key="value" ts={agent.last_call_at} />
              ) : (
                "Never"
              ),
            ],
            seen?.ip
              ? [
                  "Connects from",
                  [seen.ip, seen.country, seen.client]
                    .filter(Boolean)
                    .join(", "),
                ]
              : null,
            [
              "Calls, 7 days",
              <>
                {(agent.calls_7d ?? 0).toLocaleString()}
                <Note>
                  Charged to your daily budget, not the agent&rsquo;s.
                </Note>
              </>,
            ],
            [
              "News it hasn't read",
              <>
                {agent.timeline_pending ?? 0} subjects
                <Note>
                  Its own place, moved by its own reads. Your looking does not
                  move it.
                </Note>
                <Link to={`${base}/timeline`}>Open its timeline</Link>
              </>,
            ],
            [
              "Feedback it has sent",
              <>
                {feedbackCount != null
                  ? `${feedbackCount.toLocaleString()} ${feedbackCount === 1 ? "item" : "items"}. `
                  : ""}
                <Link to={`${base}/feedback`}>Open its feedback</Link>
              </>,
            ],
          ]}
        />
      </Panel>
      <Panel title="Connect this agent" titleAs="h2">
        <div className="panel__body st-group">
          <p className="m-0 w-full">
            Add this as a remote MCP server in the client that runs it. Its key
            is refused at any other address.
          </p>
          <code className="st-code">{url}</code>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              navigator.clipboard?.writeText(url);
              flash();
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </Panel>
    </>
  );
}

const RENAME_REFUSED = {
  name_taken: "You already have an agent with that name.",
  invalid_name: "Lower-case letters, numbers and hyphens, 2 to 41 characters.",
  no_live_key:
    "This agent has no live key, and an agent's name is its key's name. Issue a new key first, then rename it.",
  not_found: "This agent is no longer available.",
};

function Rename({ agent, hasKey }) {
  const [draft, setDraft] = useState(agent.name ?? "");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);
  const invalidate = useInvalidate();
  return (
    <form
      className="st-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaid(null);
        setBusy(true);
        const r = await api.renamePrincipal(agent.account_id, draft);
        setBusy(false);
        if (r.ok) {
          invalidate(keys.me);
          invalidate(keys.principals);
          return;
        }
        setSaid(
          RENAME_REFUSED[r.data?.error] ?? "Could not rename this agent.",
        );
      }}
    >
      <label>
        Name
        <input
          value={draft}
          disabled={!hasKey}
          onChange={(e) => setDraft(e.target.value)}
          required
        />
      </label>
      <button className="btn btn--sm" disabled={busy || !hasKey}>
        Save
      </button>
      <Note>
        {hasKey
          ? "Lower-case letters, numbers and hyphens, 2 to 41 characters."
          : RENAME_REFUSED.no_live_key}
      </Note>
      {said ? (
        <p className="field-error w-full" role="alert">
          {said}
        </p>
      ) : null}
    </form>
  );
}

/** Settings: what you change, the reversible things before the rest. */
export function AgentSettings({ agent }) {
  const id = agent.account_id;
  const name = agent.name ?? agent.public_id;
  const key = liveKey(agent);
  const suspended = agent.status !== "approved";
  const removed = Boolean(agent.removed_at);
  const [minted, setMinted] = useState(null);
  const identities = usePrincipalIdentities(id).data?.identities ?? null;
  const invalidate = useInvalidate();
  const write = { invalidate: [keys.principals] };
  const revoke = useWrite(api.revokePrincipalToken, write);
  // The session carries the agents' count and names, so a change to which
  // are live refetches it and everything under it.
  const status = useWrite(api.setPrincipalStatus, { invalidate: [keys.me] });
  const removal = useWrite(api.setPrincipalRemoved, { invalidate: [keys.me] });
  const unmap = useWrite(api.removePrincipalIdentity, write);
  const base = `${SETTINGS}/agents/${agent.public_id}`;
  const failed = status.error ?? removal.error ?? null;

  return (
    <>
      {removed ? (
        <div className="callout callout--warn">
          <span>
            Removed. Kept and out of view, listed under Removed agents on
            Connections &amp; agents.
          </span>
          <button
            type="button"
            className="btn btn--sm"
            disabled={removal.busy}
            onClick={() => removal.run(id, false)}
          >
            Restore
          </button>
        </div>
      ) : suspended ? (
        <div className="callout callout--warn">
          <span>Suspended. Its key reads as invalid until you resume it.</span>
          <button
            type="button"
            className="btn btn--sm"
            disabled={status.busy}
            onClick={() => status.run(id, "approved")}
          >
            Resume
          </button>
        </div>
      ) : null}
      <Panel title="This agent" titleAs="h2">
        <div className="panel__body">
          <Rename agent={agent} hasKey={Boolean(key)} />
        </div>
        <Facts
          rows={[
            [
              "Timeline to Discord",
              <>
                <TimelineDiscordState agent={agent.public_id} />{" "}
                <Link to={`${base}/timeline`}>
                  Set it up on this agent&rsquo;s timeline
                </Link>
              </>,
            ],
          ]}
        />
      </Panel>
      <Panel title="Key" titleAs="h2">
        <div className="panel__body st-page">
          <p className="m-0">
            {key ? (
              removed ? (
                "Kept. Reads as invalid."
              ) : suspended ? (
                <>
                  Made <Fresh ts={key.created_at} />. Reads as invalid while
                  suspended.
                </>
              ) : (
                <>
                  Made <Fresh ts={key.created_at} />.{" "}
                  {key.last_used_at ? (
                    <>
                      Last used <Fresh ts={key.last_used_at} />.
                    </>
                  ) : (
                    "Never used."
                  )}
                </>
              )
            ) : (
              "No live key."
            )}
          </p>
          <div className="st-actions">
            <IssueKey agent={agent} onMinted={setMinted} />
            <ConfirmAction
              label="Revoke key"
              className="btn btn--sm btn--danger"
              disabled={!key}
              title="Revoke this key?"
              body="The agent stops working immediately, and there is no replacement until you issue a new one."
              confirm="Revoke key"
              run={() => revoke.run(key.token_id)}
            />
          </div>
          {minted ? (
            <KeyOnce
              title="A new key."
              note="Copy this key now. It is shown once and never again: only its hash is stored. The previous key stopped working the moment this one was issued."
              token={minted}
              onDone={() => setMinted(null)}
            />
          ) : null}
          {key ? (
            <div>
              <div className="section-title">What this key may do</div>
              <CapabilityEditor
                // A null scope means EVERY capability: that is what keys minted
                // before scopes existed still hold, so it is resolved here or
                // a key that can do everything would read as one that can do
                // nothing.
                scope={key.scope ?? STANDARD_OAUTH_SCOPES.join(" ")}
                onSave={async (scope) => {
                  const r = await api.setPrincipalScope(id, scope);
                  if (r.ok) invalidate(keys.principals);
                  return r;
                }}
              />
            </div>
          ) : null}
        </div>
      </Panel>
      <Panel title="Suspend or remove" titleAs="h2">
        <div className="panel__body st-page">
          <div className="st-actions">
            {!suspended ? (
              <ConfirmAction
                label="Suspend"
                title={`Suspend ${name}?`}
                body="Its key reads as invalid until you resume. Suspending frees the places its players and clans take, and stops recording the ones only it follows. Resuming needs the places back."
                confirm="Suspend"
                run={() => status.run(id, "disabled")}
              />
            ) : !removed ? (
              // A suspended agent's Remove takes nothing away: it keeps the
              // agent, out of view, and Restore brings it back.
              <button
                type="button"
                className="btn btn--sm"
                disabled={removal.busy}
                onClick={() => removal.run(id, true)}
              >
                Remove
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--sm"
                disabled={removal.busy}
                onClick={() => removal.run(id, false)}
              >
                Restore
              </button>
            )}
          </div>
          <p className="st-foot m-0">
            {removed
              ? "Removed: kept, out of view. Restore puts it back among your agents, still suspended."
              : suspended
                ? "Suspend is reversible: the same key comes back. Revoke is not. Suspended, its players and clans take none of your places and record only if someone else follows them. Resuming needs the places back. Remove takes a suspended agent out of view, and nothing is deleted."
                : "Suspend is reversible: the same key comes back. Revoke is not. Suspending frees the places its players and clans take, and stops recording the ones only it follows."}
          </p>
          <WriteError error={failed} />
        </div>
      </Panel>
      <Panel title="Who it answers for" titleAs="h2">
        <p className="panel__body m-0 text-ink-faint">
          An id on its own surface, mapped to a player.
        </p>
        {identities?.length === 0 ? (
          <p className="panel__body m-0 text-ink-faint">
            Nobody mapped. Someone who links Discord in their Settings is known
            to the agent by that link.
          </p>
        ) : (
          <Rows>
            {(identities ?? []).map((m) => (
              <Row
                key={m.external_id}
                title={<span className="mono">{m.external_id}</span>}
                detail={`${m.name ? `${m.name} ` : ""}${m.player_tag}`}
                right={
                  <ConfirmAction
                    label="Remove"
                    title="Remove this person from what it answers for?"
                    body={`${m.external_id} is no longer mapped to ${m.name ?? m.player_tag}. The agent asks again the next time they ask about themselves.`}
                    confirm="Remove"
                    run={() => unmap.run(id, m.external_id)}
                  />
                }
              />
            ))}
          </Rows>
        )}
      </Panel>
    </>
  );
}

const CREATE_REFUSED = (data) =>
  data?.error === "clan_not_added"
    ? "Add that clan to your account first. An agent can only act for a clan you already record."
    : data?.error === "name_taken"
      ? "You already have an agent with that name."
      : data?.error === "invalid_name"
        ? "Lower-case letters, numbers and hyphens, 2 to 41 characters."
        : data?.reason === "agent_limit"
          ? `You can have ${data.limit} agents. Stop running one, or raise the limit: run a collector.`
          : "Could not create that agent.";

/**
 * Making an agent: in place on Connections & agents, so it never costs the
 * person their place. The key is shown here, once, with the address it goes
 * with.
 */
export function NewAgent({ limit = null, onClose }) {
  const { data: principals = null } = useMyPrincipals();
  const [form, setForm] = useState({ name: "", clan_tag: "" });
  const [minted, setMinted] = useState(null);
  const [error, setError] = useState(null);
  const invalidate = useInvalidate();
  const clans = principals?.addable_clans ?? [];
  const used = (principals?.agents ?? []).filter(
    (a) => a.status === "approved",
  ).length;

  async function create(e) {
    e.preventDefault();
    setError(null);
    const res = await api.createAgent({
      name: form.name,
      clan_tag: form.clan_tag || clans[0]?.clan_tag,
    });
    if (!res.ok) {
      setError(CREATE_REFUSED(res.data));
      return;
    }
    // The address rides with the key: they are used together, and this is
    // the only moment the key exists.
    setMinted({
      token: res.data.token,
      name: form.name,
      publicId: res.data.agent?.public_id,
    });
    setForm({ name: "", clan_tag: "" });
    invalidate();
  }

  if (minted)
    return (
      <div className="panel__body">
        <KeyOnce
          title={`${minted.name} is ready.`}
          note="Copy this key now. It is shown once and never again: only its hash is stored."
          token={minted.token}
          url={
            minted.publicId
              ? `${window.location.origin}/a/${minted.publicId}/mcp`
              : null
          }
          onDone={() => {
            setMinted(null);
            onClose?.();
          }}
        />
      </div>
    );

  // The clan list comes with the read, so the form waits for it.
  if (!principals)
    return (
      <p className="panel__body m-0 text-ink-faint" role="status">
        Reading your clans.
      </p>
    );

  if (clans.length === 0)
    return (
      <div className="panel__body">
        <Empty
          title="Add a clan first"
          titleAs="h3"
          action={
            <Link className="btn" to={`${SETTINGS}/players?view=clans`}>
              Follow a clan
            </Link>
          }
        >
          An agent needs a clan to act for, and you are not following one.
        </Empty>
      </div>
    );

  return (
    <form className="panel__body st-form" onSubmit={create}>
      <label>
        Name
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
      </label>
      <label>
        Clan it acts for
        <select
          value={form.clan_tag}
          onChange={(e) => setForm({ ...form, clan_tag: e.target.value })}
        >
          {clans.map((c) => (
            <option key={c.clan_tag} value={c.clan_tag}>
              {c.name ? `${c.name} (${c.clan_tag})` : c.clan_tag}
            </option>
          ))}
        </select>
      </label>
      <span className="st-actions">
        <button type="submit" className="btn btn--sm">
          Create agent
        </button>
        <button type="button" className="btn btn--sm" onClick={onClose}>
          Cancel
        </button>
      </span>
      <Note>
        Lower-case letters, numbers and hyphens, 2 to 41 characters. It spends
        your daily calls, and you can make one for any clan you already record.
        {limit != null ? ` ${used} of ${limit} agents used.` : ""}
      </Note>
      {error ? (
        <p className="field-error w-full" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * `/settings/agents/<account_id>`, from an old bookmark to the agent page
 * before an agent's address was its public id: it opens the agent.
 */
export function AgentMoved({ id, navigate }) {
  const principals = useMyPrincipals();
  const agent =
    (principals.data?.agents ?? []).find((a) => a.account_id === id) ?? null;
  useEffect(() => {
    if (agent) navigate(`${SETTINGS}/agents/${agent.public_id}/overview`);
  }, [agent, navigate]);
  if (principals.isFetched && !agent) return <NoAgent />;
  return (
    <p className="text-ink-faint" role="status">
      Reading this agent.
    </p>
  );
}
