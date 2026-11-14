import type { ElementType, HTMLAttributes, ReactNode } from "react";

/**
 * An empty state: a title, one line saying why, and at most one action. It
 * draws its own surface on a bare page and none inside a panel.
 * `titleAs` is "div" unless this is the whole page and needs its heading.
 */
export function Empty({
  title,
  titleAs: Title = "div",
  action,
  className,
  children,
  ...rest
}: {
  title?: ReactNode;
  titleAs?: ElementType;
  action?: ReactNode;
  children?: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={["empty kit-empty", className].filter(Boolean).join(" ")}
    >
      {title != null ? <Title className="empty__title">{title}</Title> : null}
      {children != null ? <p className="empty__body">{children}</p> : null}
      {action != null ? (
        <div className="kit-empty__action">{action}</div>
      ) : null}
    </div>
  );
}

/**
 * The same shape when a read failed: says so, and offers Try again when
 * `onRetry` is given. Never a guess at what the page would have shown.
 * The app's one error form (2026-11-13): the title names what could not be
 * read ("<What> could not be read just now"), the body says what is safe
 * and ends "Try again in a moment.", and Try again refetches that read.
 */
export function ErrorState({
  title = "This could not be read just now",
  titleAs,
  onRetry,
  busy = false,
  retryLabel = "Try again",
  children,
  className,
  ...rest
}: {
  title?: ReactNode;
  titleAs?: ElementType;
  onRetry?: () => void;
  busy?: boolean;
  retryLabel?: string;
  children?: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <Empty
      role="alert"
      {...rest}
      title={title}
      {...(titleAs ? { titleAs } : {})}
      className={className ? `kit-error ${className}` : "kit-error"}
      action={
        onRetry ? (
          <button
            type="button"
            className="btn btn--sm"
            disabled={busy}
            onClick={onRetry}
          >
            {busy ? "Trying…" : retryLabel}
          </button>
        ) : undefined
      }
    >
      {children}
    </Empty>
  );
}
