/**
 * Build a human-readable alert from the run's errors. Pure and testable.
 * Truncates a long error list so the message stays within Telegram limits.
 */
export function formatAlert(errors, counts = {}, { max = 20 } = {}) {
  const head = `⚠️ airtable-supabase-sync: ${errors.length} error(s) this run`;
  const summary = Object.entries(counts)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  const lines = errors.slice(0, max).map((e) => `• [${e.type}] ${e.key}: ${e.message}`);
  if (errors.length > max) lines.push(`…and ${errors.length - max} more`);
  return [head, summary && `applied: ${summary}`, '', ...lines].filter(Boolean).join('\n');
}

/**
 * Send an alert to Telegram. Best-effort: if creds are missing or the send
 * fails, we log and move on — a broken alert channel must not crash the sync,
 * but the errors it describes are already returned to the caller.
 */
export async function sendAlert(text, config, logger = console) {
  if (!config.telegramBotToken || !config.telegramChatId) {
    logger.warn?.('telegram: no creds, skipping alert (errors still reported in logs)');
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: config.telegramChatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) logger.warn?.(`telegram: alert failed ${res.status}`);
  } catch (err) {
    logger.warn?.(`telegram: alert error ${err.message}`);
  }
}
