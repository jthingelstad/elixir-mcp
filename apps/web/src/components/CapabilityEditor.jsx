import { useState } from "react";
import { OAUTH_SCOPE_DETAILS, OAUTH_SCOPES } from "@elixir-mcp/contracts";

/**
 * What a credential may do, edited in place.
 *
 * TWO credentials carry capabilities and neither could be changed after it
 * was issued: an OAuth connection, whose scope lives on the grant, and an
 * agent's service key, whose scope lives on the token. One editor for
 * both, because the rules are identical and two copies would drift.
 *
 * The caller passes the RESOLVED scope. A service key with a null scope
 * holds every capability - that is what keys minted before the column
 * existed still carry - so null must be resolved to the full set before it
 * reaches here, or the checkboxes would show nothing and read as "can do
 * nothing" for a key that can do everything.
 */
export function CapabilityEditor({ scope, onSave, disabled = false }) {
  const current = scope.split(" ").filter(Boolean);
  const [editing, setEditing] = useState(false);
  const [chosen, setChosen] = useState(current);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  if (!editing)
    return (
      <>
        <span className="mono">{scope}</span>{" "}
        {!disabled && (
          <button
            className="btn--text"
            onClick={() => {
              setChosen(current);
              setError(null);
              setEditing(true);
            }}
          >
            Edit
          </button>
        )}
      </>
    );

  const toggle = (value) =>
    setChosen((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value],
    );

  return (
    <div>
      {OAUTH_SCOPE_DETAILS.map(({ scope: value, title, description }) => (
        <label key={value} style={{ display: "block", fontSize: "12.5px" }}>
          <input
            type="checkbox"
            checked={chosen.includes(value)}
            // Reading recorded data is what every read tool needs; a
            // credential without it can do nothing at all, so it is not
            // offered as a choice.
            disabled={value === OAUTH_SCOPES[0]}
            onChange={() => toggle(value)}
          />{" "}
          <span className="mono">{value}</span> — {title}
          <div style={{ color: "var(--faint)", marginLeft: "20px" }}>
            {description}
          </div>
        </label>
      ))}
      {error && (
        <div style={{ color: "var(--amber)", fontSize: "12.5px" }}>{error}</div>
      )}
      <button
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          const r = await onSave(chosen.join(" "));
          setSaving(false);
          if (!r.ok) {
            setError(r.data?.hint ?? "Could not change capabilities.");
            return;
          }
          setEditing(false);
        }}
      >
        {saving ? "Saving…" : "Save"}
      </button>{" "}
      <button className="btn--text" onClick={() => setEditing(false)}>
        Cancel
      </button>
    </div>
  );
}
