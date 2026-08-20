const API = 'https://api.airtable.com/v0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Thin Airtable REST client. Throttled to ~5 req/s (Airtable's per-base limit)
 * with a fixed inter-call delay so we never trip a 429 mid-run.
 */
export function createAirtableClient({ token, baseId, table, throttleMs = 220 }) {
  const base = `${API}/${baseId}/${encodeURIComponent(table)}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  async function call(url, init) {
    await sleep(throttleMs);
    const res = await fetch(url, { ...init, headers });
    if (!res.ok) {
      throw new Error(`Airtable ${init?.method || 'GET'} ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  return {
    /** List every record, following pagination. */
    async listRecords() {
      const records = [];
      let offset;
      do {
        const qs = new URLSearchParams({ pageSize: '100' });
        if (offset) qs.set('offset', offset);
        const data = await call(`${base}?${qs}`, { method: 'GET' });
        records.push(...(data.records || []));
        offset = data.offset;
      } while (offset);
      return records;
    },

    async createRecord(fields) {
      const data = await call(base, { method: 'POST', body: JSON.stringify({ fields, typecast: true }) });
      return data.id;
    },

    async updateRecord(id, fields) {
      await call(`${base}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields, typecast: true }) });
    },
  };
}
