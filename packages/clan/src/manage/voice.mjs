/**
 * How our messages sound (2026-10-20, call 5 of the Draft in our voice
 * redesign): one clan setting, the leaders' words for how the clan
 * sounds, read by both of the clan's model's writing uses: "Draft in our
 * voice" on an Action and the editor of the clan's Discord channel
 * (Social ▸ Discord). Until then only the editor had a voice, kept with
 * the Discord connection; 0229 copied it here.
 *
 * The rules, as decided:
 * - Leaders and co-leaders read and set it, in Settings; Social ▸ Discord
 *   shows it and links there. Nobody else reads it (both of its uses are
 *   theirs alone).
 * - It is given to the model as written, inside THE CLAN, under the same
 *   checks: it sets the tone and the wording, never a fact, and never
 *   lifts a rule (`VOICE_RULE`).
 * - At most VOICE_MAX characters once tidied (one paragraph, no links or
 *   mentions), refused rather than cut. Empty is no voice.
 */

import { VOICE_MAX, tidyVoice } from "@elixir-mcp/clan-engine";
import { ManageError } from "./service.mjs";

const LEADERS = new Set(["leader", "coLeader"]);

export function createVoiceService({ ledger, now = () => Date.now() }) {
  const requireLeader = (who) => {
    if (!LEADERS.has(who.role) || who.verified === false)
      throw new ManageError(403, "leaders_only");
  };

  async function view(clanTag) {
    const saved = await ledger.clanVoice(clanTag);
    return {
      clan_tag: clanTag,
      voice: saved?.voice ?? "",
      max: VOICE_MAX,
      set_by_name: saved?.set_by_name ?? null,
      set_at: saved?.set_at ?? null,
    };
  }

  return {
    /** The clan's voice as the drafts and the editor read it: the
     *  leaders' words, or "" for none. */
    current: async (clanTag) => (await ledger.clanVoice(clanTag))?.voice ?? "",

    async view(clanTag, who) {
      requireLeader(who);
      return view(clanTag);
    },

    /** A leader or co-leader sets the clan's voice; "" or null clears it. */
    async set(clanTag, who, voice) {
      requireLeader(who);
      if (voice !== null && typeof voice !== "string")
        throw new ManageError(400, "bad_request");
      const words = tidyVoice(voice);
      if (words.length > VOICE_MAX)
        throw new ManageError(400, "voice_too_long", null, {
          max: VOICE_MAX,
          message: `Keep it to ${VOICE_MAX} characters.`,
        });
      await ledger.saveClanVoice(clanTag, {
        voice: words,
        set_by: who.player_tag,
        set_by_name: who.name ?? null,
        set_at: new Date(now()).toISOString(),
      });
      return view(clanTag);
    },
  };
}
