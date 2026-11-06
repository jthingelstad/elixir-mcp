import { FAMILY_SAMPLE_BATTLE, Icon, Panel } from "@elixir-mcp/ui";
import { LADDER_PAGES, MODES } from "./ladder.js";

/** What each Ladder page reads back, in the docs' words
 *  (apps/site/src/docs/ladder.md): one line a page, so a visitor knows
 *  what is behind the sign-in. Keyed by LADDER_PAGES' slugs. */
const ABOUT = {
  season:
    "The season so far in one mode: your record, trophy range, week by week and the days you played.",
  battles:
    "Every battle it records, by day and by sitting, each opening on both decks.",
  decks:
    "Every deck you played this season, with its record. A change of one card makes a new deck.",
  cards:
    "Your record with each card you played, and against each card across the table.",
};

/**
 * Ladder, signed out: what it is and the way in, where the Console's
 * bare "Sign in first" wall used to stand. Facts about the product
 * only; there is nobody's season to show. `returnTo` is the Ladder
 * address asked for, so a new account lands back on it.
 */
export function LadderInvite({ returnTo, onSignIn }) {
  const signup = `/signin?signup&return_to=${encodeURIComponent(returnTo)}`;
  return (
    <section
      className="mx-auto mt-8 max-w-[640px]"
      aria-labelledby="ladder-invite"
    >
      <p className="eyebrow">Ladder</p>
      <h1 className="hero-title" id="ladder-invite">
        Your season, read back
      </h1>
      <p className="lede">
        Ladder reads your own battles back to you, one season and one mode at a
        time, from what Elixir has recorded.
      </p>
      <p className="page__lede">
        {MODES.map((m) => m.label).join(", ")}: each mode is its own game, so
        each has its own view, and nothing pools across them.
      </p>
      <ul className="mt-5 grid gap-3 p-0">
        {LADDER_PAGES.map((p) => (
          <Panel as="li" key={p.slug} className="flex items-start gap-3 p-4">
            <Icon name={p.icon} size={18} />
            <span>
              <strong>{p.label}</strong>
              <span className="block text-[13px] text-ink-faint">
                {ABOUT[p.slug]}
              </span>
            </span>
          </Panel>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <a className="btn btn--gold" href={signup}>
          Create your account
        </a>
        <button type="button" className="btn" onClick={onSignIn}>
          Sign in
        </button>
      </div>
      <p className="footnote mt-4">
        Free signup with an email, then add your player.{" "}
        <a href="/docs/ladder">How Ladder works</a> ·{" "}
        <a href={FAMILY_SAMPLE_BATTLE.path}>{FAMILY_SAMPLE_BATTLE.label}</a>
      </p>
    </section>
  );
}
