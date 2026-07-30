-- OutreachLocal: prospect scoring + weak presence tracking
-- Run AFTER 002_outreach_logs.sql

alter table leads
  add column if not exists review_count    integer default 0,
  add column if not exists has_booking     boolean default false,
  add column if not exists business_status text default 'OPERATIONAL',
  add column if not exists business_type   text,
  add column if not exists problems        text[],   -- ['no_website','poor_ratings','no_reviews','no_booking']
  add column if not exists prospect_score  integer default 0;  -- 0-100, higher = weaker presence = better prospect

create index if not exists idx_leads_prospect_score on leads (prospect_score desc);
create index if not exists idx_leads_business_type  on leads (business_type);
create index if not exists idx_leads_review_count   on leads (review_count);
create index if not exists idx_leads_rating         on leads (rating);
