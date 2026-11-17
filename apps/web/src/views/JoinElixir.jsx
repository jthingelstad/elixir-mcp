import { Icon, useFlash } from "@elixir-mcp/ui";

/**
 * The parts a public page shares (2026-11-17, out of Battle.jsx): a battle's
 * page and a session's page say the same words to a reader with no account
 * and copy their link the same way.
 */

export function CopyButton({
  text,
  label = "Copy",
  className = "btn btn--sm",
}) {
  const [copied, flash] = useFlash();
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        navigator.clipboard?.writeText(text);
        flash();
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={14} />
      {copied ? "Copied" : label}
    </button>
  );
}

const here = () =>
  encodeURIComponent(window.location.pathname + window.location.search);

/** The way in, up top, for a reader who opened the link from a group
 *  chat with no account (2026-11-16): one line and one button, so it is
 *  plain from the first screen. The full Invite stays below. */
export function JoinLine() {
  return (
    <p className="battle__join">
      <span>Follow your friends’ battles on Elixir. It’s free.</span>
      <a
        className="btn btn--sm btn--gold"
        href={`/signin?signup&return_to=${here()}`}
      >
        Join free
      </a>
    </p>
  );
}

/** For a reader with no account: what Elixir is, and the way in (#763).
 *  Both links carry this page as where to come back to, and nothing else:
 *  never who sent the link ("Invites carry no referral ids"). */
export function Invite({ who = null }) {
  const back = here();
  const title = who
    ? `Follow ${who} on Elixir`
    : "Follow these players on Elixir";
  return (
    <section className="kit-cta" aria-label={title}>
      <h2 className="kit-cta__title">{title}</h2>
      <p className="kit-cta__text">
        Elixir is where Clash Royale players follow each other’s battles and
        celebrate them. It’s free. Join or sign in and you come back to this
        page, ready to follow.
      </p>
      <div className="share-actions">
        <a className="btn btn--gold" href={`/signin?signup&return_to=${back}`}>
          Join Elixir
        </a>
        <a className="btn" href={`/signin?return_to=${back}`}>
          Sign in
        </a>
        <a className="btn btn--quiet" href="/">
          What is Elixir?
        </a>
      </div>
    </section>
  );
}
