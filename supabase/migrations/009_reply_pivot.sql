-- OutreachLocal: decoy-opener -> reply-triggered pivot flow
-- Run AFTER 008_sender_rotation.sql
--
-- Stage 1/2 are now a genuine-sounding question ("what time do you close
-- today?") rather than a pitch -- the goal is a reply, not a read. Once a
-- reply comes in (detected by replyWatcher.js polling each mailbox's IMAP
-- inbox), the pivot/reveal email (with the deck attached) is sent
-- automatically. email_pivot_sent prevents sending that reveal more than
-- once if the lead replies again after it's already gone out.

alter table leads
  add column if not exists email_pivot_sent boolean default false,
  add column if not exists last_reply_at    timestamptz;
