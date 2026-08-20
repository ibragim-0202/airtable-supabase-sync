import { readFile } from 'node:fs/promises';
import { loadDotenv, readConfig, assertRunnable } from './config.js';
import { createLogger } from './log.js';
import { validateMapping, normalizeAirtable, normalizeSupabase } from './mapping.js';
import { classify, summarizeDecisions } from './classify.js';
import { resolveDecisions } from './resolve.js';
import { applyDecisions } from './apply.js';
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
