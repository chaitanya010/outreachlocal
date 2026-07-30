'use strict';

/**
 * The full set of local-business niches the discovery pipeline rotates
 * through, replacing the old hardcoded 20-item DEFAULT_TYPES list. Each
 * entry is tagged with two booleans that feed leadScorer's ai_opportunity_score:
 *
 *  - callHeavy:        inbound phone calls are core to how customers reach
 *                       this business (emergencies, quotes, bookings by
 *                       phone) — high fit for an AI voice receptionist.
 *  - appointmentHeavy: the business runs on scheduled appointments/visits
 *                       — high fit for appointment automation / online
 *                       booking / reminders.
 *
 * Categories exist for readability and future filtering, not currently
 * used to change query behavior.
 */

const NICHES = [
  // ── Beauty & personal care ──
  { label: 'barbershop', category: 'beauty', callHeavy: false, appointmentHeavy: true },
  { label: 'nail salon', category: 'beauty', callHeavy: false, appointmentHeavy: true },
  { label: 'lash studio', category: 'beauty', callHeavy: false, appointmentHeavy: true },
  { label: 'brow studio', category: 'beauty', callHeavy: false, appointmentHeavy: true },
  { label: 'microblading studio', category: 'beauty', callHeavy: false, appointmentHeavy: true },
  { label: 'tattoo studio', category: 'beauty', callHeavy: false, appointmentHeavy: true },
  { label: 'hair transplant clinic', category: 'beauty', callHeavy: true, appointmentHeavy: true },
  { label: 'makeup studio', category: 'beauty', callHeavy: false, appointmentHeavy: true },
  { label: 'skincare center', category: 'beauty', callHeavy: false, appointmentHeavy: true },
  { label: 'tanning salon', category: 'beauty', callHeavy: false, appointmentHeavy: true },
  { label: 'hair salon', category: 'beauty', callHeavy: false, appointmentHeavy: true },
  { label: 'blowout bar', category: 'beauty', callHeavy: false, appointmentHeavy: true },
  { label: 'waxing studio', category: 'beauty', callHeavy: false, appointmentHeavy: true },

  // ── Health & wellness ──
  { label: 'massage therapy', category: 'wellness', callHeavy: false, appointmentHeavy: true },
  { label: 'chiropractic clinic', category: 'wellness', callHeavy: true, appointmentHeavy: true },
  { label: 'physiotherapy', category: 'wellness', callHeavy: true, appointmentHeavy: true },
  { label: 'physical therapy', category: 'wellness', callHeavy: true, appointmentHeavy: true },
  { label: 'weight loss clinic', category: 'wellness', callHeavy: true, appointmentHeavy: true },
  { label: 'wellness center', category: 'wellness', callHeavy: false, appointmentHeavy: true },
  { label: 'cryotherapy', category: 'wellness', callHeavy: false, appointmentHeavy: true },
  { label: 'iv therapy clinic', category: 'wellness', callHeavy: true, appointmentHeavy: true },
  { label: 'private therapy practice', category: 'wellness', callHeavy: true, appointmentHeavy: true },
  { label: 'occupational therapy', category: 'wellness', callHeavy: true, appointmentHeavy: true },
  { label: 'speech therapy', category: 'wellness', callHeavy: true, appointmentHeavy: true },
  { label: 'audiology clinic', category: 'wellness', callHeavy: true, appointmentHeavy: true },
  { label: 'med spa', category: 'wellness', callHeavy: true, appointmentHeavy: true },
  { label: 'beauty clinic', category: 'wellness', callHeavy: true, appointmentHeavy: true },
  { label: 'counseling center', category: 'wellness', callHeavy: true, appointmentHeavy: true },
  { label: 'child psychology practice', category: 'wellness', callHeavy: true, appointmentHeavy: true },
  { label: 'yoga studio', category: 'wellness', callHeavy: false, appointmentHeavy: true },
  { label: 'pilates studio', category: 'wellness', callHeavy: false, appointmentHeavy: true },
  { label: 'martial arts school', category: 'wellness', callHeavy: false, appointmentHeavy: true },

  // ── Medical / dental ──
  { label: 'dental clinic', category: 'medical', callHeavy: true, appointmentHeavy: true },
  { label: 'orthodontics practice', category: 'medical', callHeavy: true, appointmentHeavy: true },
  { label: 'dermatology clinic', category: 'medical', callHeavy: true, appointmentHeavy: true },
  { label: 'optometrist', category: 'medical', callHeavy: true, appointmentHeavy: true },
  { label: 'urgent care clinic', category: 'medical', callHeavy: true, appointmentHeavy: true },
  { label: 'medical imaging center', category: 'medical', callHeavy: true, appointmentHeavy: true },
  { label: 'diagnostic center', category: 'medical', callHeavy: true, appointmentHeavy: true },
  { label: 'dental lab', category: 'medical', callHeavy: true, appointmentHeavy: false },

  // ── Veterinary & pets ──
  { label: 'veterinary clinic', category: 'pets', callHeavy: true, appointmentHeavy: true },
  { label: 'animal hospital', category: 'pets', callHeavy: true, appointmentHeavy: true },
  { label: 'pet groomer', category: 'pets', callHeavy: false, appointmentHeavy: true },
  { label: 'pet boarding', category: 'pets', callHeavy: true, appointmentHeavy: true },
  { label: 'dog training', category: 'pets', callHeavy: false, appointmentHeavy: true },

  // ── Home services (skilled trades) ──
  { label: 'auto detailer', category: 'home_services', callHeavy: false, appointmentHeavy: true },
  { label: 'window tinting shop', category: 'home_services', callHeavy: false, appointmentHeavy: true },
  { label: 'roofing company', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'hvac company', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'electrician', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'plumber', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'landscaping company', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'tree service', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'water damage restoration', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'mold removal company', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'garage door company', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'pool cleaning service', category: 'home_services', callHeavy: true, appointmentHeavy: true },
  { label: 'pest control company', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'cleaning company', category: 'home_services', callHeavy: true, appointmentHeavy: true },
  { label: 'carpet cleaning service', category: 'home_services', callHeavy: true, appointmentHeavy: true },
  { label: 'window cleaning service', category: 'home_services', callHeavy: true, appointmentHeavy: true },
  { label: 'commercial cleaning company', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'commercial security company', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'commercial hvac company', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'commercial roofing company', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'commercial plumbing company', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'locksmith', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'appliance repair service', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'flooring company', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'kitchen remodeler', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'kitchen showroom', category: 'home_services', callHeavy: false, appointmentHeavy: true },
  { label: 'solar company', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'moving company', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'car wash', category: 'home_services', callHeavy: false, appointmentHeavy: false },
  { label: 'boat repair shop', category: 'home_services', callHeavy: true, appointmentHeavy: false },
  { label: 'rv repair shop', category: 'home_services', callHeavy: true, appointmentHeavy: false },

  // ── Care & education ──
  { label: 'home care agency', category: 'care', callHeavy: true, appointmentHeavy: true },
  { label: 'senior care agency', category: 'care', callHeavy: true, appointmentHeavy: true },
  { label: 'daycare center', category: 'care', callHeavy: true, appointmentHeavy: false },
  { label: 'tutoring center', category: 'care', callHeavy: false, appointmentHeavy: true },
  { label: 'music school', category: 'care', callHeavy: false, appointmentHeavy: true },
  { label: 'dance studio', category: 'care', callHeavy: false, appointmentHeavy: true },
  { label: 'private school', category: 'care', callHeavy: true, appointmentHeavy: false },
  { label: 'sports academy', category: 'care', callHeavy: false, appointmentHeavy: true },
  { label: 'driving school', category: 'care', callHeavy: false, appointmentHeavy: true },

  // ── Events & venues ──
  { label: 'wedding venue', category: 'events', callHeavy: true, appointmentHeavy: true },
  { label: 'photographer', category: 'events', callHeavy: false, appointmentHeavy: true },
  { label: 'event planner', category: 'events', callHeavy: true, appointmentHeavy: true },
  { label: 'wedding dj', category: 'events', callHeavy: true, appointmentHeavy: true },
  { label: 'catering company', category: 'events', callHeavy: true, appointmentHeavy: false },
  { label: 'escape room', category: 'events', callHeavy: false, appointmentHeavy: true },
  { label: 'mini golf venue', category: 'events', callHeavy: false, appointmentHeavy: false },

  // ── Real estate & finance ──
  { label: 'real estate team', category: 'finance', callHeavy: true, appointmentHeavy: true },
  { label: 'mortgage broker', category: 'finance', callHeavy: true, appointmentHeavy: true },
  { label: 'insurance agency', category: 'finance', callHeavy: true, appointmentHeavy: true },
  { label: 'tax consultant', category: 'finance', callHeavy: true, appointmentHeavy: true },
  { label: 'cpa firm', category: 'finance', callHeavy: true, appointmentHeavy: true },
  { label: 'immigration lawyer', category: 'finance', callHeavy: true, appointmentHeavy: true },
  { label: 'bankruptcy lawyer', category: 'finance', callHeavy: true, appointmentHeavy: true },
  { label: 'property management company', category: 'finance', callHeavy: true, appointmentHeavy: false },
  { label: 'hoa management company', category: 'finance', callHeavy: true, appointmentHeavy: false },
  { label: 'vacation rental manager', category: 'finance', callHeavy: true, appointmentHeavy: false },

  // ── Retail & misc ──
  { label: 'storage facility', category: 'retail', callHeavy: true, appointmentHeavy: false },
  { label: 'furniture store', category: 'retail', callHeavy: false, appointmentHeavy: false },
  { label: 'funeral home', category: 'retail', callHeavy: true, appointmentHeavy: true },
];

/** Category → label list, for anything that wants to filter by group. */
const CATEGORIES = [...new Set(NICHES.map((n) => n.category))];

function getNiches() {
  return NICHES;
}

function getNicheByLabel(label) {
  return NICHES.find((n) => n.label === label);
}

module.exports = { NICHES, CATEGORIES, getNiches, getNicheByLabel };
