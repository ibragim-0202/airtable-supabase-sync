/**
 * The mapping config (config/mapping.json) is the single source of truth for how
 * Airtable fields correspond to Supabase columns. Everything here is pure: it
 * turns raw records from either side into one canonical shape keyed by the
 * Supabase column names:
 *
 *   { airtableId, supabaseId, fields: { <supabaseCol>: value }, modifiedAt }
 */

/** Validate the mapping structure; throw early with a clear message if broken. */
export function validateMapping(m) {
  const problems = [];
  if (!m || typeof m !== 'object') problems.push('mapping is not an object');
  if (!m?.airtable?.table) problems.push('airtable.table is required');
  if (!m?.airtable?.modifiedField) problems.push('airtable.modifiedField is required');
  if (!m?.supabase?.table) problems.push('supabase.table is required');
  if (!m?.supabase?.modifiedColumn) problems.push('supabase.modifiedColumn is required');
  if (!Array.isArray(m?.fields) || m.fields.length === 0) problems.push('fields[] is required');
  for (const [i, f] of (m?.fields || []).entries()) {
    if (!f.airtable || !f.supabase) problems.push(`fields[${i}] needs airtable+supabase names`);
  }
  const dir = m?.direction || 'two-way';
  if (!['two-way', 'airtable-to-supabase', 'supabase-to-airtable'].includes(dir)) {
    problems.push(`invalid direction: ${dir}`);
  }
  if (problems.length) throw new Error(`Invalid mapping: ${problems.join('; ')}`);
  return m;
}

/** Coerce a raw value to the mapping-declared type. Throws on an invalid number. */
export function coerceValue(value, type) {
  if (value === null || value === undefined || value === '') return null;
  switch (type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (Number.isNaN(n)) throw new Error(`not a number: ${JSON.stringify(value)}`);
      return n;
    }
    case 'boolean':
      return Boolean(value);
    case 'enum':
    case 'string':
    default:
      return String(value);
  }
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Normalize one Airtable record (`{ id, fields }`) into canonical form. */
export function normalizeAirtable(record, mapping) {
  const raw = record.fields || {};
  const fields = {};
  for (const f of mapping.fields) {
    fields[f.supabase] = coerceValue(raw[f.airtable], f.type);
  }
  return {
    airtableId: record.id || null,
    supabaseId: raw[mapping.airtable.linkField] || null,
    fields,
    modifiedAt: toIso(raw[mapping.airtable.modifiedField]),
  };
}

/** Normalize one Supabase row into canonical form. */
export function normalizeSupabase(row, mapping) {
  const fields = {};
  for (const f of mapping.fields) {
    fields[f.supabase] = coerceValue(row[f.supabase], f.type);
  }
  return {
    airtableId: row[mapping.supabase.linkColumn] || null,
    supabaseId: row.id != null ? String(row.id) : null,
    fields,
    modifiedAt: toIso(row[mapping.supabase.modifiedColumn]),
  };
}

/** Deep-equal the mapped fields of two canonical records (order-independent). */
export function fieldsEqual(a, b, mapping) {
  for (const f of mapping.fields) {
    if ((a.fields[f.supabase] ?? null) !== (b.fields[f.supabase] ?? null)) return false;
  }
  return true;
}

/** Translate canonical fields back to Airtable field names (for writes). */
export function toAirtableFields(fields, mapping) {
  const out = {};
  for (const f of mapping.fields) out[f.airtable] = fields[f.supabase] ?? null;
  return out;
}
