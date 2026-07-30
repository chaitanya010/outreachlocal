'use strict';

/**
 * Score a lead based on how weak their digital presence is.
 * Higher score = worse digital presence = better sales prospect.
 *
 * Max score: 100
 *   No website:       40 pts
 *   Rating < 3:       25 pts  (poor reputation)
 *   Reviews < 5:      20 pts  (invisible in search)
 *   No booking:       15 pts  (losing appointments)
 */
function scoreLead(lead) {
  let score = 0;
  const problems = [];

  if (!lead.has_website || !lead.website) {
    score += 40;
    problems.push('no_website');
  }

  if (lead.rating !== null && lead.rating !== undefined && lead.rating < 3.0 && lead.rating > 0) {
    score += 25;
    problems.push('poor_ratings');
  }

  const reviews = lead.review_count || 0;
  if (reviews < 5) {
    score += 20;
    problems.push('no_reviews');
  } else if (reviews < 20) {
    score += 10;
    problems.push('few_reviews');
  }

  if (!lead.has_booking) {
    score += 15;
    problems.push('no_booking');
  }

  return { prospect_score: Math.min(score, 100), problems };
}

/**
 * Human-readable problem descriptions for cold outreach context.
 */
const PROBLEM_DESCRIPTIONS = {
  no_website:   'No website — customers cannot find them online or learn about their services.',
  poor_ratings: 'Rating below 3 stars — negative reviews are actively hurting their business.',
  no_reviews:   'Fewer than 5 reviews — virtually invisible in Google local search results.',
  few_reviews:  'Under 20 reviews — weak local SEO presence compared to competitors.',
  no_booking:   'No online booking — losing appointments to competitors who offer it.',
};

/**
 * Return a cold-call talking points string for a lead.
 */
function getColdCallContext(lead) {
  if (!lead.problems || !lead.problems.length) return '';
  return lead.problems
    .map((p) => PROBLEM_DESCRIPTIONS[p])
    .filter(Boolean)
    .join(' ');
}

module.exports = { scoreLead, getColdCallContext, PROBLEM_DESCRIPTIONS };
