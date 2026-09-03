/**
 * CR compact battleTime ("20260903T081553.000Z") -> canonical form.
 *
 * The canonical string is `YYYY-MM-DDTHH:MM:SSZ` (millis dropped; CR always
 * sends .000). The battle dedup key is derived from THIS canonical string —
 * the same value that is stored — so key and column can never disagree
 * (elixir-bot's v25 incident: a format change silently minted 1,348
 * duplicate battles). Changing this function is a battle-identity migration.
 */

const CR_TIME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.(\d{3})Z$/;

export function canonicalBattleTime(crTime) {
  const m = CR_TIME_RE.exec(crTime);
  if (!m) throw new Error(`unrecognized CR battleTime: ${JSON.stringify(crTime)}`);
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}
