import {
  useId,
  type ElementType,
  type HTMLAttributes,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { Link } from "./Link.tsx";

/**
 * A panel: a surface with an optional head (a title and, to its right, one
 * link or control). Children sit flush so `Rows` and `Table` reach the
 * edges; `pad` pads them for prose. `.panel__body` and `.panel__foot` stay
 * valid inside it.
 *
 * `titleAs` is the title's element, h2 unless the page's outline says
 * otherwise; a title drawn as a heading names the section.
 */
export function Panel({
  title,
  titleId,
  titleAs: Title = "h2",
  action,
  pad = false,
  as: Tag = "section",
  className,
  children,
  ...rest
}: {
  title?: ReactNode;
  titleId?: string;
  titleAs?: ElementType;
  action?: ReactNode;
  pad?: boolean;
  as?: ElementType;
  children?: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  const auto = useId();
  const id = titleId ?? auto;
  const heading = typeof Title === "string" && /^h[1-6]$/.test(Title);
  const labelled =
    Tag === "section" &&
    title != null &&
    heading &&
    !rest["aria-label"] &&
    !rest["aria-labelledby"];
  return (
    <Tag
      {...rest}
      {...(labelled ? { "aria-labelledby": id } : null)}
      className={["panel kit-panel", className].filter(Boolean).join(" ")}
    >
      {title != null || action != null ? (
        <div className="kit-panel__head">
          {title != null ? (
            <Title id={heading ? id : titleId} className="kit-panel__title">
              {title}
            </Title>
          ) : null}
          {action != null ? (
            <div className="kit-panel__action">{action}</div>
          ) : null}
        </div>
      ) : null}
      {pad ? <div className="kit-panel__body">{children}</div> : children}
    </Tag>
  );
}

/** The list inside a panel: rows divided by a line, flush to its edges. */
export function Rows({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={className ? `kit-rows ${className}` : "kit-rows"}>
      {children}
    </div>
  );
}

/**
 * One two-column row: a title and a detail line on the left, one short
 * thing on the right. With `href` it is a link, with `onClick` a button.
 * `quiet` dims a row that has nothing to report. `lead` goes before the
 * words: an avatar (canvas .mini).
 */
export function Row({
  title,
  detail,
  right,
  lead,
  href,
  onClick,
  quiet = false,
  className,
}: {
  title: ReactNode;
  detail?: ReactNode;
  right?: ReactNode;
  lead?: ReactNode;
  href?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  quiet?: boolean;
  className?: string;
}) {
  const cls = ["kit-row", quiet ? "kit-row--quiet" : "", className]
    .filter(Boolean)
    .join(" ");
  const body = (
    <>
      {lead != null ? <span className="kit-row__lead">{lead}</span> : null}
      <span className="kit-row__main">
        <span className="kit-row__title">{title}</span>
        {detail != null ? (
          <span className="kit-row__detail">{detail}</span>
        ) : null}
      </span>
      {right != null ? <span className="kit-row__right">{right}</span> : null}
    </>
  );
  if (href)
    return (
      <Link to={href} className={cls} onClick={onClick}>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" className={cls} onClick={onClick}>
        {body}
      </button>
    );
  return <div className={cls}>{body}</div>;
}
