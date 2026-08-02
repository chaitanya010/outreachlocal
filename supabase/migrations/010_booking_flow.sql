-- OutreachLocal: booking-link flow (post-pivot reply -> demo booked)
-- Run AFTER 009_reply_pivot.sql
--
-- Once a lead replies to the pivot/reveal email (email_pivot_sent=true) and
-- that reply signals real interest, replyWatcher.js sends the Calendly
-- booking link automatically. booking_sent prevents sending that link more
-- than once if the lead replies again after it's already gone out.

alter table leads
  add column if not exists booking_sent boolean default false;
