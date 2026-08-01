-- OutreachLocal: multi-mailbox sender rotation
-- Run AFTER 007_email_performance.sql
--
-- Scaling from one sending address (contact@stanweb.tech) to a pool of
-- mailboxes (reputation isolation + higher daily volume). Each lead is
-- locked to ONE sender for its entire 4-stage sequence (assigned on the
-- stage-1 send) -- this is what guarantees no business ever gets emailed by
-- two different mailboxes. Per-sender daily new-lead counts are derived from
-- outreach_logs.sender rather than a separate counter table.

alter table leads
  add column if not exists assigned_sender text;

alter table outreach_logs
  add column if not exists sender text;  -- which mailbox sent this (email rows only)

create index if not exists idx_leads_assigned_sender on leads (assigned_sender);
create index if not exists idx_outreach_logs_sender    on outreach_logs (sender);
