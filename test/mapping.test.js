import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateMapping,
  coerceValue,
  normalizeAirtable,
  normalizeSupabase,
  fieldsEqual,
  toAirtableFields,
} from '../src/mapping.js';

const mapping = {
  airtable: { table: 'Leads', modifiedField: 'Last Modified', linkField: 'supabase_id' },
  supabase: { table: 'leads', linkColumn: 'airtable_id', modifiedColumn: 'updated_at' },
  fields: [
    { airtable: 'Name', supabase: 'name', type: 'string' },
    { airtable: 'Amount', supabase: 'amount', type: 'number' },
    { airtable: 'Status', supabase: 'status', type: 'enum' },
  ],
  direction: 'two-way',
};

test('validateMapping accepts a good mapping, rejects a broken one', () => {
  assert.doesNotThrow(() => validateMapping(mapping));
  assert.throws(() => validateMapping({}), /airtable\.table is required/);
  assert.throws(() => validateMapping({ ...mapping, direction: 'sideways' }), /invalid direction/);
});

test('coerceValue handles types and empties', () => {
  assert.equal(coerceValue('', 'string'), null);
  assert.equal(coerceValue(undefined, 'number'), null);
  assert.equal(coerceValue('42', 'number'), 42);
  assert.equal(coerceValue(3.5, 'number'), 3.5);
  assert.equal(coerceValue('active', 'enum'), 'active');
  assert.throws(() => coerceValue('abc', 'number'), /not a number/);
});

test('normalizeAirtable maps fields, ids and modified time', () => {
  const rec = normalizeAirtable(
    {
      id: 'recABC',
      fields: {
        Name: 'Acme',
        Amount: '1500',
        Status: 'new',
        supabase_id: '11',
        'Last Modified': '2026-08-20T10:00:00.000Z',
      },
    },
    mapping,
  );
  assert.equal(rec.airtableId, 'recABC');
  assert.equal(rec.supabaseId, '11');
  assert.deepEqual(rec.fields, { name: 'Acme', amount: 1500, status: 'new' });
  assert.equal(rec.modifiedAt, '2026-08-20T10:00:00.000Z');
});

test('normalizeSupabase maps row, ids and updated_at', () => {
  const rec = normalizeSupabase(
    { id: 11, airtable_id: 'recABC', name: 'Acme', amount: 1500, status: 'new', updated_at: '2026-08-20T09:00:00Z' },
    mapping,
  );
  assert.equal(rec.supabaseId, '11');
  assert.equal(rec.airtableId, 'recABC');
  assert.deepEqual(rec.fields, { name: 'Acme', amount: 1500, status: 'new' });
  assert.equal(rec.modifiedAt, '2026-08-20T09:00:00.000Z');
});

test('fieldsEqual is true for the same canonical data from both sides', () => {
  const a = normalizeAirtable(
    { id: 'r', fields: { Name: 'Acme', Amount: '1500', Status: 'new' } },
    mapping,
  );
  const s = normalizeSupabase({ id: 1, name: 'Acme', amount: 1500, status: 'new' }, mapping);
  assert.equal(fieldsEqual(a, s, mapping), true);
});

test('fieldsEqual is false when a field differs', () => {
  const a = normalizeAirtable({ id: 'r', fields: { Name: 'Acme', Amount: '1' } }, mapping);
  const s = normalizeSupabase({ id: 1, name: 'Acme', amount: 2 }, mapping);
  assert.equal(fieldsEqual(a, s, mapping), false);
});

test('toAirtableFields translates canonical keys back to Airtable names', () => {
  const out = toAirtableFields({ name: 'Acme', amount: 1500, status: 'new' }, mapping);
  assert.deepEqual(out, { Name: 'Acme', Amount: 1500, Status: 'new' });
});
