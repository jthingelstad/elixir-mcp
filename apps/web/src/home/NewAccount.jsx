import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Link, TagText, writeErrorText } from "@elixir-mcp/ui";
import { api } from "../api.js";
import { trackEvent } from "../analytics.js";
import { SETTINGS } from "../lib/settings.js";
import { tagPath } from "../lib/tag-url.js";
import { recordJourney } from "../lib/record-journey.js";
import { useInvalidate } from "../lib/queries.js";
import { clanStepLine } from "./logic.js";

/**
 * Welcome: worked out from the record each time, with nothing stored. Each
 * step's state comes from the first answer; adding a player and the first
 * read are the two that hold Today back, and the rest never do. The page owns
 * the status read and the wait (first-read.js), so Today, once drawn, keeps
 * the same read going: `first` is the newest answer, `landed` whether the
 * first read is in (the player's own battle log, not a battle on record).
 */
/** Where Ladder's and Clan's "Add your player" land: Home's first step. */
const ADD_PLAYER_HASH = "#add-player";

export function NewAccount({
  first,
  answer = null,
  landed = false,
  zoneMissing,
}) {
  const invalidate = useInvalidate();
  const navigate = useNavigate();
  const added = Boolean(first?.player);
  const live = first;
  const player = live?.player ?? null;
  const journey = recordJourney(live);
  return (
    <div className="kit-home">
      {zoneMissing ? <ZoneNotice /> : null}
      <div className="kit-home__two">
        <ol className="kit-steps">
          <Step
            n={1}
            title="Add your player"
            done={added}
            doneLine={
              added ? (
                <>
                  <TagText>{player?.name ?? player?.player_tag}</TagText>, your
                  main player.
                </>
              ) : null
            }
          >
            <AddPlayer
              onAdded={() => {
                // The player is added, so #add-player has done its work; left
                // on, Home would send an account with a player to Settings.
                if (window.location.hash === ADD_PLAYER_HASH)
                  navigate({ to: "/home", hash: "", replace: true });
                invalidate();
              }}
            />
          </Step>
          <Step
            n={2}
            title="First read"
            done={Boolean(landed)}
            waiting={!added}
            ahead="Your profile and about your last 30 battles usually show up within a minute."
            doneLine={
              landed
                ? player.battles_30d > 0
                  ? `${player.battles_30d} ${player.battles_30d === 1 ? "battle" : "battles"} on record.`
                  : "Your profile is on record."
                : null
            }
          >
            <FirstRead
              player={player}
              journey={journey}
              onCheck={() => answer?.refresh()}
              busy={Boolean(answer?.loading)}
              onStopped={() => invalidate()}
            />
          </Step>
          <Step
            n={3}
            title="Your clan"
            done={Boolean(live?.clan?.name)}
            waiting={!added}
            ahead="In a clan? It shows up here."
            doneLine={
              live?.clan?.name ? clanStepLine(live.clan.name, added) : null
            }
          >
            {live?.clan?.name
              ? null
              : "Once Elixir sees your clan, it follows it for you: your clanmates, who joins and leaves, and the River Race."}
          </Step>
          <Step
            n={4}
            title="Prove it’s you"
            optional
            done={player?.verified === true}
            waiting={!added}
            ahead="One battle with a deck Elixir picks. Unlocks your clan role."
            doneLine={player?.verified ? "Proved." : null}
          >
            Play one battle with the deck Elixir gives you. Win or lose, it
            counts. Then Elixir knows this player is yours, and you can act as
            Elder, Co-Leader or Leader in your clan.{" "}
            <Link to={`${SETTINGS}/players/verify`}>Prove it</Link>
          </Step>
          <Step
            n={5}
            title="Connect an AI"
            optional
            done={(live?.connection?.active_connections ?? 0) > 0}
            doneLine="Connected."
          >
            Ask Claude or ChatGPT about your battles.{" "}
            <a href="/docs/quickstart">Show me how</a>
          </Step>
        </ol>
        <aside className="kit-inbox">
          <h2>In your inbox</h2>
          <p>
            <b>One digest a week</b>: your friends and your clan in one email.
          </p>
          <Link to={`${SETTINGS}/emails`}>Make it daily, or turn it off</Link>
        </aside>
      </div>
    </div>
  );
}

