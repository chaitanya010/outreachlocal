-- OutreachLocal: reply-performance tracking (subject variant + pain point per send)
-- Run AFTER 006_discovery_pipeline.sql
--
-- Lets us answer "which subject line / which pain-point angle actually gets
-- replies" instead of guessing — every outreach_logs row for an email send
-- now records which of the 5 subject variants and which specific pain point
-- was used, so it can be joined against leads.email_replied for a real
-- reply-rate breakdown per variant/angle.

alter table outreach_logs
  add column if not exists subject_variant int,   -- 0-4, index into the AI's 5 subject options (email only)
  add column if not exists pain_point       text;  -- the single problem key cited as the observation (email only)

create index if not exists idx_outreach_logs_subject_variant on outreach_logs (subject_variant);
create index if not exists idx_outreach_logs_pain_point       on outreach_logs (pain_point);
