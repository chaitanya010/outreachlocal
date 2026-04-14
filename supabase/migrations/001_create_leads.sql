-- OutreachLocal: leads table
-- Run this in your Supabase SQL editor to initialize the schema.

create table if not exists leads (
  id            uuid primary key default gen_random_uuid(),
  place_id      text unique not null,       -- Google Place ID (dedup key)
  name          text not null,
  city          text not null,
  address       text,
  phone         text,
  website       text,
  has_website   boolean not null default false,
  rating        numeric(2,1),
  types         text[],                     -- e.g. ['spa', 'beauty_salon']
  -- Enrichment fields (populated later)
  email         text,
  domain        text,
  enriched_at   timestamptz,
  -- Outreach tracking
  outreach_status text default 'pending',  -- pending | contacted | converted | skipped
  -- Metadata
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Auto-update updated_at on row changes
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger leads_updated_at
  before update on leads
  for each row execute function update_updated_at();

-- Indexes for common query patterns
create index if not exists idx_leads_city         on leads (city);
create index if not exists idx_leads_has_website  on leads (has_website);
create index if not exists idx_leads_outreach     on leads (outreach_status);
create index if not exists idx_leads_created_at   on leads (created_at desc);
