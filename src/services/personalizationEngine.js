'use strict';

/**
 * Deterministic (no AI call) personalization sentence, stored on the lead
 * row as a piece of lead intelligence for whoever/whatever writes the
 * actual outreach copy later. Kept template-based rather than an OpenAI
 * call so scoring ~100 candidates/day doesn't cost anything -- the existing
 * aiMessageService.generateEmail is still what writes the real email at
 * send time, unchanged.
 */

const { getPainPointDescriptions } = require('./leadScorer');

const SERVICE_HOOKS = {
  'Website Development': 'not having a website at all means you\'re invisible to anyone searching online',
  'Website Revamp': 'your current site is quietly costing you trust (and Google ranking)',
  'AI Voice Receptionist': 'every missed call is a missed booking for a business like yours',
  'AI Calling': 'every missed call is a missed booking for a business like yours',
  'Appointment Automation': 'manual scheduling is eating time you could spend with clients',
  'AI Chatbot': 'visitors who don\'t call usually just leave without an easy way to reach you',
  'Lead Capture Automation': 'there\'s no way to capture interest from someone who isn\'t ready to call yet',
  CRM: 'there\'s no easy way to keep track of who\'s already reached out',
};

/**
 * @param {object} lead    { name, business_type }
 * @param {object} intel   { problems: string[], suggested_service: string }
 * @returns {string}
 */
function buildPersonalizationSentence(lead, intel) {
  const service = intel.suggested_service || 'CRM';
  const hook = SERVICE_HOOKS[service] || SERVICE_HOOKS.CRM;
  const painDescriptions = getPainPointDescriptions(intel.problems);
  const niche = lead.business_type || 'local business';

  const painClause = painDescriptions.length
    ? ` ${painDescriptions[0]}`
    : '';

  return `As a ${niche}, ${hook}.${painClause}`.trim();
}

module.exports = { buildPersonalizationSentence, SERVICE_HOOKS };
