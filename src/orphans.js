/**
 * Detect orphans: records that were synced before (present in sync_state) but
 * have since disappeared from one side. Deletion is irreversible, so the MVP
 * never auto-deletes the mirror — it flags the record `orphan` and lets the
 * alert surface it for a human decision. Pure.
 *
 * @param {Map} syncState  Map(pairKey -> { row }) as returned by loadSyncState
 * @param {Array} airRecs  canonical Airtable records still present
 * @param {Array} supRecs  canonical Supabase records still present
 * @returns {Array} orphans: { airtable_id, supabase_id, missing: string[] }
 */
export function detectOrphans(syncState, airRecs, supRecs) {
  const airPresent = new Set(airRecs.map((r) => r.airtableId).filter(Boolean));
  const supPresent = new Set(supRecs.map((r) => r.supabaseId).filter(Boolean));

  const orphans = [];
  for (const { row } of syncState.values()) {
    if (!row || row.status === 'orphan') continue; // already flagged
    const missing = [];
    if (row.airtable_id && !airPresent.has(row.airtable_id)) missing.push('airtable');
    if (row.supabase_id && !supPresent.has(String(row.supabase_id))) missing.push('supabase');
    if (missing.length) {
      orphans.push({ airtable_id: row.airtable_id, supabase_id: row.supabase_id, missing });
    }
  }
  return orphans;
}
