'use strict';

/**
 * Extends prospectScorer's "how weak is their digital presence" score with
 * an ai_opportunity_score aimed specifically at the 8 services StanWeb
 * sells (AI Voice Receptionist, AI Calling, Appointment Automation, CRM,
 * Website Revamp, Website Development, Lead Capture Automation, AI
 * Chatbot) -- a business can have a fine digital presence by
 * prospectScorer's measure and still be a great AI-voice-receptionist fit
 * (busy, appointment-heavy, phone-driven, no automation), which is exactly
 * the gap this pipeline redesign is meant to target.
 */

const { scoreLead, PROBLEM_DESCRIPTIONS } = require('./prospectScorer');

const SITE_PAIN_DESCRIPTIONS = {
  no_https: 'Site has no HTTPS/SSL — looks untrustworthy and is penalized by Google.',
  no_mobile_responsive: 'Site is not mobile-responsive — most local search traffic is on phones.',
  outdated_wordpress: 'Old WordPress theme with no modern mobile layout — overdue for a rebuild.',
  no_booking_widget: 'No online booking widget — every appointment has to be scheduled by phone.',
  no_chat_widget: 'No chatbot/live chat — visitors who don\'t call just leave.',
};

const ALL_PROBLEM_DESCRIPTIONS = { ...PROBLEM_DESCRIPTIONS, ...SITE_PAIN_DESCRIPTIONS };

/**
 * @param {object} lead        normalized candidate (has_website, website, rating,
 *                              review_count, has_booking, phone, ...)
 * @param {object} [niche]     nicheLibrary entry: { label, callHeavy, appointmentHeavy }
 * @param {object} [siteSignals]  websiteAnalyzer.fetchAndAnalyze(...).signals, if lead has a site
 * @returns {{ prospect_score: number, ai_opportunity_score: number, problems: string[], suggested_service: string }}
 */
function scoreLeadForDiscovery(lead, niche, siteSignals) {
  const { prospect_score, problems: baseProblems } = scoreLead(lead);
  const problems = [...baseProblems];
  let score = 0;

  const hasWebsite = !!(lead.has_website && lead.website);
  const callHeavy = !!niche?.callHeavy;
  const appointmentHeavy = !!niche?.appointmentHeavy;

  if (!hasWebsite) score += 20; // Website Development opportunity
  if (callHeavy) score += 25; // AI Voice Receptionist / AI Calling fit
  if (appointmentHeavy) score += 20; // Appointment Automation fit
  if (!hasWebsite && lead.phone) score += 15; // phone is their only channel right now

  if ((lead.review_count || 0) >= 20) score += 10; // established, more inbound volume, more budget

  if (hasWebsite && siteSignals) {
    if (!siteSignals.https) {
      score += 5;
      problems.push('no_https');
    }
    if (!siteSignals.mobileResponsive) {
      score += 5;
      problems.push('no_mobile_responsive');
    }
    if (siteSignals.isWordpress && !siteSignals.mobileResponsive) {
      score += 5;
      problems.push('outdated_wordpress');
    }
    if (!siteSignals.hasBookingWidget && !lead.has_booking) {
      score += 15;
      problems.push('no_booking_widget');
    }
    if (!siteSignals.hasChatWidget) {
      score += 10;
      problems.push('no_chat_widget');
    }
  }

  return {
    prospect_score,
    ai_opportunity_score: Math.min(score, 100),
    problems: [...new Set(problems)],
    suggested_service: suggestService({ hasWebsite, niche, lead, siteSignals }),
  };
}

/**
 * Picks the single best-fit offering out of the 8 StanWeb sells, in priority
 * order from "most fundamental gap" to "nice-to-have automation."
 */
function suggestService({ hasWebsite, niche, lead, siteSignals }) {
  if (!hasWebsite) return 'Website Development';
  if (siteSignals && !siteSignals.https) return 'Website Revamp';
  if (niche?.callHeavy) return 'AI Voice Receptionist';
  if (niche?.appointmentHeavy && !lead.has_booking) return 'Appointment Automation';
  if (siteSignals && !siteSignals.hasChatWidget) return 'AI Chatbot';
  if (siteSignals && !siteSignals.hasBookingWidget) return 'Lead Capture Automation';
  return 'CRM';
}

function getPainPointDescriptions(problems) {
  return (problems || []).map((p) => ALL_PROBLEM_DESCRIPTIONS[p]).filter(Boolean);
}

module.exports = { scoreLeadForDiscovery, suggestService, getPainPointDescriptions, ALL_PROBLEM_DESCRIPTIONS };
