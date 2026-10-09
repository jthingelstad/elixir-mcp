import { ELIXIR_LINKS } from "../lib/links.js";
import { CLAN } from "../lib/base.js";
import { useClock, Tag } from "@elixir-mcp/ui";

/**
 * One page per gate refusal, in gate order. Each says exactly what to do
 * and links to where, then offers to check again; nothing here guesses.
 */
export const REFUSALS = {
  not_a_person: {
    title: "That was an agent's connection, not yours",
    body: "Elixir Clan signs people in. An agent or integration credential cannot open the personal clan dashboard.",
    action: "Sign in to Elixir as yourself.",
    link: [ELIXIR_LINKS.connectionsDocs, "Users, agents and integrations"],
    retry: "/console/signin",
  },
  no_primary_player: {
    title: "Add your player in Elixir",
    body: "Your Elixir account has no primary player yet, so there is nobody to show a clan for.",
    action:
      "Add the player you play as under Elixir → Tracking, then come back.",
    link: [ELIXIR_LINKS.tracking, "Elixir → Tracking"],
  },
  no_clan: {
    title: "No clan in your recorded profiles",
    body: "The latest recorded profiles for your own players show no clan. These are observations, not a live check.",
    action:
      "If that is still accurate, join a clan in the game. Otherwise wait for a fresh profile and clan roster, then check again.",
    link: [ELIXIR_LINKS.overview, "Your Elixir account"],
  },
  membership_unknown: {
    title: "Waiting for your clan record",
    body: "Elixir has not confirmed your players' clan membership yet. Missing profile or roster observations do not mean you are outside a clan.",
    action:
      "Check recording under Tracking, then check again after your profile and clan roster have been observed.",
    link: [ELIXIR_LINKS.tracking, "Elixir → Tracking"],
  },
};

export function Refused({ reason, me, onRecheck, checking }) {
  const { stamp } = useClock();
  const page = REFUSALS[reason];
  if (!page) {
    return (
      <div className="empty" style={{ margin: "40px auto 0" }}>
        <div className="empty__title">Nothing to refuse</div>
        <p className="empty__body">There is no such gate page.</p>
        <a className="btn" href={CLAN}>
          Home
        </a>
      </div>
    );
  }
  const who = me?.primary?.name ?? me?.principal?.subject?.name;
  const players = me?.identities ?? [];
  return (
    <div style={{ maxWidth: "560px", margin: "40px auto 0" }}>
      <p className="eyebrow">NOT YET</p>
      <h1 className="page__title" style={{ marginBottom: "12px" }}>
        {page.title}
      </h1>
      {who ? (
        <p className="page-head__note" style={{ marginBottom: "12px" }}>
          Signed in to Elixir as <span className="yours">★</span> {who}
        </p>
      ) : null}
      <p className="lede">{page.body}</p>
      {players.length > 0 && reason !== "not_a_person" ? (
        <ul
          style={{
            margin: "12px 0 0",
            paddingLeft: "18px",
            color: "var(--ink-dim)",
            fontSize: "14px",
          }}
        >
          {players.map((p) => (
            <li key={p.player_tag}>
              {p.name ?? <Tag tag={p.player_tag} />}{" "}
              <span className="tag">{p.player_tag}</span>{" "}
              {p.claim_status === "verified"
                ? "verified"
                : (p.claim_status ?? "unverified")}
              {p.membership_capture?.state === "none"
                ? ` · no clan observed ${stamp(p.membership_capture.observed_at, { year: true })}`
                : p.clan_tag
                  ? ` · recorded clan ${p.clan_name ?? p.clan_tag} · clan record pending`
                  : " · clan record pending"}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="callout callout--info" style={{ margin: "18px 0" }}>
        <span>{page.action}</span>
      </div>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <a className="btn btn--primary" href={page.link[0]}>
          {page.link[1]} ›
        </a>
        {page.retry ? (
          <a className="btn" href={page.retry}>
            Sign in again
          </a>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={onRecheck}
            disabled={checking}
          >
            {checking ? "Checking…" : "I did that, check again"}
          </button>
        )}
      </div>
    </div>
  );
}
