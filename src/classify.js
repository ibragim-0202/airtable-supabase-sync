import { fieldsEqual } from './mapping.js';

/**
 * Pair canonical records from both sides into { airtable, supabase } tuples
 * (either side may be null). Matching prefers the explicit link ids stored on
 * each record: airtable.supabaseId ↔ supabase.supabaseId, or the reverse link
 * supabase.airtableId ↔ airtable.airtableId.
 */
export function pairRecords(airtableRecs, supabaseRecs) {
  const sBySupaId = new Map();
  const sByAirId = new Map();
  for (const s of supabaseRecs) {
    if (s.supabaseId) sBySupaId.set(s.supabaseId, s);
    if (s.airtableId) sByAirId.set(s.airtableId, s);
  }

  const pairs = [];
  const usedSupabase = new Set();

  for (const a of airtableRecs) {
    let match = null;
    if (a.supabaseId && sBySupaId.has(a.supabaseId)) match = sBySupaId.get(a.supabaseId);
    else if (a.airtableId && sByAirId.has(a.airtableId)) match = sByAirId.get(a.airtableId);

    if (match) usedSupabase.add(match.supabaseId ?? match.airtableId);
    pairs.push({ airtable: a, supabase: match || null });
  }

  for (const s of supabaseRecs) {
    if (usedSupabase.has(s.supabaseId ?? s.airtableId)) continue;
    pairs.push({ airtable: null, supabase: s });
  }
  return pairs;
}

function allowsA2S(direction) {
  return direction !== 'supabase-to-airtable';
}
function allowsS2A(direction) {
  return direction !== 'airtable-to-supabase';
}

/**
 * Turn paired records into decisions. Pure. Conflict resolution (which side
 * wins) is deferred to the LWW layer — here a differing pair is just flagged
 * `conflict`. Direction gates one-sided creates.
 *
 * Decision.type ∈ create_supabase | create_airtable | conflict | noop | skip
 */
export function classify(airtableRecs, supabaseRecs, mapping, { direction = 'two-way' } = {}) {
  const pairs = pairRecords(airtableRecs, supabaseRecs);
  return pairs.map(({ airtable, supabase }) => {
    if (airtable && supabase) {
      if (fieldsEqual(airtable, supabase, mapping)) return { type: 'noop', airtable, supabase };
      return { type: 'conflict', airtable, supabase };
    }
    if (airtable && !supabase) {
      return allowsA2S(direction)
        ? { type: 'create_supabase', airtable, supabase: null }
        : { type: 'skip', airtable, supabase: null, reason: 'direction' };
    }
    return allowsS2A(direction)
      ? { type: 'create_airtable', airtable: null, supabase }
      : { type: 'skip', airtable: null, supabase, reason: 'direction' };
  });
}

/** Small tally of decision types, handy for the run summary. */
export function summarizeDecisions(decisions) {
  const counts = {};
  for (const d of decisions) counts[d.type] = (counts[d.type] || 0) + 1;
  return counts;
}
