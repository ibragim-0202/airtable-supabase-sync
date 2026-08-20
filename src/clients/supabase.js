import { createClient } from '@supabase/supabase-js';

/**
 * Thin Supabase (Postgres) client over the official SDK. Encapsulates the two
 * tables the sync touches: the data table (from mapping) and `sync_state`.
 */
export function createSupabaseClient({ url, key, mapping }) {
  const db = createClient(url, key, { auth: { persistSession: false } });
  const table = mapping.supabase.table;
  const linkCol = mapping.supabase.linkColumn;

  return {
    async listRows() {
      const { data, error } = await db.from(table).select('*');
      if (error) throw new Error(`Supabase list ${table}: ${error.message}`);
      return data || [];
    },

    /** Upsert a data row keyed by the Airtable link column; returns its id. */
    async upsertByAirtableId(airtableId, fields) {
      const row = { ...fields, [linkCol]: airtableId, synced_at: new Date().toISOString() };
      const { data, error } = await db
        .from(table)
        .upsert(row, { onConflict: linkCol })
        .select('id')
        .single();
      if (error) throw new Error(`Supabase upsert ${table}: ${error.message}`);
      return data.id;
    },

    async loadSyncState() {
      const { data, error } = await db.from('sync_state').select('*');
      if (error) throw new Error(`Supabase list sync_state: ${error.message}`);
      const map = new Map();
      for (const r of data || []) {
        const key = r.airtable_id ? `air:${r.airtable_id}` : `sup:${r.supabase_id}`;
        map.set(key, { lastSourceModifiedAt: r.last_source_modified_at, row: r });
      }
      return map;
    },

    async upsertSyncState(entry) {
      const { error } = await db.from('sync_state').upsert(entry, { onConflict: 'airtable_id' });
      if (error) throw new Error(`Supabase upsert sync_state: ${error.message}`);
    },
  };
}
