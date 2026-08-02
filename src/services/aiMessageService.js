'use strict';

const OpenAI = require('openai');
const logger = require('../utils/logger');
const { unsubHeaders } = require('../utils/unsubscribe');
const { buildSignature } = require('../utils/signature');
const { getColdCallContext } = require('./prospectScorer');
const { ALL_PROBLEM_DESCRIPTIONS } = require('./leadScorer');

let client = null;

function getClient() {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

const BUSINESS_URL = 'https://stanweb.tech';
const CONTACT_EMAIL = 'contact@stanweb.tech';
const DEMO_URL = 'https://drive.google.com/file/d/12xwAxV67KphVVCknpa_U3gALSmFZuRuj/view?usp=sharing';

const SYSTEM_PROMPT = `You are an outreach specialist for StanWeb.tech, a web agency that builds
professional websites and end-to-end appointment systems for local businesses like salons, spas,
clinics, and med spas.

Our offer includes:
- Custom professional website
- Online booking + appointment scheduling system
- Payment integration
- AI chatbot for client engagement
- Email automation
- Google Calendar sync

Demo of our work: ${DEMO_URL}
Book a call or see our work: ${BUSINESS_URL}
Direct contact: ${CONTACT_EMAIL}

Rules:
- Be friendly, short, and direct
- Never sound like a mass blast — reference their specific business name and type
- Never use buzzwords like "skyrocket", "game-changer", "leverage"
- Always sound human, like a real person reaching out`;

/**
 * Generate a personalized SMS message for a lead (max 155 chars to leave room for STOP footer).
 */
async function generateSms(lead) {
  const prompt = `Write a cold outreach SMS to ${lead.name}, a ${lead.business_type || 'local business'} in ${lead.city}.
They currently have no website.
Pitch: we'll build them a professional website + online booking system.
Max 155 characters. No emojis. End with nothing — the STOP opt-out is added automatically.
Just the message text, nothing else.`;

  try {
    const res = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      max_tokens: 100,
      temperature: 0.8,
    });

    const text = res.choices[0].message.content.trim();
    // Append STOP footer for TCPA compliance
    return `${text}\n\nReply STOP to opt out.`;
  } catch (err) {
    logger.error('AI SMS generation failed, using fallback', { message: err.message });
    return `Hi ${lead.name}, we help ${lead.business_type || 'local businesses'} get a professional website + online booking. See our work: ${BUSINESS_URL} — Reply STOP to opt out.`;
  }
}

/**
 * Generate a personalized WhatsApp message for a lead.
 */
async function generateWhatsApp(lead) {
  const prompt = `Write a cold outreach WhatsApp message to ${lead.name}, a ${lead.business_type || 'local business'} in ${lead.city}.
They currently have no website.
Pitch: we build professional websites + appointment booking systems for businesses like theirs.
Max 300 characters. Friendly and conversational. You can use 1-2 relevant emojis.
Include our website ${BUSINESS_URL} naturally.
Just the message text, nothing else.`;

  try {
    const res = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      max_tokens: 150,
      temperature: 0.8,
    });

    return res.choices[0].message.content.trim();
  } catch (err) {
    logger.error('AI WhatsApp generation failed, using fallback', { message: err.message });
    return `Hi ${lead.name}! We help ${lead.business_type || 'local businesses'} like yours get a professional website + online booking system. Check out our demo: ${DEMO_URL} — book a free call at ${BUSINESS_URL}`;
  }
}

