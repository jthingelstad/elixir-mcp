import { Disclosure, Setting } from "@elixir-mcp/ui";
import { useDiscord, useModel, useSocial, useVoice } from "../lib/queries.js";
import { Model } from "./Model.jsx";
import { Sharing } from "./Sharing.jsx";
import { SocialSetting } from "./SocialSetting.jsx";
import { DiscordSetting } from "./DiscordSetting.jsx";
import { VoiceSetting } from "./VoiceSetting.jsx";

const reading = (state, describe) =>
  state.error || state.forbidden
    ? "Unavailable for this read. Open the setting for details."
    : state.data
      ? describe(state.data)
      : "Reading…";

/** The leaders' words, short enough for one settings row, cut at a word. */
function excerpt(text, n = 60) {
  if (text.length <= n) return `“${text}”`;
  const cut = text.slice(0, n - 1);
  const space = cut.lastIndexOf(" ");
  return `“${(space > n / 2 ? cut.slice(0, space) : cut).trimEnd()}…”`;
}

/** Current state first; existing editors and their consequences remain contextual. */
export function Settings({ clan }) {
  const social = useSocial(clan.clan_tag).state;
  const discord = useDiscord(clan.clan_tag).state;
  const model = useModel(clan.clan_tag).state;
  const voice = useVoice(clan.clan_tag).state;
  return (
    <div className="grid gap-6">
      <div>
        <Setting
          title="Member map"
          description={reading(
            social,
            (d) =>
              `${d.enabled ? "On" : "Off"} · Visible to verified clan members`,
          )}
        >
          <SocialSetting clan={clan} />
        </Setting>
        <div>
          <Setting
            title="Actions in Discord"
            anchor="discord"
            description={reading(discord, (d) =>
              !d.set
                ? "Not connected"
                : d.refused_at || !d.readable
                  ? "Needs attention · Not posting"
                  : "Connected · Posting Actions",
            )}
          >
            <DiscordSetting clan={clan} />
          </Setting>
        </div>
        <Setting
          title="Clan model"
          anchor="settings-model"
          description={reading(model, (d) =>
            !d.set
              ? "Not connected"
              : d.refused_at
                ? "Needs attention · Key refused"
                : !d.readable
                  ? "Needs attention · Key unavailable"
                  : d.owner_leads === false
                    ? "Not in use · Key owner no longer leads"
                    : d.cap_reached
                      ? "Paused · Monthly model limit reached"
                      : !d.usable
                        ? "Not in use · Open for details"
                        : Object.keys(d.purposes ?? {}).some(
                              (purpose) => !d.model_for?.[purpose],
                            )
                          ? "Needs attention · Some model uses unavailable"
                          : d.models_refresh_error
                            ? "Needs attention · Model check failed"
                            : "Connected · Message drafts and optional Discord activity editing",
          )}
        >
          <Model clan={clan} />
        </Setting>
        <Setting
          title="Monthly model limit"
          action="Change"
          description={reading(
            model,
            (d) =>
              `${d.spend_cap_usd == null ? "No monthly limit" : `$${d.spend_cap_usd.toFixed(2)} per month`} · Your Anthropic account pays for use`,
          )}
        >
          <Model clan={clan} />
        </Setting>
        <Setting
          title="How our messages sound"
          anchor="settings-voice"
          description={reading(voice, (d) =>
            d.voice
              ? `${excerpt(d.voice)} · Used by drafts and the Discord editor`
              : "Not set · Used by drafts and the Discord editor",
          )}
        >
          <VoiceSetting clan={clan} />
        </Setting>
      </div>
      <Disclosure title="Recording and visibility: what is recorded and who can read it">
        <Sharing clan={clan} />
      </Disclosure>
    </div>
  );
}
