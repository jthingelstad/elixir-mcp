/**
 * The noun a count takes: "1 day", "2 days", "0 days" (2026-10-08). The
 * pages wrote `${n} days` and read "1 days with recorded battles" and
 * "1 members". The number stays the caller's, formatted as that page
 * formats numbers; this picks only the word.
 */
export function noun(n: number, one: string, many: string = `${one}s`) {
  return n === 1 ? one : many;
}