// Cold-email specific system prompt: plain text, human, brief. Deliberately
// separate from SYSTEM_PROMPT (used by SMS/WhatsApp/call script) since those
// channels have their own established formats. Live testing (real sends,
// checking inbox vs Promotions) established that a company self-intro
// ("At StanWeb, we...") or naming a PRODUCT/service ("AI voice calling", "AI
// receptionist") reliably reads as marketing language and lands in
// Promotions -- so this describes the CAPABILITY in plain human language
// instead of naming the thing: "something that picks up" / "answers
// automatically" rather than "AI voice calling system". Earlier version of
// this prompt also claimed "other businesses already have this" as an
// urgency lever -- dropped: that's an unverifiable competitor claim (a real
// deceptive-advertising risk, not just a deliverability one), replaced with
// a possibility-framed outcome estimate instead, per direct instruction.
const EMAIL_SYSTEM_PROMPT = `You write short, direct cold outreach emails on behalf of Chaitanya, who helps local
businesses stop losing customers to missed calls -- including after-hours calls and two
calls at once.

Rules -- follow all of these exactly:
- Write like a real 1:1 email from one person to another business owner, not a company
  pitch. Do not name the company ("StanWeb"), do not use product/feature names like
  "AI voice calling", "AI receptionist", "system", "software", "solution", or "platform"
  -- describe what happens in plain human words instead (e.g. "something that only steps
  in when a call would otherwise go unanswered -- after hours, or if you're already on
  another line -- and sounds enough like a real person that most callers can't tell the
  difference") never the name of the thing.
- Two specific facts to weave in naturally (not as a checklist, not both forced into
  every email -- pick whichever fits the sentence): (a) it ONLY picks up calls that would
  otherwise be missed -- unanswered or after hours -- it doesn't replace anyone picking up
  normally; (b) the voice sounds like a real person, genuinely hard to tell apart from a
  human answering.
- Structure: (1) a short, genuine QUESTION about what happens when someone calls during
  a specific moment (busy, after hours, etc) -- an actual question, not a claim, (2) one
  plain-language sentence describing what happens instead, working in one of the two
  facts above, (3) one sentence framing a POSSIBLE outcome using the specific number and
  outcome word given to you below, worded as a possibility ("could mean", "might add up
  to") -- never a guarantee, and never a claim about competitors or results already
  produced for them, (4) end asking if it's worth hearing what it would sound like for
  their business.
- Never invent facts, results, or competitor claims -- only use the specific detail
  given to you below, and only if it fits naturally.
- 50-80 words total, short sentences/paragraphs. Plain text only, no HTML, no emojis, no
  bold, no bullet lists, no ALL CAPS, no fake urgency words like "act now" or "limited
  time".
- Do not include a signature or sign-off -- that's added separately.
- Do not include any links in the body text.`;

// Subset of the spec's "SERVICES TO OFFER" table — keyed by business_type so the
// AI pitch stays relevant per-industry without an extra AI call.
const INDUSTRY_OFFERS = {
  hvac: '24/7 emergency call answering and dispatch automation',
  plumbing: '24/7 emergency call answering and dispatch automation',
  electrician: '24/7 emergency call answering and dispatch automation',
  restoration: 'after-hours emergency call answering so a burst pipe at 2am still books the job',
  'water damage': 'after-hours emergency call answering so a burst pipe at 2am still books the job',
  veterinary: 'emergency appointment routing so after-hours calls don\'t go to voicemail',
  'urgent care': 'AI receptionist for instant appointment booking',
  'physical therapy': 'AI receptionist for instant appointment booking',
  dental: 'AI receptionist with HIPAA-conscious appointment booking',
  orthodontics: 'AI receptionist with HIPAA-conscious appointment booking',
  dermatology: 'AI receptionist with HIPAA-conscious appointment booking',
  'law firm': 'lead qualification and consultation scheduling',
  attorney: 'lead qualification and consultation scheduling',
  'funeral home': 'compassionate after-hours answering for families who call at any hour',
  cpa: 'automated tax appointment scheduling',
  accounting: 'automated tax appointment scheduling',
  'property management': 'an AI leasing assistant plus maintenance-request triage',
  'home health': 'automated patient intake',
  'equipment rental': 'automated rental scheduling and inventory inquiries',
  'pest control': '24/7 emergency call answering and dispatch automation',
  locksmith: '24/7 emergency call answering and dispatch automation',
  roofing: '24/7 emergency call answering and dispatch automation',
};

