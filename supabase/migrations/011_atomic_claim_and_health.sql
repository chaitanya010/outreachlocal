-- OutreachLocal: atomic send-claiming + persistent health state
-- Run AFTER 010_booking_flow.sql
--
-- Two independent schedulers (Railway's in-process cron and a GitHub-Actions
-- fallback runner) can now both call emailSequence.runOnce() -- possibly at
-- the same moment, from different processes/machines. A single Postgres
-- row is the only thing both sides share, so the "only one worker may send
-- a given lead's next stage" guarantee has to live there: an atomic
-- UPDATE ... WHERE email_stage = <expected> ... RETURNING is a standard
-- compare-and-swap -- Postgres serializes concurrent UPDATEs to the same
-- row, so exactly one of two simultaneous claim attempts can ever affect a
-- row (see claimLeadForStage in leadsRepository.js). email_claimed_by is
-- diagnostic only (which worker holds/held the claim); email_claimed_at
-- both marks a claim as held and (once past the claim timeout) lets a
-- worker that crashed after claiming but before finishing get reclaimed
-- automatically instead of blocking that lead forever.
alter table leads
  add column if not exists email_claimed_at timestamptz,
  add column if not exists email_claimed_by text;

create index if not exists idx_leads_email_claimed_at on leads (email_claimed_at);

-- Generic persistent health/heartbeat state, keyed by component name (e.g.
-- 'scheduler:railway', 'scheduler:github-fallback', 'mailbox:<address>',
-- 'failure:email_send'). Replaces the in-memory wasHealthy/failureCounts
-- that used to live in healthCheck.js/notify.js and reset on every process
-- restart or Railway redeploy -- a restart happening to coincide with a real
-- outage would otherwise silently drop the alert streak/staleness signal.
create table if not exists system_health (
  component      text primary key,
  status         text not null default 'ok',   -- 'ok' | 'error'
  fail_count     int not null default 0,
  last_ok_at     timestamptz,
  last_error     text,
  last_error_at  timestamptz,
  updated_at     timestamptz not null default now()
);
