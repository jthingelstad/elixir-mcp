import { Fragment } from "react";
import { Link } from "@elixir-mcp/ui";

/** The way back from a page below the rail's own. */
export function Crumb({ to, children }) {
  return (
    <div className="page__crumb">
      <Link to={to}>‹ {children}</Link>
    </div>
  );
}

/** Label and value rows inside a panel. A phone stacks them. */
export function Facts({ rows }) {
  return (
    <dl className="st-facts">
      {rows.filter(Boolean).map(([label, value]) => (
        <Fragment key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** A sentence under a value. */
export const Note = ({ children, id }) => (
  <span id={id} className="st-note">
    {children}
  </span>
);
