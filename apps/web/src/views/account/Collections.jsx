import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { Icon } from "../../components/Icon.jsx";

/**
 * Your collections — a set of players or clans you want recorded
 * together.
 *
 * `/api/me/collections` has existed since 0043 and nothing rendered it.
 *
 * BELOW THE FAMILY TIER this page is a named refusal rather than a
 * disabled version of itself. Curating a set IS a recording decision —
 * every member added starts capture — which is why it sits a tier up,
 * and that reason is the whole content of the panel. The quota chip and
 * the New collection button are HIDDEN in that state, not disabled: a
 * greyed control invites a click and then explains nothing. Browsing
 * public collections needs no tier at all, so that link is offered.
 */
/** The create form, in place: a collection is a slug, a title, a kind,
 *  who may see it and how deeply its members are recorded. Membership is
 *  edited on the collection's own record. */
function NewCollection({ onSaved, onClose }) {
  const [form, setForm] = useState({
    slug: "",
    title: "",
    kind: "player",
    visibility: "private",
    scope: "comprehensive",
  });
  const [err, setErr] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form
      className="panel"
      style={{ marginBottom: "18px" }}
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await api.myCollectionAction({ action: "upsert", ...form });
        if (r.ok) onSaved(form.slug);
        else setErr(r.data?.message ?? "Could not create that.");
      }}
    >
      <div className="panel__head">
        <span className="panel-title">New collection</span>
        <button
          type="button"
          className="btn btn--sm"
          style={{ marginLeft: "auto" }}
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div
        className="panel__body"
        style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}
      >
        <label style={{ flex: "1 1 160px" }}>
          <span className="field-label">Slug</span>
          <input
            className="mono"
            required
            pattern="[a-z0-9][a-z0-9-]{1,38}"
            placeholder="war-carriers-2026"
            value={form.slug}
            onChange={set("slug")}
          />
        </label>
        <label style={{ flex: "2 1 220px" }}>
          <span className="field-label">Title</span>
          <input
            required
            maxLength={80}
            placeholder="War carriers 2026"
            value={form.title}
            onChange={set("title")}
          />
        </label>
        <label style={{ flex: "1 1 120px" }}>
          <span className="field-label">Kind</span>
          <select value={form.kind} onChange={set("kind")}>
            <option value="player">players</option>
            <option value="clan">clans</option>
          </select>
        </label>
        <label style={{ flex: "1 1 120px" }}>
          <span className="field-label">Visibility</span>
          <select value={form.visibility} onChange={set("visibility")}>
            <option value="private">private</option>
            <option value="public">public</option>
          </select>
        </label>
        <label style={{ flex: "1 1 140px" }}>
          <span className="field-label">Scope</span>
          <select value={form.scope} onChange={set("scope")}>
            <option value="comprehensive">comprehensive</option>
            <option value="activity">activity</option>
          </select>
        </label>
        {err && (
          <p className="field-error" style={{ flexBasis: "100%" }}>
            {err}
          </p>
        )}
        <div style={{ flexBasis: "100%" }}>
          <button className="btn btn--primary">Create</button>
        </div>
      </div>
      <div className="panel__note">
        Membership is a reason to record: adding a member starts capture, and
        removing the last reason stops it. Members are added on the
        collection&rsquo;s record.
      </div>
    </form>
  );
}

