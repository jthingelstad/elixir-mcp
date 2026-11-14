import { PROFILE_STEPS, stampById } from "@elixir-mcp/stamps/catalog";
import { destinationHref } from "../lib/passport.js";
import { SETTINGS } from "../lib/settings.js";
import { digestLine } from "./logic.js";

/**
 * Home's profile list (#1015, docs/product/stamps.md "One profile list"),
 * as words and links, from the server's `owner.profile` alone. Nothing
 * here decides whether a step is done: the passport read does, with its
 * latches, and an unknown step stays unknown.
 *
 * Six steps, in the catalog's order. Each names the Stamp it earns where
 * it earns one; the six together earn All Set. Alts and Discord are
 * offered beside them and never counted.
 */

/** The Stamp each step earns, by catalog id; null where it earns none. */
export const STEP_STAMP = Object.freeze({
  add_player: null,
  verify_player: "player_verified",
  picture: "looking_good",
  follow_active: null,
  digest: null,
  map: "on_the_map",
});

const TITLES = {
  add_player: "Add your player",
  verify_player: "Verify it’s you",
  picture: "Pick your picture",
  follow_active: "Follow someone who plays",
  digest: "Choose your email",
  map: "Your place on the clan map",
};

/** The Stamp's name, from the catalog. */
export const stampName = (id) => (id ? (stampById(id)?.name ?? null) : null);

/** The follow step's line for its state and the follow counts. Unknown is
 *  "still catching up", never "they didn't play". */
export function followLine(state, follows) {
  if (state === "done") return "You follow someone who played this week.";
  if (state === "unknown")
    return follows
      ? "Elixir is still catching up on their battles. This step is done once it sees one from the last 7 days."
      : null;
  if (!follows || follows.following === 0)
    return "Follow one player who’s played in the last 7 days. Their battles fill your feed.";
  return follows.following === 1
    ? "The player you follow hasn’t played in the last 7 days. Follow someone who has."
    : "The players you follow haven’t played in the last 7 days. Follow someone who has.";
}

/**
 * One step's words: { id, n, title, state, stamp, line, go } where `go`
 * is { to, label, name } for its way in (null once done). `context`
 * carries the player's name, the digest setting and the home clan's tag.
 */
export function stepView(step, n, profile, context = {}) {
  const { playerName = null, digest = null, clanTag = null } = context;
  const done = step.state === "done";
  const base = {
    id: step.id,
    n,
    title: TITLES[step.id] ?? step.id,
    state: step.state,
    stamp: stampName(STEP_STAMP[step.id]),
  };
  switch (step.id) {
    case "add_player":
      return {
        ...base,
        line: done
          ? playerName
            ? `${playerName}, your main player.`
            : null
          : "Your player tag is on your Clash Royale profile, under your name.",
        go: done
          ? null
          : {
              to: `${SETTINGS}/players#add-player-tag`,
              label: "Add",
              name: "Add your player",
            },
      };
    case "verify_player":
      return {
        ...base,
        line: done
          ? playerName
            ? `${playerName} is verified.`
            : null
          : "Play one battle with the deck Elixir names. Win or lose, it counts.",
        go: done
          ? null
          : {
              to: destinationHref("verification"),
              label: "Verify",
              name: playerName ? `Verify ${playerName}` : "Verify your player",
            },
      };
    case "picture":
      return {
        ...base,
        line: done ? null : "Choose a card to be your picture.",
        go: done
          ? null
          : {
              to: destinationHref("picture"),
              label: "Choose",
              name: "Choose your picture",
            },
      };
    case "follow_active":
      return {
        ...base,
        line: followLine(step.state, profile?.follows ?? null),
        go: done
          ? null
          : {
              to: destinationHref("friends"),
              label: "Find",
              name: "Find people to follow",
            },
      };
    case "digest":
      return {
        ...base,
        line: done
          ? digestLine(digest)
          : "Your friends in one email: weekly, daily or off. Any choice counts.",
        go: done
          ? null
          : {
              to: `${SETTINGS}/emails`,
              label: "Choose",
              name: "Choose your email",
            },
      };
    case "map":
      return {
        ...base,
        line: done
          ? null
          : "Set your country, region or city, or choose Not now. Both finish this step. Only a place earns On the Map.",
        go: done
          ? null
          : {
              to: destinationHref("map-view", { clanTag }),
              label: "Set a place",
              name: "Set a place",
            },
        notNow: !done,
      };
    default:
      return { ...base, line: null, go: null };
  }
}

/**
 * The list's view from `owner.profile`, or null when there is nothing to
 * show: no read yet, a list from another version, finished (for good:
 * `complete` comes from the stored marker), or dismissed.
 *
 *  - steps: the six, or for an account that finished the older welcome
 *    list only the ones not done (the spec's "only the remaining steps").
 *  - next: the step to show first: the first to do, else the first
 *    Elixir cannot tell yet.
 *  - dismissable: only after the older welcome list.
 */
export function profileView(profile, context = {}) {
  if (!profile || profile.version !== 2) return null;
  if (profile.complete || profile.dismissed_at) return null;
  const all = PROFILE_STEPS.map(({ id }, i) => {
    const step = profile.steps?.find((s) => s.id === id) ?? {
      id,
      state: "unknown",
    };
    return stepView(step, i + 1, profile, context);
  });
  const done = all.filter((s) => s.state === "done").length;
  const older = profile.older_welcome_finished === true;
  const steps = older ? all.filter((s) => s.state !== "done") : all;
  const next =
    steps.find((s) => s.state === "todo") ??
    steps.find((s) => s.state === "unknown") ??
    null;
  return {
    done,
    total: all.length,
    steps,
    next,
    older,
    dismissable: older,
    allSet: stampName("all_set"),
  };
}

/** The optional extras, offered and never counted. */
export const EXTRAS = Object.freeze([
  {
    id: "full_roster",
    title: "Add another of your players",
    to: destinationHref("alts"),
  },
  {
    id: "linked",
    title: "Connect Discord",
    to: destinationHref("discord"),
  },
]);
