require('dotenv').config();

const config = {
  google: {
    apiKey: process.env.GOOGLE_PLACES_API_KEY,
    maxResults: parseInt(process.env.PLACES_MAX_RESULTS, 10) || 60,
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
  },
  enrichment: {
    apolloKey: process.env.APOLLO_API_KEY,
    hunterKey: process.env.HUNTER_API_KEY,
  },
  yelp: {
    apiKey: process.env.YELP_API_KEY,
  },
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development',
  },
  pipeline: {
    requestDelayMs: parseInt(process.env.REQUEST_DELAY_MS, 10) || 200,
  },
};

function validate() {
  const required = [
    ['google.apiKey', config.google.apiKey],
    ['supabase.url', config.supabase.url],
    ['supabase.serviceKey', config.supabase.serviceKey],
  ];

  const missing = required
    .filter(([, val]) => !val)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

module.exports = { config, validate };
