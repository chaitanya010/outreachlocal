const { createClient } = require('@supabase/supabase-js');
const { config } = require('../config');

let _client = null;

/**
 * Returns a singleton Supabase client.
 * Uses service role key so the backend can bypass RLS.
 */
function getClient() {
  if (!_client) {
    if (!config.supabase.url || !config.supabase.serviceKey) {
      throw new Error('Supabase URL and service key are required.');
    }
    _client = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: { persistSession: false },
    });
  }
  return _client;
}

module.exports = { getClient };
