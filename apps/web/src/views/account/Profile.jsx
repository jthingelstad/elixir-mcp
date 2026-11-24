import {
  Avatar,
  Disclosure,
  ErrorState,
  Icon,
  Link,
  PageHead,
  Panel,
  PlayerName,
  TagText,
} from "@elixir-mcp/ui";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api.js";
import {
  deleteConfirmMatches,
  deleteConfirmWords,
} from "@elixir-mcp/contracts";
import { ZoneOffer } from "../../components/ZoneOffer.jsx";
import { AvatarPicker } from "./AvatarPicker.jsx";
import { discordStartHref } from "../../discord.js";
import { limitsLabel } from "../../lib/words.js";
import { SETTINGS } from "../../lib/settings.js";
import { tagPath } from "../../lib/tag-url.js";
import { Facts, Note } from "./parts.jsx";
import { PassportRow } from "../../home/PassportRow.jsx";
import { summaryOf } from "../../lib/passport.js";
import { playerHref } from "../../lib/player.js";
import { useMyPassport } from "../../lib/queries.js";
import { YourPlace } from "../../clan/views/YourPlace.jsx";

/**
 * Profile: the account you are signed in as. Editable here are your
 * @handle, the profile image (its own panel, AvatarPicker.jsx) and the
 * time zone; everything else names where it is changed, because each has its own
 * page. Limits read in full on Usage and limits, Discord on Connections.
 *
 * Who you are comes first (#1015): your main player as every member sees
 * it, your passport and your place, before the account's private
 * machinery. Your place lives here for good (2026-11-14): #place (the
 * passport's On the Map, What members see's Location) opens its picker.
 */
