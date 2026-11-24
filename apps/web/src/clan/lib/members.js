/**
 * Run › Members and the member page, in words (2026-11-23): which filter
 * a member is under, the short reasons on their row, and their history's
 * entries as lines. Pure, so the words are tested apart from the pages.
 * Everything here reads what the server sent; nothing is worked out that
 * the rules or the record did not say.
 */
import { DECLINE_WORDS } from "../components/ActionCard.jsx";
import { KINDS, eventLine } from "../components/Exceptions.jsx";
import { ROLE } from "./words.js";

/** The members list's filters, in order. */
export const MEMBER_FILTERS = [
  ["needs", "Needs you"],
  ["close", "Getting close"],
  ["unknown", "Not enough info"],
  ["exception", "Has an exception"],
  ["all", "Everyone"],
];

/** An exception's kind in words ("Keep as Elder"); an unknown kind reads
 *  as "Exception". */
export const exceptionWords = (kind) => KINDS[kind]?.label ?? "Exception";

/** The kinds that keep a member from a kick while they run. The quiet
 *  days still count: nothing is subtracted when one ends. */
const NO_KICK = new Set(["keep_in_clan", "away"]);
/** Whether a running exception keeps this member from a kick. */
export const kickHeld = (m) =>
  (m.exceptions ?? []).some((e) => NO_KICK.has(e.kind));

/** Whether a member is under a filter. `waiting` is the set of tags with an
 *  open action in the leaders' inbox. */
export function inFilter(m, key, waiting = new Set()) {
  if (key === "needs")
    return m.bucket === "actionable" || waiting.has(m.player_tag);
  if (key === "close") return m.bucket === "building";
  if (key === "unknown") return m.bucket === "held";
  if (key === "exception") return (m.exceptions ?? []).length > 0;
  return true;
}

/** Everyone in Elder rank order, then the unranked by name. */
export function byRank(a, b) {
  const ra = a.standing?.rank ?? Infinity;
  const rb = b.standing?.rank ?? Infinity;
  if (ra !== rb) return ra - rb;
  return String(a.name ?? a.player_tag).localeCompare(
    String(b.name ?? b.player_tag),
  );
}

/** Did they meet the rules' minimums: true, false, or null for unknown. */
export function didTheirPart(m) {
  const min = m.facts?.minimums;
  if (!min || min.unknown) return null;
  return min.passes === true ? true : min.passes === false ? false : null;
}

export const PART_WORDS = {
  true: "Did their part",
  false: "Missed the minimums",
  null: "Not sure yet",
};

/**
 * The short reasons on a member's row, most pressing first, each a few
 * words. `calendar` writes a date ("Fri Dec 12"); `policy` is the board's.
 */
export function whyChips(m, { policy = {}, calendar = (d) => d } = {}) {
  const chips = [];
  const leaderRole = m.role === "leader" || m.role === "coLeader";
  for (const e of m.exceptions ?? [])
    chips.push(`${exceptionWords(e.kind)} to ${calendar(e.until)}`);
  const r = m.removal ?? {};
  if (policy.removal && !leaderRole && r.state && r.state !== "none") {
    const day = r.removal_day ?? policy.removal_day;
    chips.push(day ? `Kick at day ${day}` : "Kick clock running");
  }
  if (m.demotion?.state === "eligible" || m.demotion?.demotable_now)
    chips.push("Demote to Member");
  else if (m.demotion && m.demotion.state && m.demotion.state !== "none")
    chips.push("Slipping as Elder");
  if (policy.ranks_elder) {
    if (leaderRole) chips.push(`${ROLE[m.role]}: skipped by the rules`);
    else if (m.role === "member") {
      const p = m.promotion ?? {};
      if (p.state === "eligible")
        chips.push(
          p.promotable_now ? "Promote to Elder" : "Ready for Elder, no seat",
        );
      else if (p.state === "building") chips.push("Building to Elder");
      else if (
        m.facts?.tenure_known !== false &&
        Number.isFinite(m.facts?.tenure_days) &&
        Number.isFinite(policy.tenure_min_days) &&
        m.facts.tenure_days < policy.tenure_min_days
      )
        chips.push(`Elder after ${policy.tenure_min_days} days`);
    }
  }
  if (m.bucket === "held") chips.push("Not enough info");
  return chips;
}

/** Days since a member's last battle, whole, or null. */
export const quietDays = (m) =>
  Number.isFinite(m.facts?.days_idle) ? Math.floor(m.facts.days_idle) : null;

/** The middle of a list of numbers, or null. */
export function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** The member page's history filters, in order. */
export const HISTORY_FILTERS = [
  ["all", "All"],
  ["role", "Role"],
  ["actions", "Actions"],
  ["war", "War"],
  ["awards", "Awards"],
  ["notes", "Notes"],
];