export function Collections({ me, navigate }) {
  const [data, setData] = useState(null);
  const [sent, setSent] = useState("");
  const [creating, setCreating] = useState(false);

  const load = () => api.myCollections().then((r) => r.ok && setData(r.data));
  useEffect(() => {
    load();
  }, []);

  const limit = me?.entitlements?.collections?.limit;
  // Derived from the tier against collections_max, never a stored flag.
  const locked = limit === 0;
  const items = data?.collections ?? [];

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "14px",
          flexWrap: "wrap",
          marginBottom: "20px",
        }}
      >
        <div>
          <h1 className="page__title">Collections</h1>
          <p className="page__lede">
            {locked
              ? "A set of players or clans recorded together, and served to any agent that asks for it."
              : "Players or clans you want recorded together. Membership is a reason to record: adding a member starts capture; removing may stop it."}
          </p>
        </div>
        {!locked && (
          <span
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <span className="btn btn--sm" style={{ cursor: "default" }}>
              {items.length}/{limit ?? "∞"}
            </span>
            <button
              className="btn btn--primary"
              onClick={() => setCreating((v) => !v)}
            >
              <Icon name="plus" size={16} />
              New collection
            </button>
          </span>
        )}
      </div>

      {creating && !locked && (
        <NewCollection
          onClose={() => setCreating(false)}
          onSaved={(slug) => {
            setCreating(false);
            load();
            navigate(`/explore/collection/${encodeURIComponent(slug)}`);
          }}
        />
      )}

      {locked ? (
        <section className="panel" style={{ maxWidth: "66ch" }}>
          <div className="panel__body">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                marginBottom: "9px",
              }}
            >
              <span style={{ color: "var(--accent-bright)", display: "flex" }}>
                <Icon name="bookmark" size={17} />
              </span>
              <span style={{ fontSize: "14px", fontWeight: 600 }}>
                Collections start at the family tier
              </span>
              {/* The API's own word for this refusal, so a reader who
                  meets it in a tool response recognises the page. */}
              <span
                className="mono"
                style={{
                  marginLeft: "auto",
                  color: "var(--ink-faint)",
                  border: "1px solid var(--line)",
                  borderRadius: "6px",
                  padding: "2px 7px",
                }}
              >
                not_entitled
              </span>
            </div>
            <p
              style={{
                fontSize: "13.5px",
                lineHeight: 1.6,
                color: "var(--ink-dim)",
                margin: "0 0 14px",
                textWrap: "pretty",
              }}
            >
              Your tier is{" "}
              <span style={{ color: "var(--ink)" }}>{me?.role}</span>. Curating
              a set is a recording decision — every member you add starts
              capture — so it opens one tier up. Reading public collections
              needs no tier at all.
            </p>
            <div style={{ display: "flex", gap: "9px", flexWrap: "wrap" }}>
              <button
                className="btn"
                onClick={async () => {
                  const r = await api.requestRole(
                    "family",
                    "to curate collections",
                  );
                  setSent(
                    r.ok
                      ? "Requested — the owner reviews it by hand."
                      : (r.data?.message ?? "Could not send that."),
                  );
                }}
              >
                Request the family tier <Icon name="arrow-right" size={15} />
              </button>
              <a
                className="btn btn--quiet"
                onClick={() => navigate("/explore")}
              >
                Browse public collections
              </a>
            </div>
            {sent && (
              <p className="footnote" style={{ margin: "12px 0 0" }}>
                {sent}
              </p>
            )}
          </div>
        </section>
      ) : items.length === 0 ? (
        <div className="empty">
          <div className="empty__title">No collections yet</div>
          <p className="empty__body" style={{ marginBottom: 0 }}>
            A collection is a set of players or clans you want recorded together
            — a rival roster, a deck&rsquo;s pilots, the people you duo with.
            Every member added starts capture and counts against your slots.
          </p>
        </div>
      ) : (
        <div className="table__scroll">
          <table className="table" style={{ minWidth: "600px" }}>
            <thead>
              <tr>
                <th>NAME</th>
                <th>KIND</th>
                <th>VISIBILITY</th>
                <th>SCOPE</th>
                <th style={{ textAlign: "right" }}>MEMBERS</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.slug}>
                  <td>
                    <a
                      style={{ fontWeight: 600 }}
                      onClick={() =>
                        navigate(
                          `/explore/collection/${encodeURIComponent(c.slug)}`,
                        )
                      }
                    >
                      {c.title}
                    </a>
                  </td>
                  <td>{c.kind}</td>
                  <td>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "7px",
                      }}
                    >
                      <span
                        className="chip__dot"
                        style={{
                          background:
                            c.visibility === "public"
                              ? "var(--ok)"
                              : "var(--warn)",
                        }}
                      />
                      {c.visibility}
                    </span>
                  </td>
                  <td>{c.scope ?? "activity"}</td>
                  <td
                    style={{
                      textAlign: "right",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {c.member_count ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