function offerForLead(lead) {
  const type = (lead.business_type || '').toLowerCase();
  const match = Object.keys(INDUSTRY_OFFERS).find((k) => type.includes(k));
  return match
    ? INDUSTRY_OFFERS[match]
    : 'picking up calls that would otherwise go unanswered -- missed or after hours -- with a voice that sounds real enough that callers usually can\'t tell';
}

// `offer` (from offerForLead/INDUSTRY_OFFERS) is deliberately used only as an
// internal angle hint below, never as text to quote or name-drop in the
// email itself -- naming specific services/tools is exactly what pushed
// every earlier version into Promotions.

// Niche-specific outcome word for the "5-10 additional {{outcome}}/month"
// possibility framing -- dentists lose patients, salons lose bookings, gyms
// lose members, home services lose jobs/service calls, and so on. Falls back
// to "appointments" for anything unmapped.
const NICHE_OUTCOMES = {
  dental: 'patients', orthodontics: 'patients', dermatology: 'patients', 'urgent care': 'patients',
  'physical therapy': 'patients', chiropractic: 'patients', optometrist: 'patients', 'medical imaging': 'patients',
  veterinary: 'appointments', 'animal hospital': 'appointments',
  spa: 'bookings', 'med spa': 'bookings', salon: 'bookings', 'nail salon': 'bookings', 'hair salon': 'bookings',
  barbershop: 'bookings', massage: 'bookings', waxing: 'bookings', tanning: 'bookings', 'lash studio': 'bookings',
  gym: 'members', fitness: 'members', 'martial arts': 'members', yoga: 'members', pilates: 'members',
  hvac: 'service calls', plumbing: 'service calls', electrician: 'service calls', 'pest control': 'service calls',
  locksmith: 'service calls', 'appliance repair': 'service calls',
  roofing: 'jobs', landscaping: 'jobs', 'tree service': 'jobs', flooring: 'jobs', remodeler: 'jobs',
  cleaning: 'bookings', 'carpet cleaning': 'bookings', 'window cleaning': 'bookings',
  'law firm': 'consultations', attorney: 'consultations', 'real estate': 'appointments', mortgage: 'consultations',
  insurance: 'consultations', cpa: 'appointments', accounting: 'appointments',
  'daycare': 'enrollments', tutoring: 'enrollments', 'driving school': 'enrollments',
};

function outcomeForLead(lead) {
  const type = (lead.business_type || '').toLowerCase();
  const match = Object.keys(NICHE_OUTCOMES).find((k) => type.includes(k));
  return match ? NICHE_OUTCOMES[match] : 'appointments';
}

// stage: 1=intro (day 0), 2=value (day 3), 3=free redesign offer (day 7), 4=last touch (day 14)
//
// Each stage uses a distinct persuasion structure (Follow-Up Ladder / Multi-Angle
// Follow-Up strategy) so a lead who doesn't reply to stage 1 sees a genuinely
// different angle each time, not the same ask reworded. All four stay inside the
// same hard constraint proven to land in the Inbox: no company name, no service
// list, no links, one CTA, no fabricated competitor claims. "Selling" happens
// through structure, specificity, and a possibility-framed (never guaranteed)
// outcome estimate, not through richer content or unverifiable claims.
const STAGE_ANGLES = {
  1: (offer, outcome) =>
    `This is the FIRST email -- follow the (1)(2)(3)(4) structure from the system prompt
exactly. The outcome word for step 3 is "${outcome}" -- frame it as a possibility, e.g.
"could mean 5-10 additional ${outcome} a month," never a guarantee. If the observation
below fits naturally as the specific business detail behind the question, use it;
otherwise keep the question general to their line of work. (Internal detail, only if it
fits naturally, never name it as a product: ${offer})`,
  2: (offer, outcome) =>
    `This is a brief FOLLOW-UP (their 2nd email, no reply yet). Different angle from the
first: instead of asking what happens on a call, ask directly whether missed calls
during busy hours or after-hours are something that actually happens for them --
genuinely curious, not assuming. Still frame the possible outcome using "${outcome}" as
a possibility, not a guarantee, and end with the same worth-hearing-more close.
(Internal detail, only if it fits naturally: ${offer})`,
  3: (offer, outcome) =>
    `This is a brief FOLLOW-UP (their 3rd email, no reply yet). Quick Before/After in
plain language -- calls going unanswered now vs. every call picked up and booked
automatically, day or night, possibly adding up to a few more ${outcome} a month -- then
make it low-effort to say yes: ask if they'd be open to just seeing how it'd work for
their business, no pressure. (Internal detail, only if it fits naturally: ${offer})`,
  4: () =>
    `This is the LAST email (their 4th, no reply yet) -- a brief, polite breakup note.
No urgency framing here, just an honest, low-pressure check: maybe the timing's just not
right, totally fine either way, thank them for their time, leave the door open.`,
};

