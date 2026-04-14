# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Run dev server (auto-restart on changes)
npm run dev

# Run production server
npm start

# Run all tests
npm test

# Run a single test file
npx jest tests/websiteFilter.test.js

# CLI pipeline
node generate-leads.js --city="Miami"
node generate-leads.js --city="Dallas" --types="spa,clinic"
```

## Environment Setup

Copy `.env.example` to `.env` and fill in:
- `GOOGLE_PLACES_API_KEY` — required
- `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` — required
- `APOLLO_API_KEY` / `HUNTER_API_KEY` — optional enrichment

Run the SQL in `supabase/migrations/001_create_leads.sql` in your Supabase SQL editor before first use.

## Architecture

**Pipeline flow** (orchestrated by `src/jobs/leadPipeline.js`):
1. `googlePlacesService.fetchLeads(city, types)` — paginates Google Text Search API, fetches Place Details for missing phone/website
2. `websiteFilter.annotateWebsiteStatus(leads)` — re-evaluates `has_website`, nulls out social-profile URLs (Facebook, Instagram, Yelp, etc.)
3. `leadsRepository.upsertLeads(leads)` — upserts all leads into Supabase using `place_id` as the conflict key; stores both website and no-website businesses so the DB is a full record

**Key design decisions:**
- All leads are stored (not just no-website ones); `has_website=false` is the filter column for outreach
- `place_id` is the dedup key — re-running a city never creates duplicate rows
- Enrichment is a separate optional step (`POST /enrich`) — never blocks the main pipeline
- Social/directory URLs (Facebook, Yelp, etc.) are treated as "no real website" and nulled during annotation

**Module map:**
- `src/config/index.js` — central env config + startup validation
- `src/services/googlePlacesService.js` — Google Places API (text search + details)
- `src/services/enrichmentService.js` — Hunter.io / Apollo.io enrichment (API only, no scraping)
- `src/filters/websiteFilter.js` — website presence logic + social URL patterns
- `src/db/supabaseClient.js` — singleton Supabase client
- `src/db/leadsRepository.js` — all DB queries (upsert, query, update enrichment)
- `src/jobs/leadPipeline.js` — orchestrates fetch → filter → store
- `src/routes/leads.js` — `POST /generate-leads`, `GET /leads`, `GET /dashboard`
- `src/routes/enrichment.js` — `POST /enrich`
- `src/utils/logger.js` — Winston logger (writes to `logs/`)
- `src/utils/sleep.js` — rate-limit helper

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/generate-leads` | Run pipeline. Body: `{ city, types? }` |
| `GET` | `/leads` | Query leads. Params: `noWebsite`, `city`, `status`, `limit`, `offset` |
| `GET` | `/dashboard` | Aggregate stats |
| `POST` | `/enrich` | Enrich no-website leads. Body: `{ city?, limit? }` |
| `GET` | `/health` | Health check |
