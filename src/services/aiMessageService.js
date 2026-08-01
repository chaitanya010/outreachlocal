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
// Promotions -- so this missed-calls/competitor-urgency angle deliberately
// describes the CAPABILITY in plain human language instead of naming the
// thing: "something that picks up" / "answers automatically" rather than
// "AI voice calling system". Same words a business owner would use
// describing it to a friend, not a product name. Still no company/brand
// name, no links, no bullet lists, no HTML.
const EMAIL_SYSTEM_PROMPT = `You write short, direct cold outreach emails on behalf of Chaitanya, who helps local
businesses (salons, spas, clinics, med spas, home services, and similar) stop losing
customers to missed calls -- including after-hours calls and two calls at once.

Rules -- follow all of these exactly:
- Write like a real 1:1 email from one person to another business owner, not a company
  pitch. Do not name the company ("StanWeb"), do not use product/feature names like
  "AI voice calling", "AI receptionist", "system", "software", "solution", or "platform"
  -- describe what happens in plain human words instead (e.g. "something that picks up
  every call, even after hours, even if two people call at once, and books them right
  then") never the name of the thing.
- Structure: (1) a short, genuine question about how they currently handle calls, (2)
  one honest sentence naming the real cost of a missed call (a lost booking/customer --
  no invented numbers or fake statistics), (3) one sentence of real urgency, described
  in plain terms (other businesses like theirs already have something that answers
  every call and books appointments on the spot, day or night), (4) end asking them to
  reply to set it up.
- 50-90 words total, short sentences/paragraphs. Plain text only, no HTML, no emojis, no
  bold, no bullet lists, no ALL CAPS, no fake urgency words like "act now" or "limited
  time" -- the urgency should come from the competitor framing, not hype language.
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
    : 'answering every call automatically, even after hours or if two people call at once, and booking the appointment on the spot';
}

// `offer` (from offerForLead/INDUSTRY_OFFERS) is deliberately used only as an
// internal angle hint below, never as text to quote or name-drop in the
// email itself -- naming specific services/tools is exactly what pushed
// every earlier version into Promotions.

// stage: 1=intro (day 0), 2=value (day 3), 3=free redesign offer (day 7), 4=last touch (day 14)
//
// Each stage uses a distinct persuasion structure (Follow-Up Ladder / Multi-Angle
// Follow-Up strategy) so a lead who doesn't reply to stage 1 sees a genuinely
// different angle each time, not the same ask reworded. All four stay inside the
// same hard constraint proven to land in the Inbox: no company name, no service
// list, no links, one CTA. "Selling" happens through structure and specificity,
// not through richer content.
const STAGE_ANGLES = {
  1: (offer) =>
    `This is the FIRST email -- follow the (1)(2)(3)(4) structure from the system prompt
exactly: question about how they handle calls, cost of a missed call, plain-language
competitor urgency, reply-to-set-it-up CTA. If the observation below fits naturally as
the specific detail behind the question, use it; otherwise keep the question general.
(Internal detail, only if it fits naturally, never name it as a product: ${offer})`,
  2: (offer) =>
    `This is a brief FOLLOW-UP (their 2nd email, no reply yet). Different angle from the
first: instead of asking how they handle calls, ask directly whether missed calls
during busy hours or after-hours are something that actually happens for them --
genuinely curious, not assuming. Keep the same plain-language urgency (others in their
line of work already have something that answers every call and books on the spot) and
the same reply-to-set-it-up close. (Internal detail, only if it fits naturally: ${offer})`,
  3: (offer) =>
    `This is a brief FOLLOW-UP (their 3rd email, no reply yet). Quick Before/After in
plain language -- calls going unanswered now vs. every call picked up and booked
automatically, day or night -- then make it low-effort to say yes: ask if they'd be
open to just seeing how it'd work for their business, no pressure. (Internal detail,
only if it fits naturally: ${offer})`,
  4: () =>
    `This is the LAST email (their 4th, no reply yet) -- a brief, polite breakup note.
One last honest line that competitors picking up every call while they're still missing
some is a gap that keeps widening the longer it goes unaddressed, but make it genuinely
low-pressure and okay for them to say nothing. Thank them for their time, leave the
door open.`,
};

function stringHash(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash;
}

/** Deterministic pick from a list, keyed by a string — same lead+stage always
 * gets the same subject variant (reproducible), but spreads across variants
 * as leads/stages vary, giving future analysis something to segment on. */
function pickVariant(key, list) {
  if (!list || !list.length) return null;
  return list[stringHash(key) % list.length];
}

/** Same deterministic pick, but returns the index (for logging which variant
 * was sent, so reply rate can later be broken down per variant). */
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

/**
 * Generate a personalized email subject (one of 5 variants, deterministically
 * picked) + body for a lead at a given sequence stage (1=intro, 2=value,
 * 3=free-redesign offer, 4=last touch). Sends both html (minimal
 * "personal letter" style, see buildHtml) and a plain-text fallback — no
 * attachments (those are handled outside this function, never automatically
 * on first contact).
 */
async function generateEmail(lead, stage = 1) {
  const offer = offerForLead(lead);
  const painKey = pickPainPoint(lead, stage);
  const observation = factualObservation(lead, stage, painKey);
  const firstName = greetingName(lead);
  const angle = (STAGE_ANGLES[stage] || STAGE_ANGLES[1])(offer);

  const prompt = `Write a cold outreach email to ${firstName ? firstName : 'the owner'} of ${lead.name}, a ${lead.business_type || 'local business'} in ${lead.city}.

${angle}

A specific detail about their business you may weave in ONLY if it fits naturally (never invent anything beyond this): ${observation || 'no specific detail available -- keep it general'}

Return JSON with exactly two fields:
- "subjects": an array of exactly 5 subject line variants, each 2-4 words, plain and low-key (like "quick question" or "missed calls?"), not curiosity-bait, no ALL CAPS, no exclamation marks, and none of these words: free, guaranteed, offer, discount, urgent, act now, limited time, winner
- "body": the plain text email body (50-90 words, following the (1)(2)(3)(4) structure from the system prompt, ending with the one CTA — no signature, no sign-off, no links, no company or product name)

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
    subjectVariant = pickVariantIndex(variantKey, parsed.subjects?.length || 0);
    subject = (subjectVariant >= 0 && parsed.subjects[subjectVariant]) || parsed.subjects?.[0];
    body = parsed.body;
    if (!subject || !body) throw new Error('AI response missing subject/body');
  } catch (err) {
    logger.error('AI email generation failed, using fallback', { message: err.message, stage });
    subject = 'quick question';
    subjectVariant = -1; // fallback path, not one of the 5 AI variants
    body = `Hi${firstName ? ` ${firstName}` : ''}, how are you currently handling calls at ${lead.name}? A missed call during a busy stretch or after hours usually means that customer just calls the next place instead.\n\nA lot of businesses like yours now have something that picks up every call automatically, even two at once, and books the appointment on the spot.\n\nWorth a quick reply if you'd want to see how it'd work for you?`;
  }

  // Plain text only, no html field -- live testing showed even the
  // minimal-HTML "letter" style (Georgia serif, no colors/buttons, modeled
  // on FootWord's proven templates) still landed in Promotions for this
  // domain's current sending reputation, while a completely bare plain-text
  // email with no HTML part at all landed in the Inbox. buildHtml() is kept
  // for reference/re-testing later, just not used in the default send path.
  const text = assembleEmailText(body);
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
function assembleEmailText(body) {
  return [body.trim(), '', buildSignature()].join('\n');
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

module.exports = { generateSms, generateWhatsApp, generateEmail, generateCallScript };
