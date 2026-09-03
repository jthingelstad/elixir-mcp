import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTag,
  isCanonicalTag,
  InvalidTagError,
} from '../dist/index.js';

test('accepts canonical input unchanged', () => {
  assert.equal(normalizeTag('#2PP0V90Y'), '#2PP0V90Y');
});

test('adds missing hash prefix', () => {
  assert.equal(normalizeTag('2PP0V90Y'), '#2PP0V90Y');
});

test('uppercases and folds letter O to zero', () => {
  assert.equal(normalizeTag('#2ppOv9Oy'), '#2PP0V90Y');
});

test('trims surrounding whitespace', () => {
  assert.equal(normalizeTag('  #2PP0V90Y '), '#2PP0V90Y');
});

test('rejects characters outside the CR alphabet', () => {
  for (const bad of ['#2PP1V90Y', '#ABC!23', '#WXYZ0000', "#2PP0'--", '#2PP 0V9']) {
    assert.throws(() => normalizeTag(bad), InvalidTagError);
  }
});

test('rejects too-short and too-long tags', () => {
  assert.throws(() => normalizeTag('#22'), InvalidTagError);
  assert.throws(() => normalizeTag('#' + '2'.repeat(13)), InvalidTagError);
});

test('InvalidTagError carries the structured code', () => {
  try {
    normalizeTag('bogus!');
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.code, 'invalid_tag');
  }
});

test('isCanonicalTag is strict — no folding', () => {
  assert.equal(isCanonicalTag('#2PP0V90Y'), true);
  assert.equal(isCanonicalTag('2PP0V90Y'), false);
  assert.equal(isCanonicalTag('#2ppov90y'), false);
});
