'use strict';

const { Router } = require('express');
const { outreachLead, runCampaign } = require('../jobs/outreachQueue');
const { getLeads, getOutreachLogs } = require('../db/leadsRepository');
const { buildTwiml } = require('../services/callingService');
const { getCallScript } = require('../templates/messages');
const logger = require('../utils/logger');

const router = Router();

const VALID_CHANNELS = ['sms', 'whatsapp', 'email', 'call'];

// ─── POST /outreach/send ──────────────────────────────────────────────────────
/**
 * Send outreach to a single lead by place_id.
 *
 * Body: {
 *   place_id: string,
 *   channels?: ['sms','whatsapp','email','call']   default: ['sms','whatsapp','email']
 * }
 */
router.post('/outreach/send', async (req, res) => {
  const { place_id, channels = ['sms', 'whatsapp', 'email'] } = req.body;

  if (!place_id) return res.status(400).json({ error: 'place_id is required' });

  const invalidCh = channels.filter((c) => !VALID_CHANNELS.includes(c));
  if (invalidCh.length) return res.status(400).json({ error: `Invalid channels: ${invalidCh.join(', ')}` });

  try {
    const { leads } = await getLeads({ limit: 1 });
    // fetch specifically by place_id
    const { leads: found } = await getLeadsbyPlaceId(place_id);
    if (!found.length) return res.status(404).json({ error: 'Lead not found' });

    const lead = found[0];
    const logs = await outreachLead(lead, channels);

    return res.status(200).json({ success: true, place_id, results: logs });
  } catch (err) {
    logger.error('Single outreach error', { message: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /outreach/campaign ──────────────────────────────────────────────────
/**
 * Run a bulk outreach campaign.
 *
 * Body: {
 *   city?:     string,             filter to city
 *   limit?:    number,             max leads (default 50)
 *   channels?: string[]            default: ['sms','whatsapp','email']
 * }
 */
router.post('/outreach/campaign', async (req, res) => {
  const { city, limit = 50, channels = ['sms', 'whatsapp', 'email'] } = req.body;

  const invalidCh = channels.filter((c) => !VALID_CHANNELS.includes(c));
  if (invalidCh.length) return res.status(400).json({ error: `Invalid channels: ${invalidCh.join(', ')}` });

  // Run async — respond immediately with 202 so caller isn't blocked
  res.status(202).json({
    success: true,
    message: `Campaign started for ${city || 'all cities'} — up to ${limit} leads on [${channels.join(', ')}]`,
  });

  // Fire and forget (errors are logged internally)
  runCampaign({ city, limit: Math.min(limit, 500), channels }).catch((err) =>
    logger.error('Campaign error', { message: err.message })
  );
});

// ─── GET /outreach/logs ───────────────────────────────────────────────────────
/**
 * Retrieve outreach logs.
 * Query params: place_id?, channel?, status?, limit=100, offset=0
 */
router.get('/outreach/logs', async (req, res) => {
  const { place_id, channel, status, limit = '100', offset = '0' } = req.query;

  try {
    const { logs, total } = await getOutreachLogs({
      placeId: place_id,
      channel,
      status,
      limit: Math.min(parseInt(limit, 10) || 100, 500),
      offset: parseInt(offset, 10) || 0,
    });
    return res.status(200).json({ total, count: logs.length, logs });
  } catch (err) {
    logger.error('Outreach logs error', { message: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /outreach/stats ──────────────────────────────────────────────────────
/**
 * Aggregate outreach stats by channel and status.
 */
router.get('/outreach/stats', async (req, res) => {
  try {
    const { logs: all } = await getOutreachLogs({ limit: 5000 });

    const stats = VALID_CHANNELS.reduce((acc, ch) => {
      const chLogs = all.filter((l) => l.channel === ch);
      acc[ch] = {
        sent: chLogs.filter((l) => l.status === 'sent').length,
        failed: chLogs.filter((l) => l.status === 'failed').length,
        total: chLogs.length,
      };
      return acc;
    }, {});

    return res.status(200).json({ stats });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /webhooks/twiml ─────────────────────────────────────────────────────
/**
 * Twilio webhook: serves TwiML for outbound calls.
 * Twilio POSTs here when the called party picks up.
 */
router.post('/webhooks/twiml', (req, res) => {
  // Use a generic script — in production store per-call scripts in Redis/DB
  const script =
    process.env.DEFAULT_CALL_SCRIPT ||
    'Hello! We help local businesses get online with professional websites. Press 1 if you are interested, or hang up to opt out.';

  const twiml = buildTwiml(script);
  res.type('text/xml').send(twiml);
});

// ─── POST /webhooks/call-response ─────────────────────────────────────────────
/**
 * Twilio gather webhook: handles keypress from called party.
 */
router.post('/webhooks/call-response', (req, res) => {
  const { Digits, To } = req.body;
  const twilio = require('twilio');
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();

  if (Digits === '1') {
    response.say({ voice: 'Polly.Joanna' },
      'Fantastic! One of our team members will call you back shortly. Have a great day!');
    // TODO: flag lead as "interested" in DB
    logger.info('Call: lead pressed 1 (interested)', { phone: To });
  } else {
    response.say({ voice: 'Polly.Joanna' }, 'No problem. Have a wonderful day. Goodbye!');
  }

  res.type('text/xml').send(response.toString());
});

// ─── Internal helper ──────────────────────────────────────────────────────────

async function getLeadsbyPlaceId(placeId) {
  const { getClient } = require('../db/supabaseClient');
  const db = getClient();
  const { data, error } = await db.from('leads').select('*').eq('place_id', placeId).limit(1);
  if (error) throw error;
  return { leads: data };
}

module.exports = router;
