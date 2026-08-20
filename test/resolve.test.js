import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareModified,
  resolveConflict,
  isEcho,
  resolveDecisions,
} from '../src/resolve.js';

const air = (fields, modifiedAt, ids = {}) => ({
  airtableId: ids.airtableId ?? 'recA',
  supabaseId: ids.supabaseId ?? '1',
  fields,
  modifiedAt,
});
const sup = (fields, modifiedAt, ids = {}) => ({
  airtableId: ids.airtableId ?? 'recA',
  supabaseId: ids.supabaseId ?? '1',
  fields,
  modifiedAt,
});

test('compareModified respects skew and missing timestamps', () => {
  assert.equal(compareModified('2026-01-01T00:00:02Z', '2026-01-01T00:00:00Z', 0), 1);
  assert.equal(compareModified('2026-01-01T00:00:00Z', '2026-01-01T00:00:02Z', 0), -1);
  assert.equal(compareModified('2026-01-01T00:00:00.500Z', '2026-01-01T00:00:00Z', 1000), 0);
  assert.equal(compareModified(null, '2026-01-01T00:00:00Z'), -1);
  assert.equal(compareModified(null, null), 0);
});

test('resolveConflict: newer Airtable wins -> update_supabase', () => {
  const a = air({ amount: 2 }, '2026-08-20T10:00:00Z');
  const s = sup({ amount: 1 }, '2026-08-20T09:00:00Z');
  const r = resolveConflict(a, s, {});
  assert.equal(r.type, 'update_supabase');
  assert.equal(r.winner, a);
  assert.equal(r.loser, s);
});

test('resolveConflict: newer Supabase wins -> update_airtable', () => {
  const a = air({ amount: 2 }, '2026-08-20T09:00:00Z');
  const s = sup({ amount: 1 }, '2026-08-20T10:00:00Z');
  const r = resolveConflict(a, s, {});
  assert.equal(r.type, 'update_airtable');
  assert.equal(r.winner, s);
});

test('resolveConflict: tie within skew -> airtable wins, flagged', () => {
  const a = air({ amount: 2 }, '2026-08-20T10:00:00.200Z');
  const s = sup({ amount: 1 }, '2026-08-20T10:00:00.000Z');
  const r = resolveConflict(a, s, { clockSkewMs: 1000 });
  assert.equal(r.type, 'update_supabase');
  assert.equal(r.tie, true);
});

test('isEcho: same-or-older source version is an echo', () => {
  const entry = { lastSourceModifiedAt: '2026-08-20T10:00:00Z' };
  assert.equal(isEcho('2026-08-20T10:00:00Z', entry), true); // already synced
  assert.equal(isEcho('2026-08-20T09:59:59Z', entry), true); // older
  assert.equal(isEcho('2026-08-20T10:00:01Z', entry), false); // newer -> apply
  assert.equal(isEcho('2026-08-20T10:00:01Z', undefined), false); // never synced
});

test('resolveDecisions suppresses an echo into a noop', () => {
  const conflict = {
    type: 'conflict',
    airtable: air({ amount: 2 }, '2026-08-20T10:00:00Z'),
    supabase: sup({ amount: 1 }, '2026-08-20T09:00:00Z'),
  };
  // sync_state says we already propagated the 10:00 Airtable version.
  const state = new Map([['air:recA', { lastSourceModifiedAt: '2026-08-20T10:00:00Z' }]]);
  const [d] = resolveDecisions([conflict], state, {});
  assert.equal(d.type, 'noop');
  assert.equal(d.reason, 'echo');
});

test('resolveDecisions applies a genuinely newer conflict', () => {
  const conflict = {
    type: 'conflict',
    airtable: air({ amount: 2 }, '2026-08-20T11:00:00Z'),
    supabase: sup({ amount: 1 }, '2026-08-20T09:00:00Z'),
  };
  const state = new Map([['air:recA', { lastSourceModifiedAt: '2026-08-20T10:00:00Z' }]]);
  const [d] = resolveDecisions([conflict], state, {});
  assert.equal(d.type, 'update_supabase');
});

test('resolveDecisions passes noop/skip through untouched', () => {
  const out = resolveDecisions([{ type: 'noop' }, { type: 'skip', reason: 'direction' }], new Map(), {});
  assert.deepEqual(out.map((d) => d.type), ['noop', 'skip']);
});
