import {
  createContext,
  useContext,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";

/**
 * The kit's ONE in-app link (review 2026-09-27 §7.5).
 *
 * A record link used to be an anchor with a click handler and no href: no keyboard
 * focus, no new tab, no copying the address, and axe does not flag it.
 * A Link always renders a real href, so the browser owns everything a
 * link is for, and it takes over only an UNMODIFIED PRIMARY click, which
 * it hands to the app's router instead of a page load. A middle click,
 * or one with Cmd, Ctrl, Shift or Alt, is the browser's: a new tab, a
 * new window, a download.
 *
 * The router arrives through `NavigateProvider` (the console's Shell),
 * or a `navigate` prop. With neither, a Link is a plain anchor and a
 * click is a page load, which is still correct, only slower: a vertical
 * taking the kit through its pin keeps working before it wires one up.
 *
 * An ACTION is not a link: something that changes state or opens a
 * form is `<button className="link">`, which looks like one.
 */
type Navigate = (to: string) => unknown;

const NavigateContext = createContext<Navigate | null>(null);

/** Supplies the app's in-app navigation to every Link below it. */
export function NavigateProvider({
  navigate,
  children,
}: {
  navigate: Navigate;
  children?: ReactNode;
}) {
  return (
    <NavigateContext.Provider value={navigate}>
      {children}
    </NavigateContext.Provider>
  );
}

/** True for the one click an app may take over: the primary button, no
 *  modifier, not already handled, and not aimed at another browsing
 *  context. Everything else is the browser's. */
export function isPlainClick(e: MouseEvent<HTMLElement>): boolean {
  if (e.defaultPrevented) return false;
  if (e.button !== 0) return false;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const target = (e.currentTarget as HTMLAnchorElement | null)?.getAttribute?.(
    "target",
  );
  return !target || target === "_self";
}

/** Same-origin paths only: an absolute URL on another origin, a
 *  `mailto:` or a fragment is the browser's to follow. */
function inApp(to: string): boolean {
  return to.startsWith("/") && !to.startsWith("//");
}

export function Link({
  to,
  navigate,
  onClick,
  children,
  ...rest
}: {
  to: string;
  navigate?: Navigate;
  children?: ReactNode;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const fromContext = useContext(NavigateContext);
  const go = navigate ?? fromContext;
  return (
    <a
      {...rest}
      href={to}
      onClick={(e) => {
        onClick?.(e);
        if (!go || !inApp(to) || !isPlainClick(e)) return;
        e.preventDefault();
        go(to);
      }}
    >
      {children}
    </a>
  );
}
