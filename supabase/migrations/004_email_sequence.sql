-- OutreachLocal: cold-email sequence engine (FootWord-style stage tracking)
-- Run AFTER 003_prospect_scoring.sql

alter table leads
  add column if not exists email_stage         int default 0,        -- 0=none,1=intro,2=value,3=redesign,4=last
  add column if not exists email_first_sent_at  timestamptz,          -- anchors day 0/3/7/14 offsets
  add column if not exists email_last_sent_at   timestamptz,
  add column if not exists email_replied        boolean default false,
  add column if not exists email_stopped        boolean default false;

alter table outreach_logs
  add column if not exists stage int;  -- only meaningful for channel='email' rows from the sequence engine

create index if not exists idx_leads_email_stage   on leads (email_stage);
create index if not exists idx_leads_email_stopped on leads (email_stopped);