function stringHash(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash;
}

/** Deterministic pick from a list, keyed by a string, returning the index —
 * same lead+stage always gets the same subject variant (reproducible), but
 * spreads across variants as leads/stages vary. Returning the index (rather
 * than the value) lets the caller log which variant was sent, so reply rate
 * can later be broken down per variant. */
function pickVariantIndex(key, length) {
  if (!length) return -1;
  return stringHash(key) % length;
}

/**
 * One Pain Per Email: deterministically pick a single problem key from the
 * lead's measured `problems` (prospectScorer/leadScorer), rotating which one
 * gets cited as stage advances so a 4-email sequence to the same lead surfaces
 * a different specific angle each time instead of repeating the same pain.
 */
function pickPainPoint(lead, stage) {
  const problems = lead.problems || [];
  if (!problems.length) return null;
  const idx = (stringHash(String(lead.place_id || lead.name)) + stage) % problems.length;
  return problems[idx];
}

/**
 * The one genuine, fact-grounded observation to personalize with — pulled
 * from measured signals only (prospectScorer/leadScorer problems, or the
 * discovery pipeline's precomputed personalization_sentence), never invented.
 * Stage 1 prefers the discovery pipeline's pre-built sentence (already the
 * single best fact); every stage falls back to one specific rotated pain
 * point instead of the same generic summary, per Pain Point Selling /
 * One Pain Per Email.
 */
function factualObservation(lead, stage, painKey) {
  if (stage === 1 && lead.personalization_sentence) return lead.personalization_sentence;
  if (painKey && ALL_PROBLEM_DESCRIPTIONS[painKey]) return ALL_PROBLEM_DESCRIPTIONS[painKey];
  return lead.personalization_sentence || getColdCallContext(lead);
}

function greetingName(lead) {
  if (!lead.decision_maker_name) return null;
  return lead.decision_maker_name.replace(/^dr\.\s*/i, '').split(/\s+/)[0];
}

// Fixed A/B subject pair for the stage-1 base email, per direct spec --
// deterministically split (not AI-generated) so it's a controlled comparison
// rather than 5 loosely-varied AI options.
const STAGE1_SUBJECT_VARIANTS = ['how are calls handled?', 'quick question about calls'];

// ─── Decoy opener + reply-triggered pivot ──────────────────────────────────────
//
// Deliberately NOT AI-generated and NOT run through the pitch system prompt
// above -- this is meant to read as a genuine one-line question from a
// prospective customer, not an outreach email, so a business owner replies
// (e.g. to a "what time do you close?" message) before knowing it's outreach
// at all. Two near-identical variants for the stage-1 (day 0) and stage-2
// (day 2, if no reply) sends, per direct instruction. No AI call needed --
// keeping it this minimal is the whole point.
const DECOY_OPENERS = [
  (lead) => `Hi, what time does ${lead.name} close today?`,
  (lead) => `Hey — are you open right now, or what time do you close today?`,
];

