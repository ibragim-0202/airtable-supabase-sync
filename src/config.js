import { readFile } from 'node:fs/promises';

/**
 * Minimal .env loader (Node 18 has no --env-file). Real environment variables
 * win over the file. Ignores comments/blank lines.
 */
export async function loadDotenv(path = '.env') {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function readConfig(env = process.env) {
  return {
    airtableToken: env.AIRTABLE_TOKEN || '',
    supabaseUrl: env.SUPABASE_URL || '',
    supabaseKey: env.SUPABASE_KEY || '',
    telegramBotToken: env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: env.TELEGRAM_CHAT_ID || '',
    directionOverride: env.SYNC_DIRECTION || '',
    clockSkewMs: Number.parseInt(env.CLOCK_SKEW_MS || '1000', 10),
  };
}

/** Fail fast if the credentials needed to read/write both sides are missing. */
export function assertRunnable(config) {
  const missing = [];
  if (!config.airtableToken) missing.push('AIRTABLE_TOKEN');
  if (!config.supabaseUrl) missing.push('SUPABASE_URL');
  if (!config.supabaseKey) missing.push('SUPABASE_KEY');
  if (missing.length) throw new Error(`Missing required config: ${missing.join(', ')}`);
}
