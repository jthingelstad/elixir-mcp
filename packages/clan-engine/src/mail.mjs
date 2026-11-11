/**
 * "Actions waiting for you" (door 2, 2026-09-25; Jamie): after the morning
 * evaluation, one email to each person who can act on an open action,
 * sent through Elixir, which holds the address, the switch (on to start)
 * and the unsubscribe. Only people who can act on an action are sent it
 * (Jamie). A person is emailed only when something became theirs since
 * their last email, so an action left open is not mailed every morning;
 * the email lists everything waiting, newest first, the new ones marked.
 *
 * Plain words, as Clan says them: an action's label and the member it is
 * about, a reason line, and its number only to link its own page. The button
 * opens that action's page when one is waiting, Today when more are. Nothing
 * a person could not already see signed in (D10).
 * Pure: actions, people and the last send in; one email per person out.
 */

import { ACTION_TYPES, actionLabel, canAct } from "./actions.mjs";
import { removalLinkLine } from "./departures.mjs";

export const ACTIONS_MAIL_KIND = "clan_actions_waiting";
/** Lines in one email before the rest are counted. */
export const MAIL_MAX_LINES = 10;

const labelOf = actionLabel;
/** An action in one line: its number, its label and the member it is
 *  about. The email and the Discord post say it the same way. */
export const actionLine = (c) =>
  `${Number.isInteger(c.number) ? `#${c.number} ` : ""}${
    c.player_name && ACTION_TYPES[c.type]?.audience !== "member"
      ? `${labelOf(c)}: ${c.player_name}`
      : labelOf(c)
  }`;

/** The same line with no number: what mail says (A23). Discord keeps the
 *  number, where it is how people refer to an action. */
export const actionTitle = (c) => actionLine({ ...c, number: null });

/** Mail's line limit (packages/mail, clan-mail.mjs). */
const REASON_MAX = 160;
const MODES_UNSEEN =
  "Modes the battle log doesn’t carry aren’t seen, so you weigh it.";

const clip = (s) =>
  s.length > REASON_MAX ? `${s.slice(0, REASON_MAX - 1).trimEnd()}…` : s;

/** Why an action is waiting, in the words Clan's own page uses for it (D10),
 *  one line within the door's limit. `{{when:<instant>}}` is named in the
 *  reader's zone by the render. A reason the action has no words for is no
 *  line, never a guess. */
export function actionReason(c) {
  const ev = c.evidence ?? {};
  switch (c.type) {
    case "welcome": {
      const did = "Welcome them in clan chat, then mark it done.";
      return ev.joined_at ? `Joined {{when:${ev.joined_at}}}. ${did}` : did;
    }
    case "departure":
      return ev.suggested_classification === "kick"
        ? `${removalLinkLine(ev.removal_number)} Confirm Kicked or Left.`
        : "A departure no action explained.";
    case "away": {
      const days = Math.floor(ev.days_idle ?? 0);
      const asks = `Mark yourself away${ev.away_max_days ? `, for up to ${ev.away_max_days} days` : ""}. Keeps you off the removal list while it’s on. The days keep counting.`;
      return clip(
        ev.days_idle != null
          ? `${days} ${days === 1 ? "day" : "days"} since your last recorded battle. ${asks}`
          : asks,
      );
    }
    case "awards_announcement":
      return ev.season_id != null
        ? `The awards for season ${ev.season_id} are saved and ready to announce.`
        : "";
    case "awards_standings":
      return ev.section_index != null
        ? `Week ${ev.section_index + 1} standings are ready to post to clan chat.`
        : "Standings are ready to post to clan chat.";
    case "rules_announcement":
      return "The policy was saved. This tells the clan how it runs now.";
    case "removal": {
      const said = ev.rationale?.headline;
      if (!said) return "";
      // The caveat comes off first when the line runs long.
      const whole = `${said} ${MODES_UNSEEN}`;
      return clip(whole.length <= REASON_MAX ? whole : said);
    }
    default:
      return clip(ev.rationale?.headline ?? "");
  }
}

/** The action's word in a subject that lists several. */
const SUBJECT_WORD = {
  promotion: "promote",
  demotion: "demote",
  removal: "remove",
  departure: "departure",
  welcome: "welcome",
  awards_standings: "standings",
  awards_announcement: "awards",
  rules_announcement: "rules",
  away: "away",
};

const SUBJECT_MAX = 120;

/** "4 actions in <clan>: departure <name>, remove <name>", whole names within
 *  the subject's limit, then "and N more". */
function severalSubject(mine, clan) {
  const head = `${mine.length} actions in ${clan}`;
  const said = mine.map((c) =>
    [
      SUBJECT_WORD[c.type] ?? c.type,
      ACTION_TYPES[c.type]?.audience !== "member" ? c.player_name : null,
    ]
      .filter(Boolean)
      .join(" "),
  );
  for (let k = said.length; k > 0; k--) {
    const rest = said.length - k;
    const subject = `${head}: ${said.slice(0, k).join(", ")}${rest ? `, and ${rest} more` : ""}`;
    if (subject.length <= SUBJECT_MAX) return subject;
  }
  return head.slice(0, SUBJECT_MAX);
}

/**
 * @param {object} p
 * @param {string} p.clanTag
 * @param {string|null} p.clanName
 * @param {Array} p.cards the clan's actions (any status; open ones count)
 * @param {Array<{player_tag:string,name?:string,role:string}>} p.people
 *   everyone in the clan today, with their in-game role
 * @param {Record<string,string>} [p.lastMailed] tag -> instant of their
 *   last actions email for this clan
 * @param {string} p.appUrl where Elixir Clan's app is
 *   (https://elixir.poapkings.com/clan); a clan's pages are under it
 * @returns {Array<{player_tag, subject, lines, link, card_ids, new_card_ids}>}
 *   `lines` are {title, reason, number, new}, then "And N more." past the cap
 */
export function actionsWaitingMail({
  clanTag,
  clanName,
  cards,
  people,
  lastMailed = {},
  appUrl,
}) {
  const clan = clanName ?? clanTag;
  const open = cards
    .filter((c) => c.status === "proposed")
    .sort((a, b) => (a.raised_at < b.raised_at ? 1 : -1));
  const base = `${appUrl.replace(/\/$/, "")}/${clanTag.slice(1)}`;
  const out = [];
  for (const who of people) {
    const mine = open.filter((c) => canAct(c, who));
    if (!mine.length) continue;
    const since = lastMailed[who.player_tag] ?? null;
    const fresh = new Set(
      mine.filter((c) => !since || c.raised_at > since).map((c) => c.card_id),
    );
    if (!fresh.size) continue;
    const lines = mine.slice(0, MAIL_MAX_LINES).map((c) => ({
      title: actionTitle(c),
      reason: actionReason(c),
      ...(Number.isInteger(c.number) ? { number: c.number } : {}),
      new: fresh.has(c.card_id),
    }));
    if (mine.length > MAIL_MAX_LINES)
      lines.push(`And ${mine.length - MAIL_MAX_LINES} more.`);
    const subject =
      mine.length === 1
        ? `${actionTitle(mine[0])} (${clan})`
        : severalSubject(mine, clan);
    out.push({
      player_tag: who.player_tag,
      subject: subject.slice(0, SUBJECT_MAX),
      lines,
      // One action waiting: its own page; more: Today.
      link:
        mine.length === 1 && Number.isInteger(mine[0].number)
          ? `${base}/actions/${mine[0].number}`
          : `${base}/today`,
      card_ids: mine.map((c) => c.card_id),
      new_card_ids: [...fresh],
    });
  }
  return out;
}
