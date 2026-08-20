-- Example schema matching config/mapping.json (the "leads" pairing).
-- Adjust column names/types to your own mapping.

-- Target data table on the Supabase side.
create table if not exists leads (
  id           uuid primary key default gen_random_uuid(),
  airtable_id  text unique,                       -- link to the Airtable record
  name         text,
  email        text,
  status       text,
  amount       numeric,
  updated_at   timestamptz not null default now(),-- source of truth for LWW on this side
  synced_at    timestamptz                        -- last time the sync touched this row
);

-- Keep updated_at fresh on any change, so LWW comparisons are meaningful.
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists leads_set_updated_at on leads;
create trigger leads_set_updated_at
  before update on leads
  for each row execute function set_updated_at();

-- Correspondence + idempotency journal. One row per logical record.
-- last_source_modified_at + last_synced_at power the "don't re-echo" layer
-- that stops the two-way ping-pong.
create table if not exists sync_state (
  airtable_id             text primary key,
  supabase_id             text,
  last_direction          text,        -- 'a2s' | 's2a'
  last_source_modified_at timestamptz, -- modifiedAt of the version last propagated
  last_synced_at          timestamptz not null default now(),
  status                  text not null default 'active' -- 'active' | 'orphan'
);