const ACTION_NOUN = {
  promotion: "Promotion",
  demotion: "Demotion",
  removal: "Removal",
  departure: "Departure check",
  welcome: "Welcome",
  away: "Away check",
};
const STATUS_WORDS = {
  proposed: "raised",
  done: "done",
  declined: "declined",
  reopened: "reopened",
  withdrawn: "withdrawn",
};
const nameOf = (p) => p?.name ?? p?.player_tag ?? null;
const roleWord = (r) => ROLE[r] ?? r ?? "a member";
const RANK = { member: 0, elder: 1, coLeader: 2, leader: 3 };
const decline = (reason) =>
  reason ? (DECLINE_WORDS[reason] ?? reason.replaceAll("_", " ")) : null;
const join = (...bits) => bits.filter(Boolean).join(" · ") || null;

/**
 * One history entry as a title and a detail line. `clanName` names the
 * clan; `calendar` writes a date; `self` is the member's tag, so their own
 * away reads as theirs.
 */
export function historyLine(
  e,
  { clanName = "the clan", calendar = (d) => d, self = null } = {},
) {
  switch (e.kind) {
    case "known_since":
      return {
        title: `Already a member when Elixir started following ${clanName}`,
        detail: "Nothing before this day is known",
      };
    case "joined":
      return {
        title: e.again ? `Joined ${clanName} again` : `Joined ${clanName}`,
        detail: null,
      };
    case "left":
      return {
        title: `Left ${clanName}`,
        detail: e.role ? `Was ${roleWord(e.role)}` : null,
      };
    case "role_changed": {
      const up = (RANK[e.role_after] ?? -1) > (RANK[e.role_before] ?? -1);
      return {
        title: `${up ? "Promoted" : "Demoted"} to ${roleWord(e.role_after)}`,
        detail: e.action
          ? join(
              e.action.headline?.replace(/\.$/, ""),
              nameOf(e.action.by)
                ? `${nameOf(e.action.by)} tapped Done`
                : "Done",
            )
          : `From ${roleWord(e.role_before)}, seen in the game`,
      };
    }
    case "action": {
      const noun = ACTION_NOUN[e.type] ?? e.label ?? "Action";
      const by = nameOf(e.by);
      const status = STATUS_WORDS[e.status] ?? e.status;
      return {
        title: `${noun} ${status}${by && e.status !== "proposed" ? ` by ${by}` : ""}`,
        detail: join(
          e.status === "proposed" ? e.headline : null,
          decline(e.reason && e.status === "declined" ? e.reason : null),
          e.status === "withdrawn" ? e.reason : null,
          e.note,
        ),
      };
    }
    case "exception": {
      const own =
        e.exception === "away" &&
        e.event === "added" &&
        e.by?.player_tag === self;
      const told = e.event === "added" || e.event === "changed";
      return {
        title: own
          ? "Marked themselves away"
          : eventLine({
              kind: e.exception,
              event: e.event,
              by: e.by?.player_tag ?? null,
              by_name: e.by?.name ?? null,
              migration: e.migration ?? null,
            }),
        detail: told
          ? join(
              e.until ? `ends ${calendar(e.until)}` : null,
              e.visibility === "clan"
                ? "The clan can see it"
                : e.visibility === "leaders"
                  ? "Leaders only"
                  : null,
              e.note,
            )
          : null,
      };
    }
    case "war_week":
      return {
        title: `${e.colosseum ? "Colosseum" : `River Race week ${e.week}`}: ${e.decks} of ${e.decks_asked} war decks`,
        detail: join(
          `Season ${e.season_id}`,
          e.in_progress ? "This week so far" : null,
        ),
      };
    case "award":
      return {
        title: `Won ${e.name}${e.rank > 1 ? `, place ${e.rank}` : ""} for Season ${e.season_id}`,
        detail: join(nameOf(e.by) ? `Given by ${nameOf(e.by)}` : null, e.note),
      };
    case "note":
      return {
        title: `${e.tier === "leader" ? "Leader" : "Elder"} note from ${nameOf(e.by) ?? "a leader"}`,
        detail: e.text,
      };
    default:
      return { title: "Something happened", detail: null };
  }
}

/** What the history cannot show, in a line, from the server's gap keys. */
export function gapLine(gaps = []) {
  const bits = [];
  if (gaps.includes("participation_unavailable"))
    bits.push("the clan's weeks could not be read");
  if (gaps.includes("roster_unavailable"))
    bits.push("the roster's recent changes could not be read");
  if (gaps.includes("war_window")) bits.push("race weeks go back 8 weeks");
  if (!bits.length) return null;
  const s = bits.join("; ");
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}
