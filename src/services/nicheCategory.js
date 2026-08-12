'use strict';

/**
 * Behavioral category for a business type -- the decoy opener strategy
 * (aiMessageService.generateDecoyOpener) depends on the question being
 * plausible for that TYPE of business, not just personalized by name. "What
 * time do you close today?" reads as a genuine customer question to a salon
 * or clinic; to a logistics company or insurance agency it doesn't make
 * sense at all (they don't have walk-in "closing hours"), which makes the
 * whole decoy implausible and likely to be ignored rather than answered.
 *
 * Also used as the fallback offer/outcome angle (aiMessageService's
 * INDUSTRY_OFFERS/NICHE_OUTCOMES) for any business_type not specifically
 * mapped there -- a category-relevant fallback beats one generic fallback
 * shared by every unmapped industry.
 *
 * Keyword-substring match against lead.business_type; first category whose
 * keyword list matches wins. Defaults to appointment_consumer (the original
 * target market: local consumer-facing businesses) for anything
 * unrecognized, since that's the safest generic assumption.
 */

const CATEGORY_KEYWORDS = {
  emergency_home_service: [
    'hvac', 'plumb', 'electric', 'roofing', 'pest control', 'locksmith',
    'appliance repair', 'restoration', 'water damage', 'garage door',
    'security gate', 'security door', 'tree service',
  ],
  hospitality_food: [
    'restaurant', 'food & beverage', 'hospitality', 'event planner',
    'catering', 'bar', 'tavern', 'nightclub', 'brewery', 'winery', 'cafe',
  ],
  b2b_industrial: [
    'warehousing', 'machinery', 'wholesale', 'building materials',
    'automotive', 'facilities services', 'staffing', 'recruiting',
    'manufacturing', 'logistics', 'transportation', 'defense', 'industrial',
    'fabrication', 'welding', 'security company',
  ],
  b2b_professional: [
    'construction', 'information technology', 'it services', 'design',
    'financial services', 'law practice', 'immigration', 'marketing',
    'advertising', 'management consulting', 'insurance', 'mortgage',
    'real estate', 'cpa', 'accounting', 'attorney', 'law firm', 'consulting',
    'property management',
  ],
};

function categoryForLead(lead) {
  const type = (lead.business_type || '').toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((k) => type.includes(k))) return category;
  }
  return 'appointment_consumer';
}

module.exports = { categoryForLead, CATEGORY_KEYWORDS };
