/**
 * The release key's fingerprint as SSH randomart: the picture
 * `ssh-keygen -lv` prints, computed here from the published key line
 * (packages/contracts), never pasted. OpenSSH's "drunken bishop"
 * (sshkey_fingerprint_randomart in sshkey.c): a bishop starts in the
 * middle of a 17 x 9 board and, for each byte of the SHA-256 digest,
 * takes four diagonal steps, two bits a step, low bits first, counting
 * its visits. A test holds the output to ssh-keygen's, character for
 * character.
 */

const RANDOMART_WIDTH = 17;
const RANDOMART_HEIGHT = 9;
const SYMBOLS = " .o+=*BOX@%&#/^SE";
const START = SYMBOLS.length - 2; // "S"
const END = SYMBOLS.length - 1; // "E"

/** The SHA-256 digest of an OpenSSH public key line's blob. */
export async function keyDigest(line) {
  const blob = Uint8Array.from(atob(line.trim().split(/\s+/)[1]), (c) =>
    c.charCodeAt(0),
  );
  return new Uint8Array(await crypto.subtle.digest("SHA-256", blob));
}

/** OpenSSH's fingerprint spelling: SHA256: and unpadded base64. */
export function fingerprintOf(digest) {
  return `SHA256:${btoa(String.fromCharCode(...digest)).replace(/=+$/, "")}`;
}

/** The board: `grid[y][x]` is an index into the symbols, 0 (never
 *  visited) to 14 (visited 14 or more times), 15 the start, 16 the end. */
export function randomartGrid(digest) {
  const grid = Array.from({ length: RANDOMART_HEIGHT }, () =>
    new Array(RANDOMART_WIDTH).fill(0),
  );
  let x = RANDOMART_WIDTH >> 1;
  let y = RANDOMART_HEIGHT >> 1;
  for (const byte of digest) {
    let input = byte;
    for (let i = 0; i < 4; i += 1) {
      x += input & 1 ? 1 : -1;
      y += input & 2 ? 1 : -1;
      x = Math.min(Math.max(x, 0), RANDOMART_WIDTH - 1);
      y = Math.min(Math.max(y, 0), RANDOMART_HEIGHT - 1);
      if (grid[y][x] < START - 1) grid[y][x] += 1;
      input >>= 2;
    }
  }
  grid[RANDOMART_HEIGHT >> 1][RANDOMART_WIDTH >> 1] = START;
  grid[y][x] = END;
  return grid;
}

export const randomartSymbol = (level) => SYMBOLS[level];

/** A border line with its label centred the way ssh-keygen centres it. */
function border(label) {
  const left = Math.floor((RANDOMART_WIDTH - label.length) / 2);
  return `+${"-".repeat(left)}${label}${"-".repeat(RANDOMART_WIDTH - left - label.length)}+`;
}

/** The whole picture as text, exactly as `ssh-keygen -lv` prints it. */
export function randomartText(digest, { title = "[ED25519 256]" } = {}) {
  return [
    border(title),
    ...randomartGrid(digest).map(
      (row) => `|${row.map(randomartSymbol).join("")}|`,
    ),
    border("[SHA256]"),
  ].join("\n");
}
