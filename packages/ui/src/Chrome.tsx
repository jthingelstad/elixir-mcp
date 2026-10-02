import { useEffect, useRef, useState, type MouseEvent } from "react";
import { AccountMenu, initialsOf, type ChromeAccount } from "./AccountMenu.tsx";
import {
  FAMILY_DOCS,
  FAMILY_LOGO,
  FAMILY_PRODUCTS,
  FAMILY_SIGN_IN,
  FAMILY_WORDMARK,
  gameLabel,
  type FamilyProduct,
} from "./family.ts";
import { Icon } from "./Icon.tsx";
import { isPlainClick } from "./Link.tsx";

/** A place on the bar. The kit's FAMILY_PRODUCTS is the default set; an
 *  app overrides its own entry to route in-app instead of reloading. */
export interface ChromeProduct extends FamilyProduct {
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * The top bar, the same on every surface of the family (canvas
 * 2026-09-29): the logo and "Elixir" home on the left, then the places,
 * Console, Ladder and Clan; on the right Docs, the "Play Drop" candy
 * button, and the account slot.
 *
 * THE BAR'S SHAPE NEVER VARIES BY SESSION. The account slot is a fixed
 * width on every surface, signed in or not, so nothing beside it moves
 * when a session arrives. An app fills it from the session it already
 * holds (`account`): a person is their initials and name, opening the
 * account menu; `null` is "Sign in", the same width; `undefined`, while
 * the app is still asking, is the empty slot. The static site cannot
 * know the session at build time, so it always shows "Sign in", and
 * that link takes a reader who is signed in straight to their console.
 * Nothing on the bar swaps after load.
 *
 * The SAME markup at every width: which width is showing is a media
 * query's decision, not this component's, and that is what keeps this
 * bar and the Eleventy one the same bar. At narrow width the places,
 * Docs and the game fold into one button that names where you are
 * (or says "Menu" where you are inside none of them) and opens a sheet;
 * Escape closes it, and so does a click outside, because a sheet you
 * can only dismiss by finding the same small button again is a trap on
 * a phone.
 *
 * `current` names where this bar is drawn: a product's key, or "docs".
 * That one turns green ("you are here") and stays a link to its home.
 * Drop is a game beside the record, not a place in it: it opens its own
 * host in a new window, and the button says so to a screen reader.
 */
export function Chrome({
  wordmark = FAMILY_WORDMARK,
  logo = FAMILY_LOGO,
  home = "/",
  onHome,
  products = FAMILY_PRODUCTS,
  docs = FAMILY_DOCS,
  current,
  account,
  signIn = FAMILY_SIGN_IN,
}: {
  wordmark?: string;
  logo?: string;
  home?: string;
  onHome?: () => void;
  products?: ReadonlyArray<ChromeProduct>;
  docs?: ChromeProduct;
  current?: string;
  /** The signed-in person; null signed out; undefined while unknown. */
  account?: ChromeAccount | null;
  signIn?: { label: string; href: string; onClick?: ChromeProduct["onClick"] };
}) {
  const [open, setOpen] = useState<null | "sheet" | "account">(null);
  const header = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const meButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(null);
      (open === "account" ? meButton : menuButton).current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!header.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const places = products.filter((p) => !p.game);
  const games = products.filter((p) => p.game);
  const here = [...places, docs].find((p) => p.key === current);
  const close = () => setOpen(null);

  const place = (p: ChromeProduct, cls: string) => (
    <a
      className={cls}
      key={p.key}
      href={p.href}
      onClick={(e) => {
        close();
        p.onClick?.(e);
      }}
      aria-current={p.key === current ? "page" : undefined}
    >
      <Icon name={p.icon} size={17} />
      <span className={`${cls}-label`}>{p.label}</span>
    </a>
  );
  const game = (p: ChromeProduct) => (
    <a
      className="chrome__play"
      key={p.key}
      href={p.href}
      target="_blank"
      rel="noopener"
      aria-label={gameLabel(p)}
      onClick={close}
    >
      <Icon name={p.icon} size={17} />
      <span className="chrome__play-label">{p.action ?? p.label}</span>
      <Icon name="arrow-up-right" size={14} />
    </a>
  );

  return (
    <header className="chrome" ref={header}>
      <div className="chrome__inner">
        <a
          className="chrome__home"
          href={home}
          aria-label={`${wordmark} home`}
          onClick={
            onHome
              ? (e) => {
                  if (!isPlainClick(e)) return;
                  e.preventDefault();
                  close();
                  onHome();
                }
              : undefined
          }
        >
          <img className="chrome__logo" src={logo} alt="" />
          <span className="wordmark">{wordmark}</span>
        </a>
        <span className="chrome__rule" aria-hidden="true" />

        <nav className="chrome__nav" aria-label="Products">
          {places.map((p) => place(p, "chrome__product"))}
        </nav>

        <button
          type="button"
          ref={menuButton}
          className="chrome__menu"
          aria-label={here ? `Product: ${here.label}` : "Menu"}
          aria-expanded={open === "sheet"}
          aria-controls="chrome-sheet"
          data-here={here ? "true" : undefined}
          onClick={() => setOpen((v) => (v === "sheet" ? null : "sheet"))}
        >
          {here ? (
            <>
              <Icon name={here.icon} size={17} />
              <span className="chrome__menu-label">{here.label}</span>
              <Icon name="chevron-down" size={16} />
            </>
          ) : (
            <>
              <Icon name={open === "sheet" ? "x" : "menu"} size={20} />
              <span className="chrome__menu-label">Menu</span>
            </>
          )}
        </button>

        <div className="chrome__end">
          {place(docs, "chrome__docs")}
          {games.map(game)}
          <span className="chrome__rule" aria-hidden="true" />
          <div className="chrome__account">
            {account === null ? (
              <a
                className="chrome__signin"
                href={signIn.href}
                onClick={signIn.onClick}
              >
                <Icon name="key-round" size={16} />
                <span>{signIn.label}</span>
              </a>
            ) : account ? (
              <button
                type="button"
                ref={meButton}
                className="chrome__me"
                aria-label={`Account: ${account.name}`}
                aria-expanded={open === "account"}
                aria-controls="account-menu"
                onClick={() =>
                  setOpen((v) => (v === "account" ? null : "account"))
                }
              >
                <span className="chrome__avatar" aria-hidden="true">
                  {account.initials ?? initialsOf(account.name)}
                </span>
                <span className="chrome__me-name">{account.name}</span>
                <Icon name="chevron-down" size={16} />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <nav
        className="chrome__sheet"
        id="chrome-sheet"
        aria-label={`${wordmark} menu`}
        data-open={open === "sheet" ? "true" : "false"}
      >
        {places.map((p) => place(p, "chrome__sheet-item"))}
        {place(docs, "chrome__sheet-item")}
        {games.map(game)}
      </nav>

      {account && open === "account" && (
        <AccountMenu account={account} onClose={close} />
      )}
    </header>
  );
}
