import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAlert } from '../src/telegram.js';

test('formatAlert summarizes errors and counts', () => {
  const errors = [
    { type: 'update_supabase', key: 'recA', message: 'boom' },
    { type: 'normalize_airtable', key: 'recB', message: 'not a number' },
  ];
  const text = formatAlert(errors, { noop: 3, conflict: 1 });
  assert.match(text, /2 error\(s\)/);
  assert.match(text, /noop=3 conflict=1/);
  assert.match(text, /\[update_supabase\] recA: boom/);
});

test('formatAlert truncates a long list', () => {
  const errors = Array.from({ length: 25 }, (_, i) => ({ type: 't', key: `k${i}`, message: 'm' }));
  const text = formatAlert(errors, {}, { max: 20 });
  assert.match(text, /…and 5 more/);
});
