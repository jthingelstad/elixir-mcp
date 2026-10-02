import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.tsx";
import { Link } from "./Link.tsx";

/** One of the person's players in the account menu. */
export interface ChromePlayer {
  key: string;
  name: string;
  tag?: string;
  /** The primary player wears the star. */
  primary?: boolean;
  href: string;
}

/** One line of the account menu's links: a place, with what it holds. */
export interface ChromeAccountLink {
  key: string;
  icon: IconName;
  label: string;
  hint?: string;
  href: string;
}

/**
 * The signed-in person, as an app hands it to the bar. The app fills it
 * from the session it already holds; the bar never asks for one.
 */
export interface ChromeAccount {
  /** What the bar's button shows: the primary player, or the address. */
  name: string;
  /** Two letters for the avatar; derived from `name` when absent. */
  initials?: string;
  email?: string;
  /** A mono line under the address: the role and the clock. */
  detail?: string;
  players?: ChromePlayer[];
  /** The line under the players: where a player is added or verified. */
  playersFoot?: { label: string; href: string };
  links?: ChromeAccountLink[];
  signOut: {
    label: string;
    /** One line under the button saying what signing out ends. */
    note?: string;
    /** A sign-out that did not take, said where the button is. */
    error?: ReactNode;
  } & (
    | { onClick: () => unknown; action?: never }
    | {
        /** A form POST, for a product whose sign-out is a server route. */
        action: string;
        onClick?: never;
      }
  );
}

/** Two letters for an avatar: the first of the first two words, or the
 *  first two of a single word. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? words.slice(0, 2).map((w) => Array.from(w)[0])
      : Array.from(words[0] ?? "").slice(0, 2);
  return letters.join("").toUpperCase();
}

/**
 * The account menu, under the bar's account button (canvas 2026-09-29):
 * who you are, your players, the account's own pages, and the way out.
 * What lives here left the Console's rail, which carries structure and
 * never the reader's own things.
 *
 * A disclosure, not an ARIA menu: it holds links and one button, and a
 * reader moves through them with Tab like any other links. Following a
 * link closes it; Escape and a click outside close it too (Chrome owns
 * those).
 */
export function AccountMenu({
  account,
  onClose,
}: {
  account: ChromeAccount;
  onClose: () => void;
}) {
  const { players = [], links = [], signOut } = account;
  return (
    <div className="account-menu" id="account-menu">
      <div className="account-menu__head">
        <span className="chrome__avatar chrome__avatar--lg" aria-hidden="true">
          {account.initials ?? initialsOf(account.name)}
        </span>
        <div className="min-w-0">
          <div className="account-menu__name">{account.name}</div>
          {account.email && (
            <div className="account-menu__email">{account.email}</div>
          )}
          {account.detail && (
            <div className="account-menu__detail">{account.detail}</div>
          )}
        </div>
      </div>

      {players.length > 0 && (
        <div className="account-menu__group">
          <div className="account-menu__label">Your players</div>
          {players.map((p) => (
            <Link
              key={p.key}
              to={p.href}
              className="account-menu__player"
              onClick={onClose}
            >
              <span className="account-menu__star">
                {p.primary && <Icon name="star" size={14} />}
              </span>
              <span className="account-menu__player-name">{p.name}</span>
              {p.tag && <span className="account-menu__tag">{p.tag}</span>}
            </Link>
          ))}
          {account.playersFoot && (
            <Link
              to={account.playersFoot.href}
              className="account-menu__more"
              onClick={onClose}
            >
              {account.playersFoot.label}
              <Icon name="chevron-right" size={14} />
            </Link>
          )}
        </div>
      )}

      {links.length > 0 && (
        <div className="account-menu__group">
          {links.map((l) => (
            <Link
              key={l.key}
              to={l.href}
              className="account-menu__link"
              onClick={onClose}
            >
              <Icon name={l.icon} size={17} />
              <span>{l.label}</span>
              {l.hint && <span className="account-menu__hint">{l.hint}</span>}
            </Link>
          ))}
        </div>
      )}

      <div className="account-menu__foot">
        {signOut.action ? (
          <form method="post" action={signOut.action}>
            <button type="submit" className="account-menu__out">
              <Icon name="log-out" size={17} />
              {signOut.label}
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="account-menu__out"
            onClick={() => signOut.onClick?.()}
          >
            <Icon name="log-out" size={17} />
            {signOut.label}
          </button>
        )}
        {signOut.error ? (
          <p className="account-menu__note text-bad" role="alert">
            {signOut.error}
          </p>
        ) : (
          signOut.note && <p className="account-menu__note">{signOut.note}</p>
        )}
      </div>
    </div>
  );
}
