-- OutreachLocal: smarter discovery pipeline (niche/geo rotation, lead intelligence)
-- Run AFTER 005_social_url.sql
--
-- Supports the multi-stage discovery pipeline (100 candidates -> filter ->
-- score -> enrich -> top 10): geographic/niche rotation history so the same
-- (niche, city) pair isn't re-searched within 180 days, plus new
-- "lead intelligence" fields (AI-opportunity ranking, suggested service,
-- personalization sentence, decision-maker contact, email confidence,
-- which discovery source found the lead).

create table if not exists search_history (
  id bigint generated always as identity primary key,
  niche text not null,
  city text not null,
  state text not null,
  searched_at timestamptz not null default now()
);

create index if not exists idx_search_history_niche_city on search_history (niche, city);
create index if not exists idx_search_history_searched_at on search_history (searched_at);

alter table leads
  add column if not exists ai_opportunity_score int default 0,
  add column if not exists suggested_service text,
  add column if not exists personalization_sentence text,
  add column if not exists decision_maker_name text,
  add column if not exists decision_maker_role text,
  add column if not exists email_confidence text,
  add column if not exists source text;

create index if not exists idx_leads_ai_opportunity_score on leads (ai_opportunity_score);
