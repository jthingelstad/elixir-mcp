import type { MouseEventHandler } from "react";
import { Icon } from "./Icon.tsx";

/**
 * Stamps (#1015): the passport's ink impressions, drawn natively. An
 * outline in CSS, one Lucide glyph through the kit's Icon, the Stamp's
 * name and its day in text: no picture of a stamp, no bitmap text, no game
 * art. The prototype in docs/design/passport is the reference; this is the
 * kit's own.
 *
 * Earned and unearned differ in more than colour: an earned mark has a
 * double ring (solid and dashed), its ink, a slight tilt and its day; an
 * unearned one is a single thin outline with "Elixir" where the day would
 * be, and its tile says "Not earned" or "Optional" in words. Levels I, II
 * and III wear the same ink: a level is a numeral in the name, never a
 * bronze, silver or gold. Gold stays the verification mark's.
 *
 * The mark is for the eye. A tile's button carries the whole meaning in
 * its accessible name; the detail sheet carries the rule and the dates.
 */

/** The parts of a catalog entry a mark draws (`@elixir-mcp/stamps/catalog`
 *  has the full definition; the kit takes only these). */
export interface StampFace {
  id: string;
  name: string;
  icon: string;
  shape: string;
  ink: string;
  thresholds: readonly number[];
}

export const STAMP_LEVELS = ["", "I", "II", "III"] as const;

const INKS = new Set(["violet", "blue", "teal", "coral"]);

/** A Stamp's name with its level: "Cheerleader II". A once-Stamp, or a
 *  ladder not yet earned, is its name alone. */
export function stampTitle(stamp: StampFace, level = 0): string {
  return level > 0 && stamp.thresholds.length > 1
    ? `${stamp.name} ${STAMP_LEVELS[level] ?? level}`
    : stamp.name;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** A frozen local day, "2026-11-14", in words: "14 November 2026", or
 *  "14 Nov 2026" short. The day was fixed in the owner's zone when it was
 *  earned, so it is read as it is: no time zone moves it. Null for
 *  anything that is not a day. */
export function stampDay(
  day: string | null | undefined,
  { short = false }: { short?: boolean } = {},
): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ""));
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return null;
  return `${Number(m[3])} ${short ? month.slice(0, 3) : month} ${m[1]}`;
}

/** The ink impression itself. `day` is the day it was earned (or, with
 *  `before`, the day it is known to have been earned before). */
export function StampMark({
  stamp,
  level = 0,
  day = null,
  before = false,
  large = false,
  tilt = 0,
}: {
  stamp: StampFace;
  level?: number;
  day?: string | null;
  before?: boolean;
  large?: boolean;
  /** Which way an earned mark leans, so a row does not lean as one. */
  tilt?: number;
}) {
  const earned = level > 0;
  const cls = [
    "kit-stamp",
    stamp.shape === "square" ? "kit-stamp--square" : "kit-stamp--round",
    earned ? "kit-stamp--earned" : "kit-stamp--blank",
    earned && INKS.has(stamp.ink) ? `kit-stamp--${stamp.ink}` : null,
    earned ? (tilt % 2 ? "kit-stamp--tilt-b" : "kit-stamp--tilt-a") : null,
    large ? "kit-stamp--l" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const shown = earned ? stampDay(day, { short: true }) : null;
  return (
    <span className={cls} aria-hidden="true">
      <Icon name={stamp.icon} size={large ? 44 : 26} />
      <span className="kit-stamp__name">{stampTitle(stamp, level)}</span>
      {earned && before && shown ? (
        <span className="kit-stamp__day">Before</span>
      ) : null}
      <span className="kit-stamp__day">{shown ?? "Elixir"}</span>
    </span>
  );
}

/** One Stamp in a passport's collection: a button that opens its detail.
 *  `label` is the words under the mark ("Earned", "Not earned",
 *  "Optional"); `name` the button's accessible name, which says it all. */
export function StampTile({
  stamp,
  level = 0,
  day = null,
  before = false,
  tilt = 0,
  label,
  name,
  onClick,
}: {
  stamp: StampFace;
  level?: number;
  day?: string | null;
  before?: boolean;
  tilt?: number;
  label: string;
  name: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      className={`kit-stamp-tile${level > 0 ? " kit-stamp-tile--earned" : ""}`}
      data-stamp={stamp.id}
      aria-label={name}
      onClick={onClick}
    >
      <StampMark
        stamp={stamp}
        level={level}
        day={day}
        before={before}
        tilt={tilt}
      />
      <span className="kit-stamp-tile__label">{label}</span>
    </button>
  );
}

/** A small earned mark for a compact row (Profile, a player's page): the
 *  glyph in its ink and shape, for the eye; the row's words say the count. */
export function StampMini({ stamp }: { stamp: StampFace }) {
  const cls = [
    "kit-stamp-mini",
    stamp.shape === "square" ? "kit-stamp-mini--square" : null,
    INKS.has(stamp.ink) ? `kit-stamp--${stamp.ink}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={cls} aria-hidden="true">
      <Icon name={stamp.icon} size={20} />
    </span>
  );
}
