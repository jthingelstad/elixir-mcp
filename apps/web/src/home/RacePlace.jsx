/** A race's place as a bar: first fills it, fifth a fifth. A race has five
 *  clans (cr-agent-api-docs models/river-race.md); a place outside one to
 *  five draws nothing. Home's feed (a week resolved) and its clan card (the
 *  race running) draw the same bar. */
export function RacePlace({ rank }) {
  if (!Number.isInteger(rank) || rank < 1 || rank > 5) return null;
  const place = ["First", "Second", "Third", "Fourth", "Fifth"][rank - 1];
  return (
    // A span drawn as a block, so a row's detail line can hold it.
    <span
      className={`kit-racebar kit-racebar--p${rank}`}
      role="img"
      aria-label={`${place} of five clans`}
    >
      <i />
    </span>
  );
}