function generateDecoyOpener(lead, senderFirstName, stage = 1) {
  const body = DECOY_OPENERS[(stage - 1) % DECOY_OPENERS.length](lead);
  const headers = lead.email ? unsubHeaders(lead.email) : undefined;
  return { subject: 'quick question', text: assembleEmailText(body, senderFirstName), headers, subjectVariant: -1, painPoint: null };
}

/**
 * The reveal, sent once (see email_pivot_sent) as soon as a reply to the
 * decoy opener is detected (replyWatcher.js) -- pivots from the customer-
 * sounding question to the actual reason for reaching out, with the deck
 * attached (attachment is added by the caller, not here -- see
 * emailSequence.js / replyWatcher.js). Unlike the cold-open copy above,
 * naming what this actually is is expected and honest here: the recipient
 * already replied, so it's a live conversation, not a cold pitch anymore.
 *
 * @param {string} [opener]  optional opener line replacing the fixed default
 *   (see personalizePivotOpener) -- falls back to the proven fixed line if
 *   not given or empty.
 */
function generatePivotEmail(lead, senderFirstName, opener) {
  const openerLine = opener || 'Ah, sorry — didn\'t mean to be cryptic there!';
  const body = `${openerLine} I actually help businesses like ${lead.name} that are missing calls when they can't pick up, so those clients don't just go to someone else instead.

Thought I'd share a quick one-pager on how it works.

Would it be worth a short chat to see if it's a fit for you?`;
  const headers = lead.email ? unsubHeaders(lead.email) : undefined;
  return { subject: 'Re: quick question', text: assembleEmailText(body, senderFirstName), headers, subjectVariant: -1, painPoint: null };
}

// ─── Reply classification (decoy-stage inbound triage) ─────────────────────

const CLASSIFY_SYSTEM_PROMPT = `You classify a single inbound email reply to a short cold-outreach
question ("what time do you close today?"). Categorize the reply's intent.

Categories:
- "interested": a genuine reply from the business owner/staff -- answering the question,
  asking who's asking, or anything that reads like a real person engaging (even briefly
  or skeptically).
- "not_interested": explicitly asking to stop, unsubscribe, remove them, or a hostile/annoyed
  reply making clear they don't want further contact.
- "auto_reply": an automated system message -- out-of-office, vacation responder, delivery
  failure/bounce notice, "this inbox is not monitored", etc.
- "other": anything ambiguous, empty, or that doesn't clearly fit the above.

Return JSON: {"intent": "interested" | "not_interested" | "auto_reply" | "other"}`;

/**
 * Classify an inbound reply's intent so replyWatcher.js can route it
 * (pivot / suppress / ignore) instead of treating every reply as interest.
 * Falls back to "interested" on any AI error or empty body -- consistent
 * with every other AI call in this file: never let a broken AI call silently
 * drop what might be a real reply.
 * @param {string} bodyText  reply body, quoted original already stripped
 * @param {string} subject
 * @returns {Promise<'interested'|'not_interested'|'auto_reply'|'other'>}
 */
async function classifyReply(bodyText, subject) {
  const text = (bodyText || '').trim();
  if (!text) return 'interested';

  try {
    const res = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: CLASSIFY_SYSTEM_PROMPT },
        { role: 'user', content: `Subject: ${subject || '(none)'}\n\nBody:\n${text.slice(0, 2000)}` },
      ],
      max_tokens: 20,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(res.choices[0].message.content);
    const valid = ['interested', 'not_interested', 'auto_reply', 'other'];
    return valid.includes(parsed.intent) ? parsed.intent : 'interested';
  } catch (err) {
    logger.error('AI reply classification failed, defaulting to interested', { message: err.message });
    return 'interested';
  }
}

