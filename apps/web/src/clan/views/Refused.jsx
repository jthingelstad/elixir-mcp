import { ELIXIR_LINKS, inApp } from "../lib/links.js";
import { CLAN } from "../lib/base.js";
import { Link, useClock, Tag, Empty } from "@elixir-mcp/ui";
import { useEffect } from "react";

/**
 * One page per gate refusal, in gate order. Each says exactly what to do
 * and links to where, then looks again when you come back; nothing here
 * guesses. A non-person never gets here: Elixir answers 401 before Clan
 * runs (clan-session.test.mjs).
 */
export const REFUSALS = {
  no_primary_player: {
    title: "Clan starts with your player",
    body: "Add the player you play as, and their clan shows up here.",
    link: [ELIXIR_LINKS.addPlayer, "Add your player"],
    // Nothing to report back: the page looks again when you return.
    plain: true,
  },
  no_clan: {
    title: "No clan in your recorded profiles",
    body: "The latest recorded profiles for your own players show no clan. These are observations, not a live check.",
    action:
      "If that is still accurate, join a clan in the game; the clan directory lists the clans that saved their rules in Elixir. Otherwise wait for a fresh profile and clan roster, then check again.",
    link: [ELIXIR_LINKS.elixirHome, "Your Elixir account"],
    also: [`${CLAN}/directory`, "Clan directory"],
  },
  membership_unknown: {
    title: "Waiting for your clan record",
    body: "Elixir has not confirmed your players' clan membership yet. A gap in your profile or roster reads does not mean you are outside a clan.",
    action:
      "Check recording under Players & following, then check again after your profile and clan roster have been read.",
    link: [ELIXIR_LINKS.tracking, "Settings → Players"],
  },
};

export function Refused({ reason, me, onRecheck, checking }) {
  const { when } = useClock();
  const page = REFUSALS[reason];
  const canRecheck = Boolean(page);
  useEffect(() => {
    if (!canRecheck) return undefined;
    const look = () => {
      if (document.visibilityState === "visible") onRecheck?.();
    };
    document.addEventListener("visibilitychange", look);
    return () => document.removeEventListener("visibilitychange", look);
  }, [canRecheck, onRecheck]);
  if (!page) {
    return (
      <Empty
        title="Nothing to refuse"
        action={
          <a className="btn" href={CLAN}>
            Home
          </a>
        }
        style={{ margin: "40px auto 0" }}
      >
        There is no such gate page.
      </Empty>
    );
  }
  if (page.plain)
    return (
      <Empty
        title={page.title}
        titleAs="h1"
        action={
          <Link className="btn btn--primary" to={page.link[0]}>
            {page.link[1]}
          </Link>
        }
      >
        {page.body}
      </Empty>
    );
  const who = me?.primary?.name ?? me?.principal?.subject?.name;
  const players = me?.identities ?? [];
  return (
    <div style={{ maxWidth: "560px", marginTop: "40px" }}>
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
      {players.length > 0 ? (
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
                ? ` · no clan seen ${when(p.membership_capture.observed_at)}`
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
        {inApp(page.link[0]) ? (
          <Link className="btn btn--primary" to={page.link[0]}>
            {page.link[1]} ›
          </Link>
        ) : (
          <a className="btn btn--primary" href={page.link[0]}>
            {page.link[1]} ›
          </a>
        )}
        {page.also ? (
          <Link className="btn" to={page.also[0]}>
            {page.also[1]}
          </Link>
        ) : null}
        <button
          type="button"
          className="btn"
          onClick={onRecheck}
          disabled={checking}
        >
          {checking ? "Checking…" : "Check again"}
        </button>
      </div>
    </div>
  );
}
