import { chatSafe, chatWarnings, CHAT_MAX } from "./chat.mjs";
import { countedCategories } from "./policy.mjs";
import { storyAngles } from "./context.mjs";
import { CHAT_LINES } from "./words.mjs";

function nameOf(value, fallback) {
  const name = chatSafe(value).slice(0, 42);
  return name && !chatWarnings(name).length ? name : fallback;
}

/** The same finished paragraphs appear in Clan news and on the copy buttons.
 * Only the welcome uses profile highlights. Role and exit copy takes positive
 * contributions observed inside this membership interval. */
export function lifecycleWords(
  kind,
  { name, clan, story, member, weeks = 0, decks = 0, returning = false },
) {
  const player = nameOf(name, "our clanmate");
  const home = nameOf(clan, "the clan");
  const thanks =
    weeks > 0
      ? `Thanks for playing ${decks} war ${decks === 1 ? "deck" : "decks"} for ${home} over ${weeks} River Race ${weeks === 1 ? "week" : "weeks"}!`
      : null;
  switch (kind) {
    case "welcome": {
      const opening = `Welcome${returning ? " back" : ""} to ${home}, ${player}!`;
      const angles = storyAngles(story?.dossier, "welcome", { member })
        .map(chatSafe)
        .filter(
          (line) =>
            line.length <= CHAT_MAX &&
            !chatWarnings(line).length &&
            !line.startsWith("They are back:"),
        );
      const favorite = nameOf(story?.dossier?.profile?.favorite_card, "");
      const [first, second] = angles;
      if (first && opening.length + first.length + 1 <= CHAT_MAX)
        return [
          `${opening} ${first}`,
          second ??
            (favorite
              ? `Anyone else here playing ${favorite}?`
              : `Glad you’re here, ${player}! What deck are you playing these days?`),
        ];
      return [
        opening,
        first ??
          (favorite
            ? `${player}'s favorite card is ${favorite}. Who else here plays it?`
            : `Glad you're here, ${player}! What deck are you playing these days?`),
      ];
    }
    case "promotion":
      return [
        `${player} is our newest Elder in ${home}!`,
        thanks ??
          `Congratulations, ${player}! Thanks for taking on this role with us.`,
      ];
    case "demotion":
      return [
        `${player} is back at Member in ${home}.`,
        thanks ?? `Thanks for your time as Elder, ${player}.`,
      ];
    case "kick":
      return [
        `${player} was removed from ${home}. Thanks for your time with us, ${player}.`,
      ];
    case "leave":
      return [
        `${player} left ${home}.`,
        thanks ??
          `Thanks for your time with us, ${player}. Good luck in your next clan!`,
      ];
    default:
      return [`${player} is no longer on the ${home} roster.`];
  }
}

/** Only positive facts from categories this clan counted in the recommendation.
 * An entire review window must fit the observed stay before we credit it. */
export function promotionContribution(verdict, policy) {
  const f = verdict.facts;
  const here = f.tenure_days ?? f.observed_days ?? 0;
  const counted = new Set(countedCategories(policy));
  if (
    counted.has("war") &&
    here >= 7 * policy.war_window_weeks &&
    f.war?.fidelity !== "unknown" &&
    f.war?.decks_played > 0
  )
    return `Thank you for playing ${f.war.decks_played} war decks for us in the last ${policy.war_window_weeks} war weeks!`;
  if (
    counted.has("donations") &&
    here >= 7 * policy.donations_window_weeks &&
    f.donations?.known_weeks === f.donations?.weeks &&
    f.donations?.average >= 1
  )
    return `You averaged ${Math.round(f.donations.average)} donations a week over the last ${policy.donations_window_weeks} weeks. Thanks for helping your clanmates!`;
  if (
    counted.has("ranked") &&
    here >= 7 * policy.ranked_window_weeks &&
    f.ranked?.battles > 0
  )
    return `You played ${f.ranked.battles} Ranked battles over the last ${policy.ranked_window_weeks} weeks. Congratulations on Elder!`;
  return null;
}

export function validTribute(lines) {
  return (
    Array.isArray(lines) &&
    lines.length > 0 &&
    lines.length <= CHAT_LINES.promotion &&
    lines.every(
      (line) =>
        typeof line === "string" &&
        line.trim() &&
        line === chatSafe(line) &&
        !chatWarnings(line).length,
    )
  );
}
