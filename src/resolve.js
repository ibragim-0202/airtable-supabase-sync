/**
 * Conflict resolution (last-write-wins) and the second idempotency layer.
 *
 * Layer 1 (elsewhere): upserts keyed by link id — reruns never create dupes.
 * Layer 2 (here): a change is applied only if the winning source is genuinely
 * newer than what we last propagated for that record. Combined with field
 * equality in `classify`, this stops the two-way ping-pong: a value pushed
 * A→B does not bounce back B→A.
 */

/** Stable key for a logical record, used to look up its sync_state entry. */
export function pairKey({ airtable, supabase, winner }) {
  const air = airtable?.airtableId || winner?.airtableId;
  const sup = supabase?.supabaseId || winner?.supabaseId;
  return air ? `air:${air}` : `sup:${sup}`;
}

const ms = (iso) => (iso ? new Date(iso).getTime() : null);

/**
 * Compare two modified timestamps with a clock-skew tolerance.
 * Returns 1 if a is newer, -1 if b is newer, 0 if within skew (a tie).
 * A missing timestamp is treated as oldest.
 */
export function compareModified(aIso, bIso, skewMs = 0) {
  const a = ms(aIso);
  const b = ms(bIso);
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (Math.abs(a - b) <= skewMs) return 0;
  return a > b ? 1 : -1;
}

/**
 * Resolve a differing pair by LWW. Ties (within skew) deterministically favor
 * Airtable so the outcome is stable and never thrashes. Returns a concrete
 * update decision naming the winner and the overwritten loser.
 */
export function resolveConflict(airtable, supabase, { clockSkewMs = 0 } = {}) {
  const cmp = compareModified(airtable.modifiedAt, supabase.modifiedAt, clockSkewMs);
  const airtableWins = cmp >= 0; // tie -> airtable
  if (airtableWins) {
    return {
      type: 'update_supabase',
      winner: airtable,
      loser: supabase,
      sourceModifiedAt: airtable.modifiedAt,
      tie: cmp === 0,
    };
  }
  return {
    type: 'update_airtable',
    winner: supabase,
    loser: airtable,
    sourceModifiedAt: supabase.modifiedAt,
    tie: false,
  };
}

/** True if this source version was already propagated (an echo we must skip). */
export function isEcho(sourceModifiedAt, stateEntry, clockSkewMs = 0) {
  if (!stateEntry || !stateEntry.lastSourceModifiedAt) return false;
  return compareModified(sourceModifiedAt, stateEntry.lastSourceModifiedAt, clockSkewMs) <= 0;
}

/**
 * Turn classify() output into concrete, echo-suppressed apply decisions.
 * `syncState` is a Map(pairKey -> { lastSourceModifiedAt }).
 */
export function resolveDecisions(decisions, syncState = new Map(), { clockSkewMs = 0 } = {}) {
  const out = [];
  for (const d of decisions) {
    if (d.type === 'noop' || d.type === 'skip') {
      out.push(d);
      continue;
    }

    let resolved;
    if (d.type === 'conflict') {
      const r = resolveConflict(d.airtable, d.supabase, { clockSkewMs });
      resolved = { ...d, ...r };
    } else if (d.type === 'create_supabase') {
      resolved = { ...d, winner: d.airtable, sourceModifiedAt: d.airtable.modifiedAt };
    } else if (d.type === 'create_airtable') {
      resolved = { ...d, winner: d.supabase, sourceModifiedAt: d.supabase.modifiedAt };
    } else {
      out.push(d);
      continue;
    }

    const entry = syncState.get(pairKey(resolved));
    if (isEcho(resolved.sourceModifiedAt, entry, clockSkewMs)) {
      out.push({ type: 'noop', reason: 'echo', airtable: d.airtable, supabase: d.supabase });
    } else {
      out.push(resolved);
    }
  }
  return out;
}
