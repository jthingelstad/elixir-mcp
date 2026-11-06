/* The explicit roles are deliberate. A cards table is display: block at phone
   width, and a browser then drops a table's implicit roles for a reader. */
/* oxlint-disable jsx-a11y/no-redundant-roles, jsx-a11y/no-interactive-element-to-noninteractive-role */
import {
  Fragment,
  type CSSProperties,
  type HTMLAttributes,
  type Key,
  type ReactNode,
  type TdHTMLAttributes,
} from "react";

export interface TableColumn<R> {
  /** Stable key; defaults to the head's text, then the column's place. */
  key?: string;
  /** The real header cell's contents. */
  head: ReactNode;
  /** The label a phone row shows; needed only when `head` is not text. */
  label?: string;
  /** A number: right-aligned, tabular, unwrapped. */
  num?: boolean;
  /** Prose: may wrap (cells stay on one line otherwise on a wide screen). */
  wrap?: boolean;
  /** The row's title on a phone. Defaults to the first column. */
  lead?: boolean;
  /** This cell names its row: a `th scope="row"`. */
  rowHeader?: boolean;
  headClassName?: string;
  className?: string | ((row: R, index: number) => string | undefined);
  cellProps?: (row: R, index: number) => TdHTMLAttributes<HTMLTableCellElement>;
  cell: (row: R, index: number) => ReactNode;
}

export interface TableGroup<R> {
  key: Key;
  rows: R[];
}

/**
 * The one data table. Columns are declared once, so the header, each cell
 * and each cell's phone label cannot drift apart.
 *
 * `phone` says what it does at phone width; none scrolls the page sideways.
 * - "cards" (default): each row is a block, its lead cell the title and the
 *   rest label and value. The header stays for a screen reader.
 * - "fit": the columns stay and tighten, for a few short columns. A page's
 *   own rules may finish the job (Ladder's decks).
 * - "scroll": sideways inside its own box. Admin only: Admin is unchanged.
 */
export function Table<R>({
  columns,
  rows,
  groups,
  rowKey,
  rowProps,
  rowAfter,
  caption,
  empty,
  foot,
  noHead = false,
  phone = "cards",
  minWidth,
  className,
  label,
  labelledBy,
  region,
}: {
  columns: TableColumn<R>[];
  rows?: R[];
  /** Several `tbody`s, for a table in sections. Instead of `rows`. */
  groups?: TableGroup<R>[];
  rowKey?: (row: R, index: number) => Key;
  rowProps?: (row: R, index: number) => HTMLAttributes<HTMLTableRowElement>;
  /** A full-width row after this one, when it has one. */
  rowAfter?: (row: R, index: number) => ReactNode;
  /** Read by a screen reader only. */
  caption?: ReactNode;
  /** One full-width row when there are no rows. */
  empty?: ReactNode;
  /** One full-width row under all the others ("6 more members"). */
  foot?: ReactNode;
  /** A list with no header cells. Cells have no phone labels either. */
  noHead?: boolean;
  phone?: "cards" | "fit" | "scroll";
  /** The width below which a wide screen scrolls it inside its own box. */
  minWidth?: number;
  className?: string;
  label?: string;
  /** The id of the heading that names it: the box becomes that region. */
  labelledBy?: string;
  /** Names the box as a region, for a page of several tables. */
  region?: string;
}) {
  const leadAt = Math.max(
    columns.findIndex((c) => c.lead),
    0,
  );
  const labelOf = (c: TableColumn<R>) =>
    noHead
      ? undefined
      : (c.label ?? (typeof c.head === "string" ? c.head : undefined)) ||
        undefined;

  const drawRow = (row: R, i: number) => {
    const after = rowAfter?.(row, i);
    return (
      <Fragment key={rowKey ? rowKey(row, i) : i}>
        <tr role="row" {...rowProps?.(row, i)}>
          {columns.map((c, at) => {
            const Cell = c.rowHeader ? "th" : "td";
            const own =
              typeof c.className === "function"
                ? c.className(row, i)
                : c.className;
            return (
              <Cell
                key={c.key ?? at}
                role={c.rowHeader ? "rowheader" : "cell"}
                {...(c.rowHeader ? { scope: "row" } : null)}
                data-h={labelOf(c)}
                {...c.cellProps?.(row, i)}
                className={
                  [
                    at === leadAt ? "kit-table__lead" : "",
                    c.num ? "kit-table__num" : "",
                    c.wrap ? "table__td--wrap" : "",
                    own,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
              >
                <div className="kit-table__v">{c.cell(row, i)}</div>
              </Cell>
            );
          })}
        </tr>
        {after ? (
          <tr role="row" className="kit-table__after">
            <td role="cell" colSpan={columns.length}>
              {after}
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  };

  const sections = groups ?? [{ key: "rows", rows: rows ?? [] }];
  const none = sections.every((s) => s.rows.length === 0);
  let n = 0;

  return (
    <div
      className={`kit-table-box kit-table-box--${phone}`}
      tabIndex={0}
      {...(region ? { role: "region", "aria-label": region } : null)}
      {...(labelledBy
        ? { role: "region", "aria-labelledby": labelledBy }
        : null)}
    >
      <table
        role="table"
        aria-label={label}
        className={["table kit-table", `kit-table--${phone}`, className]
          .filter(Boolean)
          .join(" ")}
        style={
          minWidth
            ? ({ "--kit-table-min": `${minWidth}px` } as CSSProperties)
            : undefined
        }
      >
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {noHead ? null : (
          <thead role="rowgroup">
            <tr role="row">
              {columns.map((c, at) => (
                <th
                  key={c.key ?? at}
                  scope="col"
                  role="columnheader"
                  className={
                    [c.num ? "kit-table__num" : "", c.headClassName]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                >
                  {c.head}
                </th>
              ))}
            </tr>
          </thead>
        )}
        {none && empty ? (
          <tbody role="rowgroup">
            <tr role="row" className="kit-table__after">
              <td role="cell" colSpan={columns.length}>
                {empty}
              </td>
            </tr>
          </tbody>
        ) : (
          sections.map((s) => (
            <tbody key={s.key} role="rowgroup">
              {s.rows.map((row) => drawRow(row, n++))}
            </tbody>
          ))
        )}
        {foot ? (
          <tbody role="rowgroup">
            <tr role="row" className="kit-table__after">
              <td role="cell" colSpan={columns.length}>
                {foot}
              </td>
            </tr>
          </tbody>
        ) : null}
      </table>
    </div>
  );
}
