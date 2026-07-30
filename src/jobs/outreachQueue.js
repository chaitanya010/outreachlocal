'use strict';

/**
 * Outreach Queue
 *
 * Orchestrates multi-channel outreach for a batch of leads.
 * Channels attempted in order (configurable):
 *   1. SMS        — always if phone exists
 *   2. WhatsApp   — always if phone exists
 *   3. Email      — only if email was enriched
 *   4. Call       — only if ENABLE_CALLS=true
 *
 * Rate limits (env-configurable):
 *   OUTREACH_DELAY_MS   — delay between each lead (default 3000ms)
 *   OUTREACH_BATCH_SIZE — leads processed per campaign run (default 50)
 */

const { sendSms, sendWhatsApp, toE164 } = require('../services/twilioService');
const { sendEmail } = require('../services/emailService');
const { placeCall } = require('../services/callingService');
const { generateSms, generateWhatsApp, generateEmail, generateCallScript } = require('../services/aiMessageService');
const { getLeads, logOutreach, markOutreachSent } = require('../db/leadsRepository');
const { sleep } = require('../utils/sleep');
const logger = require('../utils/logger');

const DELAY_MS = parseInt(process.env.OUTREACH_DELAY_MS || '3000', 10);
const BATCH_SIZE = parseInt(process.env.OUTREACH_BATCH_SIZE || '50', 10);
const ENABLE_CALLS = process.env.ENABLE_CALLS === 'true';

// ─── Single-lead outreach ─────────────────────────────────────────────────────

/**
 * Run all configured channels for one lead.
 * Failures on one channel do not block others.
 *
 * @param {object} lead
 * @param {string[]} channels  subset of ['sms','whatsapp','email','call']
 * @returns {Promise<object[]>}  array of log entries
 */
async function outreachLead(lead, channels = ['sms', 'whatsapp', 'email', 'call']) {
  const logs = [];
  const phone = toE164(lead.phone);

  for (const channel of channels) {
    // Guard: skip channels that can't proceed
    if ((channel === 'sms' || channel === 'whatsapp') && !phone) {
      logger.warn(`No valid phone for ${channel}`, { place_id: lead.place_id });
      continue;
    }
    if (channel === 'email' && !lead.email) continue;
    if (channel === 'call' && !ENABLE_CALLS) continue;
    if (channel === 'call' && !phone) continue;

    let status = 'sent';
    let providerId = null;
    let error = null;
    let message = null;

    try {
      switch (channel) {
        case 'sms': {
          message = await generateSms(lead);
          const r = await sendSms(phone, message);
          providerId = r.sid;
          break;
        }
        case 'whatsapp': {
          message = await generateWhatsApp(lead);
          const r = await sendWhatsApp(phone, message);
          providerId = r.sid;
          break;
        }
        case 'email': {
          const content = await generateEmail(lead);
          message = content.subject;
          const r = await sendEmail({ to: lead.email, ...content });
          providerId = r.messageId;
          break;
        }
        case 'call': {
          message = await generateCallScript(lead);
          const r = await placeCall(phone, message, lead);
          providerId = r.id;
          break;
        }
      }

      logger.info(`Outreach [${channel}] sent`, { place_id: lead.place_id, providerId });
    } catch (err) {
      status = 'failed';
      error = err.message;
      logger.error(`Outreach [${channel}] failed`, { place_id: lead.place_id, error: err.message });
    }

    logs.push({ channel, status, message, error, provider_id: providerId });
  }

  return logs;
}

// ─── Campaign (batch) ─────────────────────────────────────────────────────────

/**
 * Run an outreach campaign for a batch of no-website leads.
 *
 * @param {object} opts
 * @param {string}   [opts.city]       filter by city
 * @param {number}   [opts.limit]      max leads to process
 * @param {string[]} [opts.channels]   channels to use
 * @returns {Promise<object>}          campaign summary
 */
async function runCampaign({ city, limit = BATCH_SIZE, channels = ['sms', 'whatsapp', 'email'] } = {}) {
  logger.info('Campaign starting', { city, limit, channels });

  const { leads } = await getLeads({
    noWebsite: true,
    city,
    outreachStatus: 'pending',
    limit,
  });

  if (!leads.length) {
    logger.info('No pending leads found for campaign');
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;

  for (const lead of leads) {
    const logs = await outreachLead(lead, channels);

    // Persist each channel log
    for (const entry of logs) {
      await logOutreach({ leadId: lead.id, placeId: lead.place_id, ...entry }).catch((e) =>
        logger.error('Failed to write outreach log', { error: e.message })
      );
    }

    // Mark lead as contacted if at least one channel succeeded
    const anySuccess = logs.some((l) => l.status === 'sent');
    if (anySuccess) {
      await markOutreachSent(lead.place_id, logs).catch(() => {});
      succeeded++;
    } else {
      failed++;
    }

    // Rate limit between leads
    await sleep(DELAY_MS);
  }

  const summary = { processed: leads.length, succeeded, failed, channels };
  logger.info('Campaign complete', summary);
  return summary;
}

module.exports = { outreachLead, runCampaign };
