import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  responseMeta,
  DISCLAIMER,
  CONTRACT_VERSION,
  ERROR_CODES,
  toolError,
} from '../dist/index.js';

test('every response meta carries disclaimer and contract version', () => {
  const meta = responseMeta({ as_of: '2026-09-03T12:00:00Z' });
  assert.equal(meta.disclaimer, DISCLAIMER);
  assert.equal(meta.contract_version, CONTRACT_VERSION);
  assert.ok(DISCLAIMER.includes('not endorsed by Supercell'));
});

test('error taxonomy is closed and stable', () => {
  assert.deepEqual(
    [...ERROR_CODES].sort(),
    [
      'bad_request',
      'invalid_tag',
      'live_unavailable',
      'not_entitled',
      'not_found',
      'not_recorded',
      'quota_exceeded',
    ],
  );
});

test('toolError omits hint cleanly when absent', () => {
  assert.deepEqual(toolError('not_recorded', 'no recording for #ABC'), {
    code: 'not_recorded',
    message: 'no recording for #ABC',
  });
});
