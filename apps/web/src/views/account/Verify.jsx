import { useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import { Icon } from "../../components/Icon.jsx";
import { DeckGrid } from "../../components/DeckGrid.jsx";

/**
 * Verify — prove that this account controls a player.
 *
 * A wizard, and it should feel like a small game: the brief shows eight
 * cards as the game lays them out, the other panel shows what Elixir
 * currently sees in the player's deck slot, and cards light up one by
 * one as they appear. The browser polls the recorded state every
 * ~15 s; it never asks the CR API itself - the server decides when a
 * live read is worth asking a collector for.
 *
 * Mobile first: the member is on the phone the game is on, switching
 * between the game and this page. Big cards, thumb-sized controls.
 */
const TAG_OK = /^#?[0289PYLQGRJCUVOo]{3,12}$/;

function reducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true
  );
}

function clock(iso) {
  if (!iso) return "not yet";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "not yet";
  return d.toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function minutesLeft(iso, now) {
  const ms = new Date(iso).getTime() - now;
  return Math.max(0, Math.ceil(ms / 60_000));
}

function messageFor(r) {
  const code = r.data?.error ?? r.error;
  switch (code) {
    case "verified_elsewhere":
      return "That player is already verified by another account. If that is you, sign in there, or ask us to look.";
    case "rate_limited":
      return "Too many starts in the last hour. Give it a little while and try again.";
    case "quota_exceeded":
      return "Your tier has no free player slot for a new tag. Remove one under Tracking, or verify a player you already track.";
    case "not_entitled":
      return "Only a person's account can hold a claim.";
    case "invalid_tag":
      return "That does not look like a player tag. Tags look like #2PP0V90Y.";
    case "timeout":
    case "network":
      return "We could not reach the service. Check your connection and try again.";
    default:
      return r.data?.message ?? "Something went wrong. Try again in a moment.";
  }
}

export function Verify({ refresh, navigate }) {
  const [list, setList] = useState(null);
  const [challenge, setChallenge] = useState(null);
  const [collecting, setCollecting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [tag, setTag] = useState("");
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const load = () =>
    api.verifyList().then((r) => {
      if (r.ok) setList(r.data);
      else setErr(messageFor(r));
    });
  useEffect(() => {
    load();
  }, []);

  // Refreshing the page resumes the open challenge.
  useEffect(() => {
    if (!list || challenge) return;
    const open = list.players.find((p) => p.challenge);
    if (open)
      api
        .verifyStatus(open.challenge.challenge_id)
        .then((r) => r.ok && setChallenge(r.data));
  }, [list, challenge]);

  // The live half: poll the recorded state while the challenge is open.
  const challengeId = challenge?.challenge_id ?? null;
  const challengeState = challenge?.state ?? null;
  const pollEvery = (challenge?.retry_after_s ?? 15) * 1000;
  useEffect(() => {
    if (!challengeId || challengeState !== "open") return undefined;
    // The countdown's clock: set when a challenge opens, then per poll.
    setNow(Date.now());
    const id = setInterval(async () => {
      const r = await api.verifyStatus(challengeId);
      if (!r.ok) return;
      setChallenge(r.data);
      setTick((t) => t + 1);
      setNow(Date.now());
      if (r.data.state === "verified") {
        api.verifyList().then((l) => l.ok && setList(l.data));
        refresh?.();
      }
    }, pollEvery);
    return () => clearInterval(id);
  }, [challengeId, challengeState, pollEvery, refresh]);

  // A player recorded a moment ago has no collection yet: retry the start
  // until the first profile lands. The start function is reached through
  // a ref so the interval depends on the tag alone.
  const startRef = useRef(null);
  const collectingTag = collecting?.player_tag ?? null;
  const collectEvery = (collecting?.retry_after_s ?? 15) * 1000;
  useEffect(() => {
    if (!collectingTag) return undefined;
    const id = setInterval(
      () => startRef.current?.(collectingTag),
      collectEvery,
    );
    return () => clearInterval(id);
  }, [collectingTag, collectEvery]);

  async function start(playerTag) {
    setBusy(true);
    setErr("");
    const r = await api.verifyStart(playerTag);
    setBusy(false);
    if (r.status === 202) {
      setCollecting(r.data);
      return;
    }
    if (!r.ok) {
      setCollecting(null);
      setErr(messageFor(r));
      return;
    }
    setCollecting(null);
    setChallenge(r.data);
    load();
  }

  // The interval above reaches the latest start() through the ref; the
  // assignment lives in an effect because refs are not for rendering.
  useEffect(() => {
    startRef.current = start;
  });

  function submitTag(e) {
    e.preventDefault();
    const t = tag.trim().toUpperCase();
    if (!TAG_OK.test(t)) {
      setErr("That does not look like a player tag. Tags look like #2PP0V90Y.");
      return;
    }
    start(t.startsWith("#") ? t : `#${t}`);
  }

  const header = (
    <div>
      <h1 className="page__title">Verify</h1>
      <p className="page__lede">
        Prove that you control a player by setting a deck we name. Nothing to
        install, nothing to share: we only read your public profile.
      </p>
    </div>
  );

  if (challenge && challenge.state === "verified")
    return (
      <>
        {header}
        <section className="panel verify__done">
          <div className="panel__body">
            <VerifiedBurst name={challenge.name ?? challenge.player_tag} />
            <p className="verify__next">
              You can switch your deck back now.
              {challenge.verified_at && (
                <span className="verify__when">
                  {" "}
                  Verified at {clock(challenge.verified_at)}.
                </span>
              )}
            </p>
            <div className="verify__actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setChallenge(null)}
              >
                Done
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => navigate?.("/account/tracking")}
              >
                Go to Tracking
              </button>
            </div>
          </div>
        </section>
      </>
    );

  if (challenge && challenge.state === "expired")
    return (
      <>
        {header}
        <section className="panel">
          <div className="panel__body">
            <p className="verify__lead">
              That challenge timed out after twenty minutes. No harm done: start
              again and you get a fresh deck.
            </p>
            <div className="verify__actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => start(challenge.player_tag)}
              >
                Start again
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => setChallenge(null)}
              >
                Pick another player
              </button>
            </div>
            {err && (
              <p className="verify__error" role="alert">
                {err}
              </p>
            )}
          </div>
        </section>
      </>
    );

  if (challenge && challenge.state === "open") {
    const left = minutesLeft(challenge.expires_at, now);
    return (
      <>
        {header}
        <div className="verify__row">
          <p className="verify__who">
            <strong>{challenge.name ?? challenge.player_tag}</strong>{" "}
            <span className="mono">{challenge.player_tag}</span>
          </p>
          <span className="chip chip--info">{left} min left</span>
        </div>
        <div className="verify__panels">
          <section className="panel">
            <div className="panel__head">
              <h2>Set this deck</h2>
            </div>
            <div className="panel__body">
              <p className="verify__lead">
                Put these 8 cards in an empty deck slot and select it. Switch
                back afterwards.
              </p>
              <DeckGrid cards={challenge.target} label="The deck to set" />
            </div>
          </section>
          <section className="panel">
            <div className="panel__head">
              <h2>What Elixir sees</h2>
            </div>
            <div className="panel__body">
              <div className="verify__live" role="status">
                {challenge.live_pending && (
                  <span className="verify__dot" aria-hidden="true" />
                )}
                <span>
                  <strong>{challenge.matched}</strong> of {challenge.of} in
                  place · last seen{" "}
                  {clock(challenge.seen_at ?? challenge.profile_at)}
                </span>
              </div>
              <div className="verify__tick" aria-hidden="true">
                <i key={tick} />
              </div>
              <DeckGrid
                cards={challenge.seen}
                label="The deck Elixir last saw"
                dimUnmatched
              />
              <p className="verify__hint">
                The game's API caches profiles, so a freshly set deck usually
                shows here in under a minute, sometimes a few. Keep this page
                open; it checks every 15 seconds.
              </p>
            </div>
          </section>
        </div>
        <div className="verify__actions">
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => setChallenge(null)}
          >
            Back
          </button>
        </div>
      </>
    );
  }

  // The picker.
  const players = list?.players ?? [];
  return (
    <>
      {header}
      {collecting && (
        <section className="panel">
          <div className="panel__body">
            <div className="verify__live" role="status">
              <span className="verify__dot" aria-hidden="true" />
              <span>
                Reading the profile of{" "}
                <span className="mono">{collecting.player_tag}</span> for the
                first time, so we know which cards you own. Usually under a
                minute.
              </span>
            </div>
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel__head">
          <h2>Your players</h2>
        </div>
        <div className="panel__body">
          {list === null ? (
            <p style={{ color: "var(--ink-faint)" }}>Loading…</p>
          ) : players.length === 0 ? (
            <p className="verify__lead">
              You have not added a player yet. Enter your tag below to start.
            </p>
          ) : (
            <ul className="verify__list">
              {players.map((p) => (
                <li key={p.player_tag} className="verify__row">
                  <span className="verify__who">
                    <strong>{p.name ?? p.player_tag}</strong>{" "}
                    <span className="mono">{p.player_tag}</span>
                    {p.is_primary && (
                      <span className="chip chip--tier">primary</span>
                    )}
                  </span>
                  {p.status === "verified" ? (
                    <span className="chip chip--ok">
                      <Icon name="shield-check" size={14} /> Verified
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={busy}
                      onClick={() => start(p.player_tag)}
                    >
                      {p.challenge ? "Resume" : "Verify"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel__head">
          <h2>Another tag</h2>
        </div>
        <div className="panel__body">
          <form className="verify__form" onSubmit={submitTag}>
            <input
              id="verify-tag"
              aria-label="Player tag"
              className="input"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="#2PP0V90Y"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
            <button type="submit" className="btn" disabled={busy || !tag}>
              Verify this tag
            </button>
          </form>
          <p className="verify__hint">
            A tag you have not added yet is added first, unverified, and
            recorded from then on.
          </p>
        </div>
      </section>
      {err && (
        <p className="verify__error" role="alert">
          {err}
        </p>
      )}
    </>
  );
}

/** The unlock: cards have already flipped into place one by one; the
 *  badge lands and a burst radiates. Reduced motion gets the badge
 *  without the flight. */
function VerifiedBurst({ name }) {
  const still = reducedMotion();
  return (
    <div className="verify__burst" data-motion={still ? "reduced" : "full"}>
      {!still &&
        Array.from({ length: 12 }, (_, i) => (
          <span
            key={i}
            className="verify__spark"
            style={{ "--a": `${i * 30}deg` }}
            aria-hidden="true"
          />
        ))}
      <div className="verify__badge" role="status">
        <Icon name="shield-check" size={28} />
        Verified
      </div>
      <p className="verify__lead">
        <strong>{name}</strong> is yours. Every agent that asks about you can
        now be told so.
      </p>
    </div>
  );
}
