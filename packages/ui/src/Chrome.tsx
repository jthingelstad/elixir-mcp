import { useEffect, useState, type MouseEvent } from "react";
import { FAMILY_PRODUCTS, type FamilyProduct } from "./family.ts";
import { Icon } from "./Icon.tsx";

export interface ChromeTab {
  label: string;
  href: string;
}

/** A product button. The kit's FAMILY_PRODUCTS is the default set; an
 *  app overrides its own entry to route in-app instead of reloading. */
export interface ChromeProduct extends FamilyProduct {
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * The top bar, the same on every surface of the family.
 *
 * THE TOP BAR CARRIES NO SIGNED-IN STATE. It must render identically in
 * the Eleventy build and in the app — the two halves are cached
 * differently and cannot agree on a shape that varies by session, and
 * when they tried, the "same" nav kept arriving with different items in
 * it and read as a glitch. Session identity lives at the foot of the
 * rail, which only an app renders.
 *
 * The SAME markup at every width — which width is showing is a media
 * query's decision, not this component's. That is what keeps this bar
 * and the Eleventy one the same bar. `menu` adds the narrow-width
 * button and the sheet the tabs collapse into; Escape closes it,
 * because a sheet you can only dismiss by finding the same small
 * button again is a trap on a phone. The product buttons are the one
 * thing that never goes inside the menu at any width: they are the way
 * into (and between) the products.
 *
 * `current` names the product this bar is drawn inside. That button turns
 * green and glows — "you are here" — and stays a link to the product's
 * home. The rest are gold, the way over. Drop opens in a new window and
 * says so with a glyph: the game is a separate thing from the record.
 */
export function Chrome({
  wordmark,
  home = "/",
  onHome,
  tabs,
  products = FAMILY_PRODUCTS,
  current,
  menu = false,
}: {
  wordmark: string;
  home?: string;
  onHome?: () => void;
  tabs: ChromeTab[];
  products?: ReadonlyArray<ChromeProduct>;
  current?: ChromeProduct["key"];
  menu?: boolean;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="chrome">
      <div className="chrome__inner">
        <a
          className="wordmark"
          href={home}
          onClick={
            onHome
              ? (e) => {
                  e.preventDefault();
                  setOpen(false);
                  onHome();
                }
              : undefined
          }
        >
          {wordmark}
        </a>

        <nav className="chrome__nav" aria-label={wordmark}>
          {tabs.map(({ label, href }) => (
            <a className="chrome__tab" key={href} href={href}>
              {label}
            </a>
          ))}
        </nav>

        <div className="chrome__products">
          {products.map((p) => (
            <a
              className="chrome__product"
              key={p.key}
              href={p.href}
              onClick={p.onClick}
              aria-current={p.key === current ? "page" : undefined}
              aria-label={
                p.external ? `${p.label} (opens in a new window)` : undefined
              }
              target={p.external ? "_blank" : undefined}
              rel={p.external ? "noopener" : undefined}
            >
              <Icon name={p.icon} size={17} />
              <span className="chrome__product-label">{p.label}</span>
              {p.external && <Icon name="external-link" size={13} />}
            </a>
          ))}
        </div>

        {menu && (
          <button
            type="button"
            className="chrome__menu"
            aria-label="Menu"
            aria-expanded={open}
            aria-controls="chrome-sheet"
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name={open ? "x" : "menu"} size={20} />
          </button>
        )}
      </div>

      {menu && (
        <nav
          className="chrome__sheet"
          id="chrome-sheet"
          aria-label={`${wordmark} menu`}
          data-open={open ? "true" : "false"}
        >
          {tabs.map(({ label, href }) => (
            <a key={href} href={href} onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