/**
 * Generate a one-sentence opener acknowledging what the lead actually wrote,
 * to replace the fixed pivot opener line. Falls back to null (caller uses
 * the fixed default) on any AI error or empty body.
 * @param {string} replyText  the lead's reply, quoted original stripped
 * @param {string} leadName
 * @returns {Promise<string|null>}
 */
async function personalizePivotOpener(replyText, leadName) {
  const text = (replyText || '').trim();
  if (!text) return null;

  const prompt = `A business owner at ${leadName} replied "${text.slice(0, 500)}" to a casual question
("what time do you close today?"). Write ONE short, warm, conversational sentence
acknowledging their reply before pivoting to explain why you actually reached out
(e.g. thanking them for the hours, or reacting naturally if they asked who this is).
No more than 15 words. Plain text, no quotes around it, no emojis.`;

  try {
    const res = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You write short, natural, human email opener lines. Never sound scripted.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 40,
      temperature: 0.7,
    });

    const opener = res.choices[0].message.content.trim();
    return opener || null;
  } catch (err) {
    logger.error('AI pivot opener personalization failed, using default', { message: err.message });
    return null;
  }
}

// ─── Booking-link flow (post-pivot reply -> demo booked) ───────────────────

const CLASSIFY_POST_PIVOT_SYSTEM_PROMPT = `You classify a single inbound email reply to a pivot/reveal
email that ended by asking "would it be worth a short chat to see if it's a fit for you?".
Categorize the reply's intent.

Categories:
- "wants_meeting": a clear yes / agreement to talk, or they're asking how/when to schedule --
  anything that reads as ready to book a call.
- "not_interested": explicitly declining, asking to stop/unsubscribe/remove them, or hostile.
- "auto_reply": an automated system message -- out-of-office, vacation responder, delivery
  failure/bounce notice, "this inbox is not monitored", etc.
- "other": a real question, hesitation, or anything ambiguous that isn't a clear yes or no --
  needs a human reply, not an automated one.

Return JSON: {"intent": "wants_meeting" | "not_interested" | "auto_reply" | "other"}`;

/**
 * Classify a reply to the pivot/reveal email so replyWatcher.js can decide
 * whether to send the booking link automatically. Falls back to "other" (not
 * "wants_meeting") on any AI error or empty body -- unlike classifyReply's
 * fallback, sending a calendar link on a broken classification is worse here
 * than just staying silent and letting it get flagged for manual follow-up.
 * @param {string} bodyText  reply body, quoted original already stripped
 * @param {string} subject
 * @returns {Promise<'wants_meeting'|'not_interested'|'auto_reply'|'other'>}
 */
async function classifyPostPivotReply(bodyText, subject) {
  const text = (bodyText || '').trim();
  if (!text) return 'other';

  try {
    const res = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: CLASSIFY_POST_PIVOT_SYSTEM_PROMPT },
        { role: 'user', content: `Subject: ${subject || '(none)'}\n\nBody:\n${text.slice(0, 2000)}` },
      ],
      max_tokens: 20,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(res.choices[0].message.content);
    const valid = ['wants_meeting', 'not_interested', 'auto_reply', 'other'];
    return valid.includes(parsed.intent) ? parsed.intent : 'other';
  } catch (err) {
    logger.error('AI post-pivot reply classification failed, defaulting to other', { message: err.message });
    return 'other';
  }
}

/**
 * The booking email -- sent once (see booking_sent) as soon as a reply to
 * the pivot signals real interest (classifyPostPivotReply === 'wants_meeting').
 * Fixed template rather than open-ended AI body copy (only the opener line is
 * AI-personalized, via personalizePivotOpener reused here) -- keeps the
 * actual booking ask low-risk and consistent, same philosophy as
 * generatePivotEmail.
 * @param {string} [opener]  optional opener line (see personalizePivotOpener)
 */
