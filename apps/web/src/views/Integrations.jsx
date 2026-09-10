import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
const scopes = [
  "game:read",
  "players:read",
  "profiles:refresh",
  "collections:members:add",
];
const defaults = {
  name: "",
  daily_limit: 10000,
  hourly_limit: 2000,
  refresh_limit: 1000,
  member_limit: 10000,
  collection_id: "",
  scopes,
};
export function Integrations() {
  const [items, setItems] = useState([]),
    [collections, setCollections] = useState([]),
    [form, setForm] = useState(defaults),
    [selected, setSelected] = useState(null),
    [token, setToken] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [a, c] = await Promise.all([
      api.adminIntegrations(),
      api.adminCollections(),
    ]);
    if (a.ok) setItems(a.data.integrations ?? []);
    else setError(a.data.error ?? "Could not load integrations");
    if (c.ok)
      setCollections(
        (c.data.collections ?? []).filter((x) => x.kind === "player"),
      );
  }, []);
  useEffect(() => {
    load();
  }, [load]);
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
        permissions and budget. Collection additions start recording; supplied
        tags do not prove player identity.
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {token && (
        <div className="panel">
          <div className="panel__body">
            <strong>Copy this key now. It is shown once.</strong>
            <p>
              <code style={{ wordBreak: "break-all" }}>{token}</code>
            </p>
            <button className="btn btn--quiet" onClick={() => setToken(null)}>
              Dismiss key
            </button>
          </div>
        </div>
      )}
      <div style={{ marginBottom: "18px" }}>
        <h1 className="page__title">Integrations</h1>
        <p className="page__lede">
          Service keys held by other products. Each one pulls what it needs over
          /api/v1; nothing is pushed to them.
        </p>
      </div>
      <section className="panel" style={{ marginBottom: "16px" }}>
        <div className="panel__head">
          <span className="panel-title">Held by</span>
        </div>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Calls today</th>
                <th>Refreshes today</th>
                <th>Recording collections</th>
                <th>Key last used</th>
                <th>Manage</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.public_id}>
                  <td>{i.name}</td>
                  <td>{i.status === "approved" ? "Active" : "Suspended"}</td>
                  <td>
                    {i.calls_today} / {i.daily_limit}
                  </td>
                  <td>
                    {i.refreshes_today} / {i.refresh_limit}
                  </td>
                  <td>
                    {i.collections.map((c) => (
                      <div key={c.collection_id}>
                        {c.slug}: {c.members} / {c.member_limit}, {c.scope} (
                        {c.added_by_integration} added here)
                      </div>
                    ))}
                  </td>
                  <td>
                    {i.tokens
                      .filter((t) => !t.revoked_at)
                      .map((t) => t.last_used_at ?? "Never")
                      .join(", ") || "Revoked"}
                  </td>
                  <td>
                    <button
                      className="btn btn--quiet"
                      disabled={busy}
                      onClick={() => {
                        setSelected(i.public_id);
                        setForm({
                          ...defaults,
                          ...i,
                          collection_id: i.collections[0]?.collection_id ?? "",
                          member_limit: i.collections[0]?.member_limit ?? 10000,
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
                          action:
                            i.status === "approved" ? "suspend" : "resume",
                          id: i.public_id,
                        })
                      }
                    >
                      {i.status === "approved" ? "Suspend" : "Resume"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel" style={{ marginBottom: "16px" }}>
        <div className="panel__head">
          <span className="panel-title">
            {selected ? "Configure integration" : "Create integration"}
          </span>
        </div>
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
            ["member_limit", "Collection member limit"],
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
          <label>
            Allow additions to collection
            <select
              value={form.collection_id}
              onChange={(e) =>
                setForm({ ...form, collection_id: e.target.value })
              }
            >
              <option value="">No additional grant</option>
              {collections.map((c) => (
                <option key={c.collection_id} value={c.collection_id}>
                  {c.title} ({c.slug})
                </option>
              ))}
            </select>
          </label>
          <p>
            Existing members and recording depth are preserved. A grant
            authorizes additions only. Rotating a key immediately revokes its
            predecessor; budgets stay with the integration.
          </p>
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
          {selected &&
            items
              .find((i) => i.public_id === selected)
              ?.collections.map((c) => (
                <button
                  className="btn btn--quiet"
                  type="button"
                  key={c.collection_id}
                  disabled={busy}
                  onClick={() =>
                    act({
                      ...form,
                      collection_id: "",
                      action: "configure",
                      id: selected,
                      remove_collection_id: c.collection_id,
                    })
                  }
                >
                  Remove grant: {c.slug}
                </button>
              ))}
        </form>
      </section>
    </>
  );
}
