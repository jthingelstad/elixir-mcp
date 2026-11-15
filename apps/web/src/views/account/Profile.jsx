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
 * Profile: the account you are signed in as. Editable here are the profile
 * image (its own panel, AvatarPicker.jsx) and the time zone; everything else names where it is changed, because each has its own
 * page. Limits read in full on Usage and limits, Discord on Connections &
 * agents.
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
      <PageHead title="Profile" sub="Your account and your preferences." />
      <ZoneOffer />
      <Panel title="You in Elixir" titleAs="h2">
        <Identity me={me} main={main} verified={mainVerified} />
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
                    Manage in Connections &amp; agents
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
                  <Note>
                    Sign in with it, and a clan&rsquo;s Discord agent knows it
                    is you.
                  </Note>
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
      <Panel title="Closing your account" titleAs="h2">
        <p className="st-inset m-0">
          There is no delete button. Write to admin@poapkings.com, or{" "}
          <Link to={`${SETTINGS}/feedback?send=1`}>send it as feedback</Link>,
          and it is carried out in one reviewed step.
        </p>
      </Panel>
    </div>
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
