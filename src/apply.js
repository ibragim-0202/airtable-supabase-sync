import { toAirtableFields } from './mapping.js';

/**
 * Apply resolved decisions to both sides. Clients are injected so this
 * orchestration is unit-testable with fakes. Each decision is applied inside
 * its own try/catch: one failing record is collected as an error and the run
 * continues — a partial API failure never aborts the whole sync, and nothing
 * fails silently (errors are returned for the alerting layer).
 */
export async function applyDecisions(decisions, { airtable, supabase, mapping, dryRun = false, logger = console }) {
  const applied = [];
  const errors = [];

  for (const d of decisions) {
    if (d.type === 'noop' || d.type === 'skip') continue;
    try {
      if (dryRun) {
        applied.push({ type: d.type, dryRun: true });
        continue;
      }
      if (d.type === 'create_supabase' || d.type === 'update_supabase') {
        await pushToSupabase(d, { airtable, supabase, mapping });
      } else if (d.type === 'create_airtable' || d.type === 'update_airtable') {
        await pushToAirtable(d, { airtable, supabase, mapping });
      }
      applied.push({ type: d.type });
    } catch (err) {
      const key =
        d.airtable?.airtableId ||
        d.winner?.airtableId ||
        d.supabase?.supabaseId ||
        d.winner?.supabaseId ||
        '(unknown)';
      logger.warn?.(`apply ${d.type} for ${key} failed: ${err.message}`);
      errors.push({ type: d.type, key, message: err.message });
    }
  }

  return { applied, errors };
}

/** Airtable -> Supabase: upsert data row, back-link, journal sync_state. */
async function pushToSupabase(d, { airtable, supabase, mapping }) {
  const winner = d.winner; // canonical airtable record
  const airtableId = winner.airtableId;
  const supabaseId = await supabase.upsertByAirtableId(airtableId, winner.fields);

  // If the Airtable record didn't yet carry the back-link, write it once.
  if (!winner.supabaseId) {
    await airtable.updateRecord(airtableId, { [mapping.airtable.linkField]: String(supabaseId) });
  }
  await supabase.upsertSyncState(journal(airtableId, supabaseId, 'a2s', winner.modifiedAt));
}

/** Supabase -> Airtable: create/update record, back-link, journal sync_state. */
async function pushToAirtable(d, { airtable, supabase, mapping }) {
  const winner = d.winner; // canonical supabase record
  const airtableFields = toAirtableFields(winner.fields, mapping);
  let airtableId = winner.airtableId;

  if (!airtableId) {
    airtableId = await airtable.createRecord(airtableFields);
    // Back-link the new Airtable id onto the Supabase row.
    await supabase.upsertByAirtableId(airtableId, winner.fields);
  } else {
    await airtable.updateRecord(airtableId, airtableFields);
  }
  await supabase.upsertSyncState(journal(airtableId, winner.supabaseId, 's2a', winner.modifiedAt));
}

function journal(airtableId, supabaseId, direction, sourceModifiedAt) {
  return {
    airtable_id: airtableId,
    supabase_id: supabaseId != null ? String(supabaseId) : null,
    last_direction: direction,
    last_source_modified_at: sourceModifiedAt,
    last_synced_at: new Date().toISOString(),
    status: 'active',
  };
}
