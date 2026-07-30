-- OutreachLocal: preserve social/directory profile URLs for email scraping
-- Run AFTER 004_email_sequence.sql
--
-- websiteFilter.js nulls out leads.website when it's a Facebook/Instagram/Yelp/
-- etc. profile rather than a real site (that's what makes a lead a "no-website"
-- prospect). This column keeps that original URL around so the enrichment
-- scraper still has somewhere to look for a contact email.

alter table leads
  add column if not exists social_url text;
