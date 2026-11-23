/** What a person types to delete their own account (2026-11-23,
 *  Jamie: "you should have to type the name of your primary player or
 *  your Elixir username"): their @handle (the @ optional) or their main
 *  player's game name. With neither (no handle, no main player, or a
 *  player whose name is not recorded yet) it is the word DELETE.
 *
 *  Matching ignores case, surrounding spaces and Unicode width forms
 *  (NFKC), so a phone keyboard's capital first letter or a pasted name
 *  still matches. Settings › Profile and POST /api/me/account/delete
 *  read this one rule. */
export interface DeleteConfirmTargets {
  handle?: string | null;
  playerName?: string | null;
}

const fold = (s: string): string =>
  s.normalize("NFKC").trim().toLocaleLowerCase("en-US");

/** The words that confirm, in the order the page names them. */
export function deleteConfirmWords({
  handle = null,
  playerName = null,
}: DeleteConfirmTargets): string[] {
  const words: string[] = [];
  if (playerName && fold(playerName)) words.push(playerName.trim());
  if (handle && fold(handle)) words.push(`@${handle.replace(/^@/, "")}`);
  return words.length ? words : ["DELETE"];
}

export function deleteConfirmMatches(
  typed: unknown,
  targets: DeleteConfirmTargets,
): boolean {
  if (typeof typed !== "string") return false;
  const t = fold(typed);
  if (!t) return false;
  return deleteConfirmWords(targets).some((w) => {
    const word = fold(w);
    return word === t || (word.startsWith("@") && word.slice(1) === t);
  });
}
