import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairRecords, classify, summarizeDecisions } from '../src/classify.js';

const mapping = {
  fields: [
    { airtable: 'Name', supabase: 'name', type: 'string' },
    { airtable: 'Amount', supabase: 'amount', type: 'number' },
  ],
};

// canonical record helpers
const air = (airtableId, supabaseId, fields, modifiedAt) => ({ airtableId, supabaseId, fields, modifiedAt });
const sup = (supabaseId, airtableId, fields, modifiedAt) => ({ airtableId, supabaseId, fields, modifiedAt });

test('pairRecords matches via supabaseId link', () => {
  const a = [air('recA', '1', { name: 'X', amount: 1 })];
  const s = [sup('1', 'recA', { name: 'X', amount: 1 })];
  const pairs = pairRecords(a, s);
  assert.equal(pairs.length, 1);
  assert.ok(pairs[0].airtable && pairs[0].supabase);
});

test('classify: only-airtable -> create_supabase', () => {
  const d = classify([air('recA', null, { name: 'X', amount: 1 })], [], mapping, {});
  assert.equal(d[0].type, 'create_supabase');
});

test('classify: only-supabase -> create_airtable', () => {
  const d = classify([], [sup('1', null, { name: 'X', amount: 1 })], mapping, {});
  assert.equal(d[0].type, 'create_airtable');
});

test('classify: identical pair -> noop', () => {
  const d = classify(
    [air('recA', '1', { name: 'X', amount: 1 })],
    [sup('1', 'recA', { name: 'X', amount: 1 })],
    mapping,
    {},
  );
  assert.equal(d[0].type, 'noop');
});

test('classify: differing pair -> conflict', () => {
  const d = classify(
    [air('recA', '1', { name: 'X', amount: 2 })],
    [sup('1', 'recA', { name: 'X', amount: 1 })],
    mapping,
    {},
  );
  assert.equal(d[0].type, 'conflict');
});

test('classify respects one-way direction (airtable-to-supabase)', () => {
  // A supabase-only record should NOT flow back when direction is a2s only.
  const d = classify([], [sup('1', null, { name: 'X', amount: 1 })], mapping, {
    direction: 'airtable-to-supabase',
  });
  assert.equal(d[0].type, 'skip');
  assert.equal(d[0].reason, 'direction');
});

test('summarizeDecisions tallies types', () => {
  const decisions = [
    { type: 'noop' },
    { type: 'noop' },
    { type: 'conflict' },
    { type: 'create_supabase' },
  ];
  assert.deepEqual(summarizeDecisions(decisions), {
    noop: 2,
    conflict: 1,
    create_supabase: 1,
  });
});
