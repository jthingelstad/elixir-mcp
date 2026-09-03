/**
 * CR tag normalization — DESIGN §4.1 identity discipline.
 *
 * Clash Royale tags are the only identifiers for game entities. This is the
 * one normalizer, applied at every boundary: ingest admission, tool inputs,
 * claim entry, URLs. Canonical stored form: uppercase, '#'-prefixed, 'O'
 * folded to '0' (the CR alphabet has no letter O; it only appears as a
 * human typo).
 */

export const CR_TAG_ALPHABET = '0289PYLQGRJCUV';

const CANONICAL_RE = new RegExp(`^#[${CR_TAG_ALPHABET}]{3,12}$`);

export class InvalidTagError extends Error {
  readonly code = 'invalid_tag' as const;
  constructor(readonly input: string) {
    super(`not a valid Clash Royale tag: ${JSON.stringify(input)}`);
    this.name = 'InvalidTagError';
  }
}

/** A tag in canonical form. Produced only by normalizeTag. */
export type CanonicalTag = string & { readonly __brand: 'CanonicalTag' };

/**
 * Normalize a player or clan tag to canonical form, or throw InvalidTagError.
 * Accepts common user input shapes: missing '#', lowercase, letter O, and
 * surrounding whitespace. Rejects anything outside the CR alphabet after
 * folding — a malformed tag must never reach a query or the CR API.
 */
export function normalizeTag(input: string): CanonicalTag {
  const folded = input.trim().toUpperCase().replaceAll('O', '0');
  const tag = folded.startsWith('#') ? folded : `#${folded}`;
  if (!CANONICAL_RE.test(tag)) throw new InvalidTagError(input);
  return tag as CanonicalTag;
}

/** True if the input is already in canonical form (no folding applied). */
export function isCanonicalTag(input: string): input is CanonicalTag {
  return CANONICAL_RE.test(input);
}
