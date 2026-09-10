import { useMemo, useState } from "react";

/**
 * The console's ONE log table.
 *
 * Activity's three views and Admin's eight pages are the same table with
 * different columns, so they are the same component: sticky header,
 * filter selects built from the rows themselves, a pager, and an
 * optional footnote. Adding a column must never mean adding a table —
 * that is how a console ends up with four table idioms and a reader who
 * has to learn each one.
 *
 * The table is INTERFACE, not a report: no card around it, no filled
 * header bar, no zebra, no tinted rows. One rule under the header, a
 * dimmer rule under each row, and hover is the only row background.
 *
 * A cell is a string, a number, or an object:
 *   { text, tone }            a dot in that tone before the text
 *   { text, onClick }         a link (used for record ids)
 *   { text, action }          a button, for the last column
 *   { text, title }           a hover title, for a shortened id
 *   { text, ink }             an explicit ink, for a latency over budget
 */
const PAGE = 25;

function cellOf(value) {
  if (value == null) return { text: "" };
  if (typeof value === "object" && !Array.isArray(value)) return value;
  return { text: String(value) };
}

/** The distinct values in a column, in the order they first appear, so a
 *  filter offers what the data actually contains rather than an enum
 *  that may have drifted from it. */
function optionsFor(rows, col) {
  const seen = [];
  for (const row of rows) {
    const text = cellOf(row[col]).text;
    if (text && !seen.includes(text)) seen.push(text);
  }
  return seen.sort((a, b) => a.localeCompare(b));
}

export function LogTable({
  title,
  note,
  crumb,
  cols,
  rows = [],
  tones = {},
  monoCols = [],
  filters = [],
  footnote,
  empty = "Nothing yet.",
  minWidth = 620,
  /** Controls that belong beside the title (a page's one primary action). */
  actions = null,
  /** Rendered between the title and the table: a form the action opens. */
  above = null,
}) {
  const [picked, setPicked] = useState({});
  const [page, setPage] = useState(0);

  const shown = useMemo(() => {
    const active = filters.filter((f) => picked[f.key]);
    if (active.length === 0) return rows;
    return rows.filter((row) =>
      active.every((f) => cellOf(row[f.col]).text === picked[f.key]),
    );
  }, [rows, filters, picked]);

  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const at = Math.min(page, pages - 1);
  const window = shown.slice(at * PAGE, at * PAGE + PAGE);
  const anyPicked = Object.values(picked).some(Boolean);

  const choose = (key, value) => {
    setPicked((p) => ({ ...p, [key]: value }));
    setPage(0);
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "14px",
          flexWrap: "wrap",
          marginBottom: "18px",
        }}
      >
        <div>
          {crumb && <div className="page__crumb">{crumb}</div>}
          <h1 className="page__title">{title}</h1>
          {note && <p className="page__lede">{note}</p>}
        </div>
        {actions && <div style={{ marginLeft: "auto" }}>{actions}</div>}
      </div>
      {above}

      {filters.length > 0 && rows.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexWrap: "wrap",
            marginBottom: "14px",
          }}
        >
          {filters.map((f) => (
            <select
              key={f.key}
              className="select"
              aria-label={f.label}
              value={picked[f.key] ?? ""}
              onChange={(e) => choose(f.key, e.target.value)}
              style={{ maxWidth: "210px" }}
            >
              <option value="">{f.label}: any</option>
              {optionsFor(rows, f.col).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ))}
          {anyPicked && (
            <button
              className="btn btn--quiet"
              onClick={() => {
                setPicked({});
                setPage(0);
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty">
          <p className="empty__body" style={{ marginBottom: 0 }}>
            {empty}
          </p>
        </div>
      ) : (
        <>
          <div className="table__scroll">
            <table className="table" style={{ minWidth: `${minWidth}px` }}>
              <thead>
                <tr>
                  {cols.map(([label, align]) => (
                    <th
                      key={label}
                      style={
                        align === "right" ? { textAlign: "right" } : undefined
                      }
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {window.map((row, i) => (
                  <tr key={at * PAGE + i}>
                    {cols.map(([label, align], c) => {
                      const cell = cellOf(row[c]);
                      const tone = cell.tone ?? tones[cell.text];
                      const mono = monoCols.includes(c);
                      return (
                        <td
                          key={label}
                          title={cell.title}
                          className={
                            (align === "right" ? "table__td--num " : "") +
                            (mono ? "mono" : "")
                          }
                          style={{
                            textAlign: align === "right" ? "right" : undefined,
                            fontFamily:
                              mono || align === "right"
                                ? "var(--font-mono)"
                                : undefined,
                            color: cell.ink,
                          }}
                        >
                          {cell.action ? (
                            <button
                              className="btn btn--sm"
                              onClick={cell.action}
                            >
                              {cell.text}
                            </button>
                          ) : cell.onClick ? (
                            <a onClick={cell.onClick}>{cell.text}</a>
                          ) : tone ? (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "7px",
                                color: `var(--${tone})`,
                              }}
                            >
                              <span
                                className="chip__dot"
                                style={{ background: `var(--${tone})` }}
                              />
                              {cell.text}
                            </span>
                          ) : (
                            cell.text
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {footnote && (
            <p
              className="footnote"
              style={{
                margin: "14px 2px 0",
                maxWidth: "78ch",
                textWrap: "pretty",
              }}
            >
              {footnote}
            </p>
          )}

          <div className="pager">
            <span>
              {shown.length === 0
                ? "nothing matches those filters"
                : `${at * PAGE + 1}–${Math.min(shown.length, at * PAGE + PAGE)} of ${shown.length.toLocaleString()}`}
              {anyPicked && rows.length !== shown.length
                ? ` (filtered from ${rows.length.toLocaleString()})`
                : ""}
            </span>
            <span style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
              <button
                className="btn btn--sm"
                disabled={at === 0}
                onClick={() => setPage(at - 1)}
              >
                Newer
              </button>
              <button
                className="btn btn--sm"
                disabled={at >= pages - 1}
                onClick={() => setPage(at + 1)}
              >
                Older
              </button>
            </span>
          </div>
        </>
      )}
    </>
  );
}