/** One step, as Welcome draws them and Home's welcome steps reuse (G4). */
function Step({
  n,
  title,
  heading: Heading = "h2",
  optional,
  done,
  waiting,
  ahead,
  doneLine,
  children,
}) {
  return (
    <li className={`kit-step${done ? " kit-step--done" : ""}`}>
      <span className="kit-step__dot" aria-hidden="true">
        {done ? "✓" : n}
      </span>
      <div className="kit-step__body">
        <Heading>
          {title}
          {optional ? <span className="kit-step__opt"> Optional</span> : null}
        </Heading>
        {done ? (
          <p>{doneLine}</p>
        ) : waiting ? (
          ahead ? (
            <p className="kit-step__ahead">{ahead}</p>
          ) : null
        ) : (
          <div className="kit-step__text">{children}</div>
        )}
      </div>
    </li>
  );
}

function ZoneNotice() {
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <p className="kit-notice">
      <span>Times here are in UTC: your account has no time zone set.</span>
      <button
        type="button"
        className="link"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr("");
          const r = await api.setTimezone("America/Chicago");
          setBusy(false);
          if (r.ok) invalidate();
          else
            setErr(
              writeErrorText({
                status: r.status,
                transport: r.error,
                data: r.data,
              }),
            );
        }}
      >
        Use Central time
      </button>
      <span>
        or <Link to={`${SETTINGS}/profile`}>choose on Profile</Link>
      </span>
      {err ? <span role="alert">{err}</span> : null}
    </p>
  );
}

const TAG_WORDS =
  "That doesn't look like a player tag. Tags use only these characters: 0 2 8 9 C G J L P Q R U V Y.";

function AddPlayer({ onAdded }) {
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <form
      className="kit-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || !tag.trim()) return;
        setBusy(true);
        setErr("");
        const res = await api.claimAction({
          player_tag: tag.trim(),
          make_primary: true,
        });
        setBusy(false);
        if (res.ok) {
          // A count of the first-use step, never which player or account.
          trackEvent("home.player_added");
          return onAdded();
        }
        setErr(
          res.data?.error === "invalid_tag"
            ? TAG_WORDS
            : (res.data?.message ?? "That did not work. Try again."),
        );
      }}
    >
      <p>
        In Clash Royale, open your profile: the tag starting with # is below
        your name.
      </p>
      <label htmlFor="home-add-tag">Your player tag</label>
      <div className="kit-form__row">
        <input
          id="home-add-tag"
          className="input"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          autoComplete="off"
          spellCheck="false"
          placeholder="#ABC123"
          // Ladder and Clan's "Add your player" arrive here, ready to type.
          ref={(el) => {
            if (el && window.location.hash === ADD_PLAYER_HASH) el.focus();
          }}
        />
        <button type="submit" className="btn btn--primary" disabled={busy}>
          Add
        </button>
      </div>
      {err ? (
        <p className="kit-form__err" role="alert">
          {err}
        </p>
      ) : null}
    </form>
  );
}

function FirstRead({ player, journey, onCheck, busy, onStopped }) {
  const [err, setErr] = useState("");
  if (!player) return null;
  if (journey.notFound)
    return (
      <>
        <p>
          We couldn&rsquo;t find {player.player_tag} in Clash Royale. Correct
          the tag, or stop following it. Elixir asks the game again in about a
          day, in case the tag is brand new.
        </p>
        <div className="kit-form__row">
          <Link
            to={`${SETTINGS}/players/${tagPath(player.player_tag)}`}
            className="btn btn--sm"
          >
            Fix the tag
          </Link>
          <button
            type="button"
            className="btn btn--sm btn--quiet"
            onClick={async () => {
              setErr("");
              const res = await api.claimAction({
                action: "remove",
                player_tag: player.player_tag,
              });
              if (!res.ok)
                return setErr(
                  res.data?.message ?? "That did not work. Try again.",
                );
              onStopped();
            }}
          >
            Unfollow it
          </button>
        </div>
        {err ? (
          <p className="kit-form__err" role="alert">
            {err}
          </p>
        ) : null}
      </>
    );
  if (journey.failedAt)
    return (
      <>
        <p>
          A recent read failed. Saved information remains available; check again
          for new battles.
        </p>
        <button
          type="button"
          className="btn btn--sm"
          disabled={busy}
          onClick={onCheck}
        >
          Check again
        </button>
      </>
    );
  return (
    <>
      <p>
        Your tag is saved. Your profile and about your last 30 battles usually
        show up within a minute (a few at busy times).
      </p>
      <p className="kit-tiny">
        This page checks again every few seconds for the first minutes, then
        about once a minute while it&rsquo;s open. You can close it.
      </p>
    </>
  );
}
