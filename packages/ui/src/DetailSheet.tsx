import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** A contextual editor. Native dialog owns modal focus, Escape and restoration. */
export function DetailSheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const box = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = box.current;
    const trigger = document.activeElement;
    if (d && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    }
    return () => {
      if (d?.open && typeof d.close === "function") d.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={box}
      className="detail-sheet"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="detail-sheet__head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="btn btn--quiet" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="detail-sheet__body">{children}</div>
    </dialog>
  );
}

/** A setting's current state stays on the page; its editor opens on demand. */
export function Setting({
  title,
  description,
  action = "Manage",
  anchor,
  children,
}: {
  title: string;
  description: ReactNode;
  action?: string;
  anchor?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!anchor) return;
    const reveal = () => {
      if (window.location.hash === `#${anchor}`) setOpen(true);
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [anchor]);
  const close = () => {
    setOpen(false);
    if (anchor && window.location.hash === `#${anchor}`)
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search,
      );
  };
  return (
    <>
      <div className="settings-row" id={anchor}>
        <div>
          <h2 className="settings-row__title">{title}</h2>
          <div className="settings-row__description">{description}</div>
        </div>
        <button
          type="button"
          className="btn"
          aria-label={`${action} ${title}`}
          onClick={() => setOpen(true)}
        >
          {action}
        </button>
      </div>
      {open ? (
        <DetailSheet title={title} onClose={close}>
          {children}
        </DetailSheet>
      ) : null}
    </>
  );
}

export function Disclosure({
  title,
  children,
  open = false,
  className = "",
}: {
  title: ReactNode;
  children: ReactNode;
  open?: boolean;
  className?: string;
}) {
  return (
    <details className={`disclosure ${className}`} open={open || undefined}>
      <summary>{title}</summary>
      <div className="disclosure__body">{children}</div>
    </details>
  );
}
