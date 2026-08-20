import { readFile } from 'node:fs/promises';
import { loadDotenv, readConfig, assertRunnable } from './config.js';
import { createLogger } from './log.js';
import { validateMapping, normalizeAirtable, normalizeSupabase } from './mapping.js';
import { classify, summarizeDecisions } from './classify.js';
import { resolveDecisions } from './resolve.js';
import { applyDecisions } from './apply.js';
import { detectOrphans } from './orphans.js';
import { createAirtableClient } from './clients/airtable.js';
import { createSupabaseClient } from './clients/supabase.js';
import { formatAlert, sendAlert } from './telegram.js';

async function loadMapping() {
  const url = new URL('../config/mapping.json', import.meta.url);
  return validateMapping(JSON.parse(await readFile(url, 'utf8')));
}

/** Normalize raw rows, collecting per-record coercion failures instead of throwing. */
function normalizeAll(rawList, mapping, normalizeOne, errors, side) {
  const out = [];
  for (const raw of rawList) {
    try {
      out.push(normalizeOne(raw, mapping));
    } catch (err) {
      const key = raw.id ?? '(unknown)';
      errors.push({ type: `normalize_${side}`, key: String(key), message: err.message });
    }
  }
  return out;
}

export async function runSync() {
  const verbose = process.argv.includes('--verbose');
  const dryRun = process.argv.includes('--dry-run');
  await loadDotenv();
  const config = readConfig();
  const logger = createLogger({ verbose: verbose || dryRun });
  assertRunnable(config);

  const mapping = await loadMapping();
  const direction = config.directionOverride || mapping.direction || 'two-way';
  logger.info(`direction=${direction} dryRun=${dryRun}`);

  const airtable = createAirtableClient({
    token: config.airtableToken,
    baseId: mapping.airtable.baseId,
    table: mapping.airtable.table,
  });
  const supabase = createSupabaseClient({ url: config.supabaseUrl, key: config.supabaseKey, mapping });

  // Pull both sides.
  const [airtableRaw, supabaseRaw] = await Promise.all([airtable.listRecords(), supabase.listRows()]);
  logger.info(`pulled airtable=${airtableRaw.length} supabase=${supabaseRaw.length}`);

  const errors = [];
  const airRecs = normalizeAll(airtableRaw, mapping, normalizeAirtable, errors, 'airtable');
  const supRecs = normalizeAll(supabaseRaw, mapping, normalizeSupabase, errors, 'supabase');

  // Classify -> resolve (LWW + echo suppression) -> apply.
  const decisions = classify(airRecs, supRecs, mapping, { direction });
  const syncState = await supabase.loadSyncState();
  const resolved = resolveDecisions(decisions, syncState, { clockSkewMs: config.clockSkewMs });
  const counts = summarizeDecisions(resolved);

  const applyRes = await applyDecisions(resolved, { airtable, supabase, mapping, dryRun, logger });
  errors.push(...applyRes.errors);

  // Surface conflicts explicitly so overwrites are never silent.
  for (const d of resolved) {
    if (d.tie) logger.warn(`conflict tie -> airtable kept for ${d.winner?.airtableId}`);
  }

  // Detect records deleted on one side. We never auto-delete the mirror; we
  // flag it 'orphan' and let the alert surface it for a human decision.
  const orphans = detectOrphans(syncState, airRecs, supRecs);
  for (const o of orphans) {
    logger.warn(`orphan: airtable_id=${o.airtable_id} supabase_id=${o.supabase_id} missing=${o.missing.join(',')}`);
    errors.push({ type: 'orphan', key: o.airtable_id || o.supabase_id, message: `deleted on ${o.missing.join(',')}` });
    if (!dryRun) {
      try {
        await supabase.upsertSyncState({ airtable_id: o.airtable_id, supabase_id: o.supabase_id, status: 'orphan' });
      } catch (err) {
        logger.warn(`failed to flag orphan ${o.airtable_id}: ${err.message}`);
      }
    }
  }

  if (errors.length > 0) {
    await sendAlert(formatAlert(errors, counts), config, logger);
  }

  console.log(
    `sync run: decisions=${JSON.stringify(counts)} applied=${applyRes.applied.length} errors=${errors.length}${dryRun ? ' (dry-run)' : ''}`,
  );
}

runSync().catch((err) => {
  console.error(`[FATAL] ${err.message}`);
  process.exit(1);
});
