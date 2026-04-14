const { getClient } = require('./supabaseClient');
const logger = require('../utils/logger');

const TABLE = 'leads';

/**
 * Upsert a batch of leads using place_id as the conflict key.
 * Existing rows are updated; new rows are inserted.
 *
 * @param {object[]} leads  normalized lead objects
 * @returns {Promise<{ inserted: number, errors: number }>}
 */
async function upsertLeads(leads) {
  if (!leads.length) return { inserted: 0, errors: 0 };

  const db = getClient();
  const { data, error } = await db
    .from(TABLE)
    .upsert(leads, { onConflict: 'place_id', ignoreDuplicates: false })
    .select('id');

  if (error) {
    logger.error('Supabase upsert failed', { message: error.message });
    throw error;
  }

  logger.info(`Upserted ${data.length} leads`);
  return { inserted: data.length, errors: 0 };
}

/**
 * Query leads with optional filters.
 *
 * @param {object} opts
 * @param {boolean} [opts.noWebsite]         only leads without a website
 * @param {string}  [opts.city]              filter by city (case-insensitive)
 * @param {string}  [opts.outreachStatus]    filter by outreach_status
 * @param {number}  [opts.limit=100]
 * @param {number}  [opts.offset=0]
 * @returns {Promise<{ leads: object[], total: number }>}
 */
async function getLeads({ noWebsite, city, outreachStatus, limit = 100, offset = 0 } = {}) {
  const db = getClient();

  let query = db
    .from(TABLE)
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (noWebsite === true) query = query.eq('has_website', false);
  if (city) query = query.ilike('city', `%${city}%`);
  if (outreachStatus) query = query.eq('outreach_status', outreachStatus);

  const { data, error, count } = await query;

  if (error) {
    logger.error('Supabase query failed', { message: error.message });
    throw error;
  }

  return { leads: data, total: count };
}

/**
 * Update enrichment fields for a single lead.
 *
 * @param {string} placeId
 * @param {{ email?: string, domain?: string }} fields
 */
async function updateEnrichment(placeId, fields) {
  const db = getClient();
  const { error } = await db
    .from(TABLE)
    .update({ ...fields, enriched_at: new Date().toISOString() })
    .eq('place_id', placeId);

  if (error) {
    logger.error('Enrichment update failed', { placeId, message: error.message });
    throw error;
  }
}

module.exports = { upsertLeads, getLeads, updateEnrichment };