function generateBookingEmail(lead, senderFirstName, opener) {
  const openerLine = opener || 'Great, glad to hear it!';
  const calendlyUrl = process.env.CALENDLY_URL;
  const bookingLine = calendlyUrl
    ? `Here's my calendar -- grab whatever time works best for a quick call: ${calendlyUrl}`
    : `Let me know a good day/time this week and I'll send over an invite.`;
  const body = `${openerLine} ${bookingLine}\n\nTalk soon!`;
  const headers = lead.email ? unsubHeaders(lead.email) : undefined;
  return { subject: 'Re: quick question', text: assembleEmailText(body, senderFirstName), headers, subjectVariant: -1, painPoint: null };
}

/**
 * Generate a personalized email subject (one of 5 variants, deterministically
 * picked) + body for a lead at a given sequence stage (1=intro, 2=value,
 * 3=free-redesign offer, 4=last touch). Sends both html (minimal
 * "personal letter" style, see buildHtml) and a plain-text fallback — no
 * attachments (those are handled outside this function, never automatically
 * on first contact).
 *
 * @param {string} [senderFirstName]  first name of whichever mailbox in the
 *   sender rotation is sending this (see emailSequence.js) -- signs the
 *   email so it matches the actual From address; defaults to SENDER_NAME's
 *   first name (signature.js) if not given.
 */
async function generateEmail(lead, stage = 1, senderFirstName) {
  const offer = offerForLead(lead);
  const outcome = outcomeForLead(lead);
  const painKey = pickPainPoint(lead, stage);
  const observation = factualObservation(lead, stage, painKey);
  const firstName = greetingName(lead);
  const angle = (STAGE_ANGLES[stage] || STAGE_ANGLES[1])(offer, outcome);
  const isBaseStage = stage === 1;

  const subjectInstruction = isBaseStage
    ? '- "body": the plain text email body (50-80 words, following the (1)(2)(3)(4) structure from the system prompt, ending with the one CTA — no signature, no sign-off, no links, no company or product name)'
    : `- "subjects": an array of exactly 5 subject line variants, each 2-4 words, plain and low-key (like "quick question" or "missed calls?"), not curiosity-bait, no ALL CAPS, no exclamation marks, and none of these words: free, guaranteed, offer, discount, urgent, act now, limited time, winner
- "body": the plain text email body (50-80 words, following the (1)(2)(3)(4) structure from the system prompt, ending with the one CTA — no signature, no sign-off, no links, no company or product name)`;

  const prompt = `Write a cold outreach email to ${firstName ? firstName : 'the owner'} of ${lead.name}, a ${lead.business_type || 'local business'} in ${lead.city}.

${angle}

A specific detail about their business you may weave in ONLY if it fits naturally (never invent anything beyond this): ${observation || 'no specific detail available -- keep it general'}

Return JSON with exactly ${isBaseStage ? 'one field' : 'two fields'}:
${subjectInstruction}

Just the JSON object, nothing else.`;

  const headers = lead.email ? unsubHeaders(lead.email) : undefined;
  const variantKey = `${lead.place_id || lead.name}-${stage}`;

  let subject;
  let body;
  let subjectVariant = -1;

  try {
    const res = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: EMAIL_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      max_tokens: 400,
      temperature: 0.8,
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(res.choices[0].message.content);
    body = parsed.body;

    if (isBaseStage) {
      // Fixed A/B pair, not AI-generated -- controlled comparison per spec.
      subjectVariant = pickVariantIndex(variantKey, STAGE1_SUBJECT_VARIANTS.length);
      subject = STAGE1_SUBJECT_VARIANTS[subjectVariant];
    } else {
      subjectVariant = pickVariantIndex(variantKey, parsed.subjects?.length || 0);
      subject = (subjectVariant >= 0 && parsed.subjects[subjectVariant]) || parsed.subjects?.[0];
    }
    if (!subject || !body) throw new Error('AI response missing subject/body');
  } catch (err) {
    logger.error('AI email generation failed, using fallback', { message: err.message, stage });
    subjectVariant = isBaseStage ? pickVariantIndex(variantKey, STAGE1_SUBJECT_VARIANTS.length) : -1;
    subject = isBaseStage ? STAGE1_SUBJECT_VARIANTS[subjectVariant] : 'quick question';
    body = `Hi${firstName ? ` ${firstName}` : ''}, what happens when someone calls ${lead.name} while you're mid-appointment or after hours? A missed call there can mean a lost booking.\n\nSome businesses like yours now have something that only steps in for those missed or after-hours calls -- and sounds real enough that most callers can't tell -- booking it on the spot instead. Could add up to a handful more ${outcome} a month.\n\nWorth hearing what it'd sound like for your business?`;
  }

  // Plain text only, no html field -- live testing showed even the
  // minimal-HTML "letter" style (Georgia serif, no colors/buttons, modeled
  // on FootWord's proven templates) still landed in Promotions for this
  // domain's current sending reputation, while a completely bare plain-text
  // email with no HTML part at all landed in the Inbox. buildHtml() is kept
  // for reference/re-testing later, just not used in the default send path.
  const text = assembleEmailText(body, senderFirstName);
  return { subject, text, headers, subjectVariant, painPoint: painKey || null };
}