export function Profile({ me, refresh, hash = null }) {
  const [tzError, setTzError] = useState(null);
  const timezones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : ["UTC"];
  const main = (me?.claims ?? []).find((c) => c.is_primary) ?? null;
  const discordOn = me?.discord || me?.features?.discord_login === true;
  const mainVerified = main
    ? (me?.player_verifications?.[main.player_tag] ??
      main.status === "verified")
    : false;

  return (
    <div className="st-page">
      <PageHead
        title="Profile settings"
        sub="Your account and your preferences."
      />
      <ZoneOffer />
      <Panel title="You in Elixir" titleAs="h2">
        <Identity me={me} main={main} verified={mainVerified} />
        <HandleSetting me={me} refresh={refresh} />
        <PassportPreview />
        <PlaceSetting hash={hash} />
      </Panel>
      <AvatarPicker me={me} refresh={refresh} />
      <Panel title="Account" titleAs="h2">
        <Facts
          rows={[
            [
              "Email",
              <>
                {me?.email ??
                  "Not on file yet. It is recorded at your next sign-in."}
                <Note>
                  Used for sign-in and email. To change it, write to
                  admin@poapkings.com.
                </Note>
              </>,
            ],
            [
              "Sign-in",
              me?.discord
                ? "Email link, a six-digit code, or Discord"
                : "Email link, or a six-digit code",
            ],
            [
              "Time zone",
              <>
                <select
                  aria-label="Time zone"
                  className="select w-auto max-w-full"
                  value={me?.timezone ?? ""}
                  onChange={async (ev) => {
                    setTzError(null);
                    const r = await api.setTimezone(ev.target.value);
                    if (!r?.ok)
                      setTzError(
                        r?.data?.message ??
                          "That time zone could not be saved.",
                      );
                    refresh();
                  }}
                >
                  <option value="">UTC (default)</option>
                  {/* A zone saved from another browser stays listed even
                      when this browser's list lacks it. */}
                  {[
                    ...(me?.timezone && !timezones.includes(me.timezone)
                      ? [me.timezone]
                      : []),
                    ...timezones,
                  ].map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
                <Note>
                  {tzError ?? "Used throughout Elixir. It saves as you pick."}
                </Note>
                <Disclosure title="Time zone details">
                  <p className="page-head__note m-0">
                    Your zone sets the times on these pages, how a date in a
                    question resolves, local times in answers to your AI, and
                    the days your mail names. Stored times stay UTC.
                  </p>
                </Disclosure>
              </>,
            ],
            [
              "Main player",
              main ? (
                <>
                  <Link
                    to={`${SETTINGS}/players/${tagPath(main.player_tag)}`}
                    className="hit"
                  >
                    <PlayerName tag={main.player_tag} verified={mainVerified}>
                      <TagText>
                        {main.nickname ?? main.name ?? main.player_tag}
                      </TagText>
                    </PlayerName>
                  </Link>
                  <Note>
                    The name in your top bar, and who Stats opens on. Change it
                    on another of your players&rsquo; pages.
                  </Note>
                </>
              ) : (
                <>
                  None yet. Nothing defaults to you. Your first player becomes
                  your main player.{" "}
                  <Link to={`${SETTINGS}/players#add-player-tag`}>
                    Add your player
                  </Link>
                </>
              ),
            ],
            discordOn && [
              "Discord",
              me?.discord ? (
                <>
                  Connected as {me.discord.username}.{" "}
                  <Link to={`${SETTINGS}/connections/discord`}>
                    Manage in Connections
                  </Link>
                </>
              ) : (
                <>
                  <a
                    className="link"
                    href={discordStartHref({ intent: "link" })}
                  >
                    Connect Discord
                  </a>
                  <Note>Sign in with it.</Note>
                </>
              ),
            ],
            [
              "Limits",
              <>
                {limitsLabel(me?.role)}.{" "}
                <Link to={`${SETTINGS}/usage`} className="hit">
                  See Usage and limits
                </Link>
              </>,
            ],
          ]}
        />
      </Panel>
      <DeleteAccount me={me} main={main} />
    </div>
  );
}

/**
 * Delete your account (2026-11-23): right away, for good. What goes and
 * what stays matches the docs' "Removing the account"
 * (apps/site/src/docs/your-account.md). The button opens a confirm that
 * asks for your main player's name or your @handle typed out (DELETE for
 * an account with neither), by the contracts' one rule; the server checks
 * it again. A refusal (a live collector) says why; success loads the
 * front door fresh, signed out.
 */
function DeleteAccount({ me, main }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const targets = {
    handle: me?.handle ?? null,
    playerName: main?.name ?? null,
  };
  const words = deleteConfirmWords(targets);
  const ready = deleteConfirmMatches(typed, targets);
  const askFor = words.length > 1 ? `${words[0]} or ${words[1]}` : words[0];
  const run = async () => {
    setBusy(true);
    setError(null);
    const r = await api.deleteMyAccount(typed);
    if (r?.ok) {
      window.location.assign("/");
      return;
    }
    setBusy(false);
    setError(
      r?.data?.message ?? "Your account couldn't be deleted. Try again.",
    );
  };
  return (
    <Panel title="Delete your account" titleAs="h2">
      <div className="st-inset">
        <p className="m-0">
          It happens right away, and it can&rsquo;t be undone. This goes:
        </p>
        <ul>
          <li>your email address, and every way to sign in, Discord too</li>
          <li>the players and clans you follow, and your nicknames</li>
          <li>your posts, comments, cheers and share links</li>
          <li>the apps and AI you connected, and their keys</li>
          <li>your mail history, and your spot on the mailing list</li>
          <li>your passport, its Stamps and your place</li>
          <li>your feedback and your usage</li>
        </ul>
        <p className="m-0">
          Battles, profiles and clans stay. They&rsquo;re game data, kept like
          any player&rsquo;s.{" "}
          <a className="link" href="/docs/your-account#removing-the-account">
            Read the details
          </a>
        </p>
        <p className="kit-tiny m-0">
          Run a collector? Revoke it first in{" "}
          <Link className="link" to={`${SETTINGS}/collectors`}>
            Settings › Collectors
          </Link>
          .
        </p>
        {!open ? (
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => setOpen(true)}
          >
            Delete account
          </button>
        ) : (
          <form
            className="kit-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready && !busy) run();
            }}
          >
            <label htmlFor="st-delete-confirm">
              Type <strong>{askFor}</strong> to confirm
            </label>
            <div className="kit-form__row">
              <input
                id="st-delete-confirm"
                className="input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                autoFocus
              />
              <button
                type="submit"
                className="btn btn--danger"
                disabled={!ready || busy}
              >
                {busy ? "Deleting…" : "Delete my account"}
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  setTyped("");
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
            {error ? (
              <p className="kit-form__err" role="alert">
                {error}
              </p>
            ) : null}
          </form>
        )}
      </div>
    </Panel>
  );
}

/** Your main player as members see it: the picture, the name with its
 *  mark (gold only while verified), and its page. No player is the
 *  account's own icon and "New player". */
