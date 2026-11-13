import { Disclosure, Link, PageHead, Panel, TagText } from "@elixir-mcp/ui";
import { useState } from "react";
import { api } from "../../api.js";
import { ZoneOffer } from "../../components/ZoneOffer.jsx";
import { discordStartHref } from "../../discord.js";
import { limitsLabel } from "../../lib/words.js";
import { SETTINGS } from "../../lib/settings.js";
import { tagPath } from "../../lib/tag-url.js";
import { Facts, Note } from "./parts.jsx";

/**
 * Profile: the account you are signed in as. Editable here is the time zone
 * alone; everything else names where it is changed, because each has its own
 * page. Limits read in full on Usage and limits, Discord on Connections &
 * agents.
 */
export function Profile({ me, refresh }) {
  const [tzError, setTzError] = useState(null);
  const timezones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : ["UTC"];
  const main = (me?.claims ?? []).find((c) => c.is_primary) ?? null;
  const discordOn = me?.discord || me?.features?.discord_login === true;

  return (
    <div className="st-page">
      <PageHead title="Profile" sub="Your account and your preferences." />
      <ZoneOffer />
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
                    <TagText>
                      {main.nickname ?? main.name ?? main.player_tag}
                    </TagText>
                  </Link>
                  <Note>
                    The name in your top bar, and who Ladder opens on. Change it
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
