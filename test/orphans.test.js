import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectOrphans } from '../src/orphans.js';

function state(entries) {
  const m = new Map();
  for (const row of entries) m.set(`air:${row.airtable_id}`, { row });
  return m;
}

test('flags a record deleted on the Airtable side', () => {
  const syncState = state([{ airtable_id: 'recA', supabase_id: '1', status: 'active' }]);
  const orphans = detectOrphans(syncState, [], [{ supabaseId: '1' }]);
  assert.equal(orphans.length, 1);
  assert.deepEqual(orphans[0].missing, ['airtable']);
});

test('flags a record deleted on the Supabase side', () => {
  const syncState = state([{ airtable_id: 'recA', supabase_id: '1', status: 'active' }]);
  const orphans = detectOrphans(syncState, [{ airtableId: 'recA' }], []);
  assert.deepEqual(orphans[0].missing, ['supabase']);
});

test('no orphan when both sides still present', () => {
  const syncState = state([{ airtable_id: 'recA', supabase_id: '1', status: 'active' }]);
  const orphans = detectOrphans(syncState, [{ airtableId: 'recA' }], [{ supabaseId: '1' }]);
  assert.deepEqual(orphans, []);
});

test('already-flagged orphans are not re-reported', () => {
  const syncState = state([{ airtable_id: 'recA', supabase_id: '1', status: 'orphan' }]);
  const orphans = detectOrphans(syncState, [], []);
  assert.deepEqual(orphans, []);
});
