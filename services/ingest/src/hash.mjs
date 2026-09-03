/**
 * Canonical payload hashing — one notion of payload identity everywhere
 * (elixir-bot's payload_hash pattern): sha256 of JSON with sorted keys and
 * no whitespace.
 */

import { createHash } from 'node:crypto';

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function payloadHash(payload) {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}
