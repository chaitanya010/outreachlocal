-- OutreachLocal: outreach tracking
-- Run this AFTER 001_create_leads.sql

-- ─── New columns on leads ────────────────────────────────────────────────────

alter table leads
  add column if not exists sms_sent_at        timestamptz,
  add column if not exists whatsapp_sent_at   timestamptz,
  add column if not exists email_sent_at      timestamptz,
  add column if not exists call_attempted_at  timestamptz,
  add column if not exists last_outreach_at   timestamptz,
  add column if not exists outreach_channel   text,          -- last channel used
  add column if not exists outreach_reply     text;          -- any reply/note logged

-- ─── outreach_logs ───────────────────────────────────────────────────────────

create table if not exists outreach_logs (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references leads(id) on delete cascade,
  place_id    text not null,
  channel     text not null,        -- sms | whatsapp | email | call
  status      text not null,        -- sent | failed | answered | no_answer | bounced
  message     text,                 -- body sent (templated)
  error       text,                 -- error message if status=failed
  provider_id text,                 -- Twilio SID / SendGrid message ID
  created_at  timestamptz default now()
);

create index if not exists idx_outreach_logs_lead_id   on outreach_logs (lead_id);
create index if not exists idx_outreach_logs_channel   on outreach_logs (channel);
create index if not exists idx_outreach_logs_status    on outreach_logs (status);
create index if not exists idx_outreach_logs_created   on outreach_logs (created_at desc);