/**
 * Appends the fixed signature to an AI-generated body. No visible
 * "unsubscribe" text/link in the body -- that phrase + link is a classic
 * bulk-marketing-email signal that pushes Gmail's classifier toward
 * Promotions. The actual opt-out mechanism is unaffected: unsubHeaders()
 * still sets the List-Unsubscribe / List-Unsubscribe-Post headers (used for
 * Gmail's native one-click unsubscribe UI next to the sender name), which
 * is invisible in the body and doesn't carry the same signal.
 */
function assembleEmailText(body, senderFirstName) {
  return [body.trim(), '', buildSignature(senderFirstName)].join('\n');
}

// Minimal "personal letter" HTML shell, modeled directly on FootWord's
// mail.js (a sibling project's outreach templates, confirmed via live Gmail
// testing to consistently land in the Inbox across 50+ sends): serif font,
// narrow width, no colors/buttons/banners. The FootWord code comment says it
// best -- "marketing chrome (colors, big CTAs, promo words) is what lands
// mail in Gmail's Promotions tab; this reads like a note from a person."
function buildHtml(body) {
  const paragraphs = body
    .trim()
    .split(/\n\n+/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  const signatureHtml = buildSignature()
    .split('\n')
    .filter(Boolean)
    .join('<br>');

  return `<!doctype html><html><body style="margin:0;padding:18px;background:#ffffff">
<div style="max-width:540px;margin:0 auto;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.55;color:#222">
${paragraphs}
<p>${signatureHtml}</p>
</div></body></html>`;
}

/**
 * Generate a personalized call script for a lead.
 */
async function generateCallScript(lead) {
  const prompt = `Write a short cold call script for calling ${lead.name}, a ${lead.business_type || 'local business'} in ${lead.city}.
They have no website. Pitch: professional website + online booking system.
The script should be 3-4 sentences max, spoken naturally, ending with "Press 1 if you'd like to learn more."
Just the script text, nothing else.`;

  try {
    const res = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      max_tokens: 120,
      temperature: 0.7,
    });

    return res.choices[0].message.content.trim();
  } catch (err) {
    logger.error('AI call script generation failed, using fallback', { message: err.message });
    return `Hi, this is a quick message for ${lead.name}. We help local businesses like yours get a professional website with online booking and payments. Visit stanweb.tech to see our demo. Press 1 if you'd like to learn more.`;
  }
}

module.exports = {
  generateSms,
  generateWhatsApp,
  generateEmail,
  generateCallScript,
  generateDecoyOpener,
  generatePivotEmail,
  classifyReply,
  personalizePivotOpener,
  classifyPostPivotReply,
  generateBookingEmail,
};
