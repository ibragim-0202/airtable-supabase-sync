# airtable-supabase-sync

[Русский](README.md) · **English**

A two-way record sync between an **Airtable** table and a table in **Supabase**
(Postgres). Field correspondence is defined by config (data, not code), conflicts
are resolved by last-write-wins, and any per-record error goes to a human on
Telegram rather than being lost silently.

Small, finished, on a real stack. All sync logic is pure Node.js functions with
unit tests; Airtable, Supabase and Telegram are thin adapters.

---

## What it does

- Pulls records from Airtable and Supabase and brings both sides to a **single
  canonical shape** via the mapping (`config/mapping.json`).
- **Classifies** each logical record: create on the left / create on the right /
  conflict / nothing.
- **Resolves conflicts** by last-write-wins (with a clock-skew tolerance) and
  explicitly logs which version was overwritten.
- **Prevents ping-pong**: a change already propagated A→B does not fly back B→A.
- **Upserts idempotently** into both sides and keeps a `sync_state` journal.
- Collects per-record errors and sends a **single summary alert to Telegram**.
- Notices **deleted records** (previously synced, now gone from one side): it
  does not auto-delete the mirror, but flags it `orphan` and tells a human.

## How it works

```
Airtable ─┐                              ┌─▶ apply → Airtable
          ├─ pull → normalize → classify ─┤
Supabase ─┘         (via mapping)         └─▶ apply → Supabase
                                    │
                         resolve (LWW + echo-suppression)
                                    │  reads/writes
                                    ▼
                               sync_state (Supabase)
```

Per-run flow: **pull both sides → normalize → classify the delta → resolve
(LWW + echo suppression) → apply → journal `sync_state` → alert on errors →
summary**.

## Engineering decisions

- **Mapping as data.** `config/mapping.json` is the single source of truth for
  field correspondence and direction. A new pair of tables needs no code change.
- **Two-layer idempotency:**
  1. *Correspondence key* — upserts by `airtable_id` / `supabase_id`, so a rerun
     never creates duplicates.
  2. *Version by time* — a change is applied only if the source is **newer** than
     what we already propagated (`sync_state.last_source_modified_at`). Combined
     with field equality, this **stops the endless ping-pong**.
- **Last-write-wins with a clock tolerance.** The fresher version wins; on a
  "tie" within `CLOCK_SKEW_MS`, Airtable deterministically wins — no thrashing.
  The losing version is **visible in the log**, not lost silently.
- **No silent failures.** Each record is applied in its own try/catch: one
  failure doesn't take down the run, errors are collected and alerted. A partial
  API failure leaves what was already applied (idempotent), and the next run
  finishes the rest.
- **IO separated from logic.** Normalization, classification, LWW and echo
  suppression are pure functions with no network; the Airtable/Supabase clients
  are injected (fakes in tests).

## Record-linking model

- Supabase table: `airtable_id` column (link to the Airtable record), `updated_at`
  (the time source for LWW), `synced_at`.
- Airtable: a `supabase_id` field (back-link) and the built-in "Last Modified Time".
- The `sync_state` table — a journal of correspondences and times for idempotency.

Schema is in [`sql/schema.sql`](sql/schema.sql).

## Stack

Node.js 18 (ESM, built-in `fetch`, `node:test`) · Airtable REST API ·
`@supabase/supabase-js` · Telegram Bot API · Docker + busybox cron (poll mode).

## Running

### Setup

```bash
npm install
cp .env.example .env         # AIRTABLE_TOKEN, SUPABASE_URL/KEY, TELEGRAM_*
# apply the schema in your Supabase project:
psql "$SUPABASE_CONNECTION" -f sql/schema.sql
# edit config/mapping.json for your tables/fields
```

### A run

```bash
npm test                      # unit tests
node src/index.js --dry-run   # read, classify, write nothing
npm start                     # real two-way run
npm run once                  # same with verbose logging
```

`config/mapping.json` → `direction`: `two-way` | `airtable-to-supabase` |
`supabase-to-airtable` (overridable via the `SYNC_DIRECTION` variable).

### Docker (scheduled)

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f
```

The container starts cron and syncs every 15 minutes (timezone via `TZ`).
Secrets are read from the mounted `.env`; idempotency state lives in Supabase
(`sync_state`), so it survives restarts on its own.

## Tests

`npm test` — unit tests over the pure logic: mapping of both sides, delta
classification, LWW and the clock tolerance, echo suppression (anti-ping-pong),
orphan detection, apply orchestration on fake clients, alert formatting.

---

## My role

Designed and built the whole thing: the record-linking model, the two-layer
idempotency, LWW with a clock-skew tolerance, edge-case handling, tests, the
Docker/cron wrapping. This is a portfolio project, not a commercial deployment;
presented as-is, without invented metrics or clients.

## Which AI tools I used

Built together with **Claude Code** (agentic coding): a spec before the code,
block-by-block assembly with meaningful commits, unit tests per block, review and
rejection of some suggestions with a rationale. The tests caught two real bugs
along the way (field comparison and error-key resolution) — which is exactly the
point of covering the pure logic.

## What was hard / what I solved

- **Anti-ping-pong.** A naive two-way sync loops: a record from A arrives in B,
  B "changes" and flies back to A. Solved by combining field equality with a
  second idempotency layer by time (`last_source_modified_at`).
- **Conflicts without data loss.** LWW with a clock tolerance and a deterministic
  tie; the losing version is always visible in the log.
- **Partial failures.** Per-record apply in its own try/catch + a summary alert —
  the run doesn't collapse as a whole, the next one finishes off.

## Out of scope (deliberately)

Real-time Airtable webhooks (poll mode is enough for a demo), auto-deletion of
mirrors (only an `orphan` flag + alert — deletion is irreversible), syncing
attachments and linked records. Possible next steps: webhooks instead of polling,
batch upserts, divergence metrics.

## License

MIT.
