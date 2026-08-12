-- OutreachLocal: per-lead country, for timezone-aware send scheduling
-- Run AFTER 011_atomic_claim_and_health.sql
--
-- Discovery now searches UK/Australia/Canada/Ireland/New Zealand alongside
-- the US (see locationLibrary.js). Email sends are gated on a fixed
-- America/New_York business-hours window -- fine for US leads, but it meant
-- an Australian lead would get emailed at 11pm-7am their local time. This
-- column lets emailSequence.js check each lead's own local business hours
-- before sending (see src/utils/timezone.js).

alter table leads
  add column if not exists country text not null default 'United States';

-- Backfill the handful of leads (if any) discovered before this column
-- existed, using the country already baked into `city` by locationLibrary.js
-- (e.g. "Manchester, UK").
update leads set country = 'United Kingdom' where city ilike '%, UK';
update leads set country = 'Australia'      where city ilike '%, Australia';
update leads set country = 'Canada'         where city ilike '%, Canada';
update leads set country = 'Ireland'        where city ilike '%, Ireland';
update leads set country = 'New Zealand'    where city ilike '%, New Zealand';

create index if not exists idx_leads_country on leads (country);
