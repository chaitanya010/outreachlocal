'use strict';

/**
 * Cold calling service.
 *
 * Supports two providers — configure via CALL_PROVIDER env var:
 *   "twilio"  — Twilio Programmable Voice (plays TwiML message, free-form recording)
 *   "bland"   — Bland.ai (AI agent handles the full conversation autonomously)
 *
 * Default: twilio
 */

const twilio = require('twilio');
const axios = require('axios');
const logger = require('../utils/logger');

// ─── Twilio Voice ─────────────────────────────────────────────────────────────

let _twilioClient = null;
function getTwilioClient() {
  if (!_twilioClient) {
    _twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return _twilioClient;
}

/**
 * Build TwiML that reads the script aloud using Amazon Polly-backed <Say>.
 */
function buildTwiml(script) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();

  response.say({ voice: 'Polly.Joanna', language: 'en-US' }, script);

  // Gather a keypress response (press 1 = interested, any other = hang up)
  const gather = response.gather({ numDigits: 1, timeout: 10, action: process.env.TWILIO_GATHER_WEBHOOK || '/webhooks/call-response' });
  gather.say({ voice: 'Polly.Joanna' }, 'Press 1 if you are interested, or hang up to opt out.');

  response.say({ voice: 'Polly.Joanna' }, 'We did not receive a response. Goodbye!');
  return response.toString();
}

/**
 * Initiate a Twilio outbound call that plays a TwiML script.
 *
 * @param {string} to         E.164 phone number
 * @param {string} script     the spoken call script
 * @returns {Promise<{ callSid: string }>}
 */
async function callViaTwilio(to, script) {
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) throw new Error('TWILIO_PHONE_NUMBER is required');

  // Twilio needs a publicly accessible URL returning TwiML,
  // OR we can use a TwiML Bin URL. We embed the TwiML via twimlUrl approach.
  // For simplicity we use a Twilio TwiML Bin if configured, otherwise we
  // require TWILIO_TWIML_APP_SID + a webhook endpoint.
  const twimlBinUrl = process.env.TWILIO_TWIML_BIN_URL;

  const client = getTwilioClient();

  let callOpts = { to, from, method: 'POST' };

  if (twimlBinUrl) {
    callOpts.url = twimlBinUrl;
  } else {
    // Fall back: pass TwiML directly (requires Twilio to reach our server)
    const serverUrl = process.env.SERVER_URL;
    if (!serverUrl) throw new Error('Either TWILIO_TWIML_BIN_URL or SERVER_URL is required for calls');
    callOpts.url = `${serverUrl}/webhooks/twiml`;
    // Store script temporarily so the webhook can serve it (handled in routes)
  }

  const call = await client.calls.create(callOpts);
  logger.info('Call initiated via Twilio', { to, callSid: call.sid });
  return { callSid: call.sid };
}

// ─── Bland.ai Voice ───────────────────────────────────────────────────────────

/**
 * Dispatch an AI-powered call via Bland.ai.
 * The AI agent reads the task/script and handles the conversation autonomously.
 *
 * @param {string} to         E.164 phone number
 * @param {string} script     call task/goal prompt
 * @param {object} lead       full lead object (passed as variables to Bland)
 * @returns {Promise<{ callId: string }>}
 */
async function callViaBland(to, script, lead) {
  const apiKey = process.env.BLAND_API_KEY;
  if (!apiKey) throw new Error('BLAND_API_KEY is required for Bland.ai calls');

  const payload = {
    phone_number: to,
    task: script,
    voice: process.env.BLAND_VOICE_ID || 'maya',
    language: 'en',
    max_duration: 3,          // max 3 minutes
    wait_for_greeting: true,
    record: true,
    amd: true,                // answering machine detection — skip voicemails
    answered_by_enabled: true,
    metadata: {
      lead_id: lead.id,
      place_id: lead.place_id,
      business_name: lead.name,
      city: lead.city,
    },
    // Webhook to receive call outcome
    webhook: process.env.BLAND_WEBHOOK_URL || null,
  };

  const { data } = await axios.post('https://api.bland.ai/v1/calls', payload, {
    headers: { authorization: apiKey, 'Content-Type': 'application/json' },
  });

  logger.info('Call dispatched via Bland.ai', { to, callId: data.call_id });
  return { callId: data.call_id };
}

// ─── Unified Entry Point ──────────────────────────────────────────────────────

/**
 * Place a cold call to a lead using the configured provider.
 *
 * @param {string} phoneE164   E.164 number
 * @param {string} script      spoken script or AI task
 * @param {object} lead        full lead object
 * @returns {Promise<{ provider: string, id: string }>}
 */
async function placeCall(phoneE164, script, lead) {
  const provider = (process.env.CALL_PROVIDER || 'twilio').toLowerCase();

  if (provider === 'bland') {
    const result = await callViaBland(phoneE164, script, lead);
    return { provider: 'bland', id: result.callId };
  }

  const result = await callViaTwilio(phoneE164, script);
  return { provider: 'twilio', id: result.callSid };
}

module.exports = { placeCall, buildTwiml };
