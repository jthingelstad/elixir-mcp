import { Panel, PageHead, Table } from "@elixir-mcp/ui";
import { useState } from "react";
import { api } from "../api.js";
import { keys, useAdminIntegrations, useInvalidate } from "../lib/queries.js";
const scopes = [
  "game:read",
  "players:read",
  "profiles:refresh",
  "facts:write",
  "clans:read",
  "mail:send",
];
// Permissions that act on people are ticked only on purpose.
const EXPLICIT = ["facts:write", "mail:send"];
const defaults = {
  name: "",
  daily_limit: 10000,
  hourly_limit: 2000,
  refresh_limit: 1000,
  scopes: scopes.filter((s) => !EXPLICIT.includes(s)),
};
export function Integrations() {
  const integrations = useAdminIntegrations();
  const items = integrations.data?.integrations ?? [];
  const [form, setForm] = useState(defaults),
    [selected, setSelected] = useState(null),
    [token, setToken] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const invalidate = useInvalidate();
  const load = () => invalidate(keys.adminIntegrations);
  const loadError = integrations.error
    ? (integrations.error.data?.error ?? "Could not load integrations")
    : "";
  const act = async (body) => {
    setBusy(true);
    setError("");
    try {
      const r = await api.adminIntegrationAction(body);
      if (!r.ok) {
        setError(r.data.error ?? "Request failed");
        return;
      }
      setToken(r.data.token ?? null);
      await load();
      if (body.action === "create") {
        setSelected(r.data.integration.public_id);
      }
    } catch {
      setError("Request failed. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p>
        Platform connections use the{" "}
        <a href="/docs/integrations/">Integration API</a>. Each has its own key,
        permissions and budget; supplied tags do not prove player identity.
      </p>
      {(error || loadError) && (
        <p className="notice" role="alert">
          {error || loadError}
        </p>
      )}
      {token && (
        <Panel as="div">
          <div className="panel__body">
            <strong>Copy this key now. It is shown once.</strong>
            <p>
              <code style={{ wordBreak: "break-all" }}>{token}</code>
            </p>
            <button className="btn btn--quiet" onClick={() => setToken(null)}>
              Dismiss key
            </button>
          </div>
        </Panel>
      )}
      <PageHead
        title="Integrations"
        sub={
          <>
            Service keys held by other products. Each one pulls what it needs
            over /api/v1; nothing is pushed to them.
          </>
        }
      />
      <section style={{ marginBottom: "16px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "10px",
            padding: "0 0 13px",
          }}
        >
          <span style={{ fontSize: "14px", fontWeight: 600 }}>Held by</span>
        </div>
        <Table
          columns={[
            { head: "Name", cell: (i) => i.name },
            {
              head: "Status",
              cell: (i) => (i.status === "approved" ? "Active" : "Suspended"),
            },
            {
              head: "Calls today",
              cell: (i) => (
                <>
                  {i.calls_today} / {i.daily_limit}
                </>
              ),
            },
            {
              head: "Refreshes today",
              cell: (i) => (
                <>
                  {i.refreshes_today} / {i.refresh_limit}
                </>
              ),
            },
            {
              head: "Key last used",
              cell: (i) =>
                i.tokens
                  .filter((t) => !t.revoked_at)
                  .map((t) => t.last_used_at ?? "Never")
                  .join(", ") || "Revoked",
            },
            {
              head: "Manage",
              cell: (i) => (
                <>
                  <button
                    className="btn btn--quiet"
                    disabled={busy}
                    onClick={() => {
                      setSelected(i.public_id);
                      setForm({
                        ...defaults,
                        ...i,
                      });
                      setToken(null);
                    }}
                  >
                    Configure
                  </button>{" "}
                  <button
                    className="btn btn--quiet"
                    disabled={busy}
                    onClick={() => act({ action: "rotate", id: i.public_id })}
                  >
                    Rotate key
                  </button>{" "}
                  <button
                    className="btn btn--quiet"
                    disabled={busy}
                    onClick={() => act({ action: "revoke", id: i.public_id })}
                  >
                    Revoke key
                  </button>{" "}
                  <button
                    className="btn btn--quiet"
                    disabled={busy}
                    onClick={() =>
                      act({
                        action: i.status === "approved" ? "suspend" : "resume",
                        id: i.public_id,
                      })
                    }
                  >
                    {i.status === "approved" ? "Suspend" : "Resume"}
                  </button>
                </>
              ),
            },
          ]}
          rows={items}
          rowKey={(i) => i.public_id}
        />
      </section>
      <Panel
        title={selected ? "Configure integration" : "Create integration"}
        titleAs="div"
        style={{ marginBottom: "16px" }}
      >
        <form
          className="panel__body"
          style={{ display: "grid", gap: "12px", maxWidth: "760px" }}
          onSubmit={(e) => {
            e.preventDefault();
            act({
              ...form,
              action: selected ? "configure" : "create",
              id: selected,
            });
          }}
        >
          <label>
            Name
            <input
              required
              pattern="[a-z0-9][a-z0-9-]{1,63}"
              disabled={Boolean(selected)}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <fieldset
            style={{
              border: "1px solid var(--line)",
              borderRadius: "8px",
              padding: "12px",
            }}
          >
            <legend>Permissions</legend>
            {scopes.map((scope) => (
              <label
                key={scope}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  margin: "6px 0",
                }}
              >
                <input
                  type="checkbox"
                  style={{ width: "auto", margin: 0 }}
                  checked={form.scopes.includes(scope)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      scopes: e.target.checked
                        ? [...form.scopes, scope]
                        : form.scopes.filter((s) => s !== scope),
                    })
                  }
                />
                {scope}
              </label>
            ))}
          </fieldset>
          {[
            ["daily_limit", "API calls per UTC day"],
            ["hourly_limit", "API calls per hour"],
            ["refresh_limit", "Profile refreshes per UTC day"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                min={key === "refresh_limit" ? 0 : 1}
                max={key === "daily_limit" ? 1000000 : 100000}
                required
                value={form[key]}
                onChange={(e) =>
                  setForm({ ...form, [key]: Number(e.target.value) })
                }
              />
            </label>
          ))}
          <button className="btn" disabled={busy}>
            {busy
              ? "Saving…"
              : selected
                ? "Save permissions"
                : "Create and issue key"}
          </button>{" "}
          {selected && (
            <button
              className="btn btn--quiet"
              type="button"
              disabled={busy}
              onClick={() => {
                setSelected(null);
                setForm(defaults);
                setToken(null);
              }}
            >
              New integration
            </button>
          )}
        </form>
      </Panel>
    </>
  );
}
