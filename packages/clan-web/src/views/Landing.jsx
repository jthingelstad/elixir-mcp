import { ELIXIR_LINKS } from "../lib/links.js";

const ERRORS = {
  session_expired: "Your session ended. Sign in again to continue.",
  elixir_unavailable: "Elixir did not answer. Try again in a minute.",
};

/** Signed out. The two prerequisites are stated here, before the button,
 *  so nobody discovers them one refusal page at a time. */
export function Landing({ error }) {
  return (
    <div style={{ maxWidth: "560px", margin: "40px auto 0" }}>
      <p className="eyebrow">ELIXIR CLAN</p>
      <h1 className="hero-title">Your clan, on Elixir.</h1>
      <p className="lede">
        The roster with every member&rsquo;s role, trophies, donations and
        activity, read from the history Elixir records. You see it as who you
        are in the game: leader, co-leader, elder or member.
      </p>

      {error ? (
        <div
          className="callout callout--warn"
          role="alert"
          style={{ margin: "20px 0" }}
        >
          <span>
            {ERRORS[error] ?? "Sign-in did not complete. Start again."}
          </span>
        </div>
      ) : null}

      <div className="panel" style={{ margin: "24px 0" }}>
        <div className="panel__head">
          Before you sign in, you need two things
        </div>
        <div className="panel__body" style={{ display: "grid", gap: "14px" }}>
          <div>
            <div style={{ fontWeight: 600 }}>1. An Elixir account</div>
            <p className="page__lede" style={{ margin: "4px 0 0" }}>
              Elixir is the account system; there is no separate sign-up here.{" "}
              <a href={ELIXIR_LINKS.requestAccess}>
                Request access at elixir.poapkings.com
              </a>{" "}
              if you do not have one yet.
            </p>
          </div>
          <div>
            <div style={{ fontWeight: 600 }}>2. Your player</div>
            <p className="page__lede" style={{ margin: "4px 0 0" }}>
              Add the player you play as under{" "}
              <a href={ELIXIR_LINKS.tracking}>Elixir → Tracking</a> and you are
              in as a member of its clan. Elders, Co-leaders and Leaders prove
              it under <a href={ELIXIR_LINKS.verify}>Elixir → Verify</a> (one
              battle with a deck Elixir names, usually under a minute) and then
              their in-game role is their role here.
            </p>
          </div>
        </div>
        <div className="panel__foot">
          Your Elixir sign-in opens your recorded history and clan tools.
        </div>
      </div>

      <a
        className="btn btn--primary"
        href="/console/signin"
        data-tinylytics-event="clan.signin_started"
        data-tinylytics-event-value="landing"
      >
        Sign in with Elixir
      </a>
    </div>
  );
}