function Identity({ me, main, verified }) {
  const name = main ? (main.name ?? main.player_tag) : null;
  return (
    <div className="kit-passport__who">
      {main ? (
        <Avatar
          name={name}
          tag={main.player_tag}
          verified={verified}
          card={verified ? (me?.avatar_card_id ?? null) : null}
        />
      ) : (
        <span className="kit-av kit-av--account" aria-hidden="true">
          <Icon name="user-round" size={20} />
        </span>
      )}
      <div className="kit-passport__who-main">
        <span className="kit-passport__who-name">
          {main ? (
            <Link className="link" to={playerHref(main.player_tag)}>
              <PlayerName tag={main.player_tag} verified={verified}>
                <TagText>{name}</TagText>
              </PlayerName>
            </Link>
          ) : (
            "New player"
          )}
        </span>
        <span className="kit-passport__who-note">
          {!main ? (
            <Link className="link" to={`${SETTINGS}/players#add-player-tag`}>
              Add your player
            </Link>
          ) : verified ? (
            main.player_tag
          ) : (
            "Player not verified"
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * Your @handle (Jamie, 2026-11-15): optional, unique, public on your
 * account page, in follow lists and in search. Typing checks it as you go
 * (free, taken, or not allowed); with none set, Elixir offers one made
 * from your main player's name. Save sets it; Remove takes it off.
 */
function HandleSetting({ me, refresh }) {
  const current = me?.handle ?? null;
  const [draft, setDraft] = useState(current ?? "");
  const [check, setCheck] = useState(null);
  const [suggestion, setSuggestion] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);
  useEffect(() => setDraft(current ?? ""), [current]);
  // A suggestion only for an account with no handle yet.
  useEffect(() => {
    if (current) return undefined;
    let live = true;
    api.checkHandle("").then((r) => {
      if (live && r?.ok) setSuggestion(r.data?.suggestion ?? null);
    });
    return () => {
      live = false;
    };
  }, [current]);
  const typed = draft.trim().replace(/^@/, "").toLowerCase();
  useEffect(() => {
    if (!typed || typed === current) {
      setCheck(null);
      return undefined;
    }
    let live = true;
    const timer = setTimeout(async () => {
      const r = await api.checkHandle(typed);
      if (live && r?.ok) setCheck(r.data);
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [typed, current]);
  const save = async (value) => {
    setBusy(true);
    setError(null);
    setSaved(null);
    const r = await api.setHandle(value);
    setBusy(false);
    if (!r?.ok) {
      setError(r?.data?.message ?? "That handle could not be saved.");
      return;
    }
    setSaved(value ? "Saved." : "Removed.");
    refresh();
  };
  const ready =
    Boolean(typed) && typed !== current && check?.handle === typed
      ? check.available
      : false;
  return (
    <section className="st-handle" aria-labelledby="st-handle-head">
      <h3 id="st-handle-head" className="st-group">
        Your @handle
      </h3>
      <form
        className="kit-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) save(typed);
        }}
      >
        <label htmlFor="st-handle-input">
          {current ? `You're @${current}` : "Pick a handle (optional)"}
        </label>
        <div className="kit-form__row">
          <input
            id="st-handle-input"
            className="input"
            placeholder={suggestion ? `@${suggestion}` : "@handle"}
            value={draft}
            maxLength={21}
            onChange={(e) => {
              setDraft(e.target.value);
              setSaved(null);
            }}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck="false"
          />
          <button type="submit" className="btn" disabled={busy || !ready}>
            Save handle
          </button>
          {current ? (
            <button
              type="button"
              className="btn btn--quiet"
              disabled={busy}
              onClick={() => save(null)}
            >
              Remove
            </button>
          ) : null}
        </div>
        {error ? (
          <p className="kit-form__err" role="alert">
            {error}
          </p>
        ) : check && check.handle === typed && !check.available ? (
          <p className="kit-form__err" aria-live="polite">
            {check.message}
          </p>
        ) : (
          <p className="kit-tiny" aria-live="polite">
            {saved ??
              (ready
                ? `@${typed} is free.`
                : !current && suggestion && !typed
                  ? `Try @${suggestion}, or pick your own.`
                  : "3 to 20 letters, numbers or _. Members see it on your account page, in follow lists and in search.")}
          </p>
        )}
        {!current && suggestion && !typed ? (
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setDraft(suggestion)}
          >
            Use @{suggestion}
          </button>
        ) : null}
      </form>
    </section>
  );
}

/** Your passport in one row; the page has the rest. */
function PassportPreview() {
  const query = useMyPassport();
  if (query.isPending)
    return (
      <p className="kit-tiny" role="status">
        Reading your passport…
      </p>
    );
  const env = query.data;
  if (query.isError || env?.status !== 200 || !env.data?.passport)
    return (
      <ErrorState
        title="Your passport could not be read just now"
        onRetry={() => query.refetch()}
        busy={query.isFetching}
      >
        Its Stamps are safe. Try again in a moment.
      </ErrorState>
    );
  return <PassportRow summary={summaryOf(env.data.passport)} own />;
}

/** Your place: the place or "Not set", with Set, Change and Remove, and
 *  who sees it. The router's hash, not the window's: an in-app move draws
 *  this page before the address bar has the new hash. */
function PlaceSetting({ hash }) {
  const landing =
    hash ??
    (typeof window === "undefined" ? "" : window.location.hash.slice(1));
  const opening = landing === "place";
  const section = useRef(null);
  useEffect(() => {
    if (opening) section.current?.scrollIntoView?.({ block: "start" });
  }, [opening]);
  return (
    <section
      ref={section}
      id="place"
      className="st-place"
      aria-labelledby="st-place-head"
    >
      <h3 id="st-place-head" className="st-group">
        Your place
      </h3>
      <YourPlace
        setting
        open={opening}
        verify={
          <p className="m-0">
            Not set. A place belongs to a verified player.{" "}
            <Link to={`${SETTINGS}/players/verify`}>Verify your player</Link> to
            add one.
          </p>
        }
      />
    </section>
  );
}
