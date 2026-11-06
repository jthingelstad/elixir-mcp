import type { ElementType, ReactNode } from "react";

/**
 * The one page head: an h1, one sub line, and an optional right-hand slot
 * (a freshness chip or a link). On a phone the slot falls under the words.
 * `crumb` sits above the title on the pages that still carry one, and
 * `children` under the sub line for what a page keeps there today.
 *
 * Keeps the old `page__title` and `page__lede` class names beside its own,
 * so anything that reads those keeps reading them.
 */
export function PageHead({
  title,
  sub,
  aside,
  crumb,
  children,
  as: Title = "h1",
  className,
}: {
  title: ReactNode;
  sub?: ReactNode;
  aside?: ReactNode;
  crumb?: ReactNode;
  children?: ReactNode;
  /** Only for a state page that is not the page's real head. */
  as?: ElementType;
  className?: string;
}) {
  return (
    <div className={className ? `kit-head ${className}` : "kit-head"}>
      <div className="kit-head__main">
        {crumb ?? null}
        <Title className="page__title kit-head__title">{title}</Title>
        {sub ? <p className="page__lede kit-head__sub">{sub}</p> : null}
        {children}
      </div>
      {aside ? <div className="kit-head__side">{aside}</div> : null}
    </div>
  );
}
