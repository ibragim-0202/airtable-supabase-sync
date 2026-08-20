import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDecisions } from '../src/apply.js';

const mapping = {
  airtable: { linkField: 'supabase_id' },
  supabase: { table: 'leads', linkColumn: 'airtable_id' },
  fields: [{ airtable: 'Name', supabase: 'name', type: 'string' }],
};

function fakes() {
  const calls = [];
  const airtable = {
    async createRecord(fields) {
      calls.push(['air.create', fields]);
      return 'recNEW';
    },
    async updateRecord(id, fields) {
      calls.push(['air.update', id, fields]);
    },
  };
  const supabase = {
    async upsertByAirtableId(airtableId, fields) {
      calls.push(['sup.upsert', airtableId, fields]);
      return 99;
    },
    async upsertSyncState(entry) {
      calls.push(['sup.state', entry.last_direction]);
    },
  };
  return { calls, airtable, supabase };
}

test('update_supabase upserts and journals a2s', async () => {
  const { calls, airtable, supabase } = fakes();
  const d = {
    type: 'update_supabase',
    winner: { airtableId: 'recA', supabaseId: '1', fields: { name: 'X' }, modifiedAt: 't' },
  };
  const res = await applyDecisions([d], { airtable, supabase, mapping });
  assert.deepEqual(res.errors, []);
  assert.ok(calls.some((c) => c[0] === 'sup.upsert'));
  assert.ok(calls.some((c) => c[0] === 'sup.state' && c[1] === 'a2s'));
});

test('create_supabase without back-link writes it back to Airtable', async () => {
  const { calls, airtable, supabase } = fakes();
  const d = {
    type: 'create_supabase',
    winner: { airtableId: 'recA', supabaseId: null, fields: { name: 'X' }, modifiedAt: 't' },
  };
  await applyDecisions([d], { airtable, supabase, mapping });
  assert.ok(calls.some((c) => c[0] === 'air.update' && c[2].supabase_id === '99'));
});

test('create_airtable creates record and back-links onto Supabase', async () => {
  const { calls, airtable, supabase } = fakes();
  const d = {
    type: 'create_airtable',
    winner: { airtableId: null, supabaseId: '5', fields: { name: 'X' }, modifiedAt: 't' },
  };
  await applyDecisions([d], { airtable, supabase, mapping });
  assert.ok(calls.some((c) => c[0] === 'air.create'));
  assert.ok(calls.some((c) => c[0] === 'sup.upsert' && c[1] === 'recNEW'));
  assert.ok(calls.some((c) => c[0] === 'sup.state' && c[1] === 's2a'));
});

test('a failing record is collected, others still apply', async () => {
  const { airtable, supabase } = fakes();
  supabase.upsertByAirtableId = async () => {
    throw new Error('boom');
  };
  const good = {
    type: 'create_airtable',
    winner: { airtableId: 'recX', supabaseId: '5', fields: { name: 'ok' }, modifiedAt: 't' },
  };
  const bad = {
    type: 'update_supabase',
    winner: { airtableId: 'recB', supabaseId: '2', fields: { name: 'X' }, modifiedAt: 't' },
  };
  const res = await applyDecisions([bad, good], { airtable, supabase, mapping, logger: { warn() {} } });
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].key, 'recB');
  assert.equal(res.applied.length, 1); // the good one still went through
});

test('noop/skip and dryRun do not touch clients', async () => {
  const { calls, airtable, supabase } = fakes();
  const res = await applyDecisions(
    [{ type: 'noop' }, { type: 'skip' }, { type: 'update_supabase', winner: { airtableId: 'r', fields: {} } }],
    { airtable, supabase, mapping, dryRun: true },
  );
  assert.equal(calls.length, 0);
  assert.equal(res.applied.length, 1);
  assert.equal(res.applied[0].dryRun, true);
});
