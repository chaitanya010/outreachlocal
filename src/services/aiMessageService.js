'use strict';

const OpenAI = require('openai');
const logger = require('../utils/logger');
const { unsubLink, unsubHeaders } = require('../utils/unsubscribe');
const { buildSignature } = require('../utils/signature');
const { getColdCallContext } = require('./prospectScorer');

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
// channels have their own established formats -- this one encodes the
// deliverability-first philosophy: never sound like an agency, never invent
// facts, never use HTML/emojis/hype, one CTA, one genuine observation.
const EMAIL_SYSTEM_PROMPT = `You write cold outreach emails for StanWeb.tech, a service that helps local
businesses (salons, spas, clinics, med spas, and similar) automate customer acquisition
with AI voice receptionists, AI phone calling, appointment automation, CRM setup,
website revamps/development, AI chatbots, and workflow automation.

Rules -- follow all of these exactly:
- Write like a real person emailing another business owner, not a marketer or an agency.
- 90-120 words total. 2-4 short paragraphs. Plain text only, no HTML, no emojis, no bold,
  no bullet lists, no exaggeration, no hype words ("game-changer", "revolutionize",
  "skyrocket", "cutting-edge", "leverage").
- Include exactly ONE genuine personalized observation, using ONLY the specific fact(s)
  given to you below. Never invent a detail that wasn't given to you.
- Include exactly ONE call to action, low-pressure (e.g. "Would you be open to a quick
  15-minute call?" or "Happy to show you a few ideas if you're interested.").
- Do not include a signature, sign-off, or unsubscribe line -- those are added separately.
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
    : 'a professional website with online booking, payments, and an AI chatbot';
}

// stage: 1=intro (day 0), 2=value (day 3), 3=free redesign offer (day 7), 4=last touch (day 14)
const STAGE_ANGLES = {
  1: (offer) =>
    `This is the FIRST email in the sequence — a short, human introduction.
Introduce StanWeb briefly and pitch: ${offer}.`,
  2: (offer) =>
    `This is a FOLLOW-UP email (their 2nd from us, no reply yet) — lead with a concrete value angle, not a re-introduction.
Focus on the concrete outcome of ${offer} (e.g. fewer missed calls, more booked appointments) — one brief proof point is fine, don't invent specific customer stories or numbers.`,
  3: (offer) =>
    `This is a FOLLOW-UP email (their 3rd from us, no reply yet) — make it easy to say yes.
Offer a completely FREE website redesign/mockup with no obligation, as a way to show the value of ${offer} before they commit to anything.`,
  4: (offer) =>
    `This is the LAST email in the sequence (their 4th from us, no reply yet) — a brief, polite breakup note.
Acknowledge this is the last email on this topic, leave the door open, mention ${offer} one more time briefly. No pressure, thank them for their time.`,
};

/** Deterministic pick from a list, keyed by a string — same lead+stage always
 * gets the same subject variant (reproducible), but spreads across variants
 * as leads/stages vary, giving future analysis something to segment on. */
function pickVariant(key, list) {
  if (!list || !list.length) return null;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return list[hash % list.length];
}

/**
 * The one genuine, fact-grounded observation to personalize with — pulled
 * from measured signals only (prospectScorer/leadScorer problems, or the
 * discovery pipeline's precomputed personalization_sentence), never invented.
 */
function factualObservation(lead) {
  if (lead.personalization_sentence) return lead.personalization_sentence;
  return getColdCallContext(lead);
}

function greetingName(lead) {
  if (!lead.decision_maker_name) return null;
  return lead.decision_maker_name.replace(/^dr\.\s*/i, '').split(/\s+/)[0];
}

/**
 * Generate a personalized email subject (one of 5 variants, deterministically
 * picked) + body for a lead at a given sequence stage (1=intro, 2=value,
 * 3=free-redesign offer, 4=last touch). Plain text only — no HTML, no
 * attachments (those are handled outside this function, never automatically
 * on first contact).
 */
async function generateEmail(lead, stage = 1) {
  const offer = offerForLead(lead);
  const observation = factualObservation(lead);
  const firstName = greetingName(lead);
  const angle = (STAGE_ANGLES[stage] || STAGE_ANGLES[1])(offer);

  const prompt = `Write a cold outreach email to ${firstName ? firstName : 'the owner'} of ${lead.name}, a ${lead.business_type || 'local business'} in ${lead.city}.

${angle}

The ONE real observation you may reference (use only this, don't add anything else): ${observation || 'they don\'t currently have a strong online presence'}

Return JSON with exactly two fields:
- "subjects": an array of exactly 5 subject line variants, each 3-5 words, natural and curiosity-driven (not clickbait), no ALL CAPS, no exclamation marks, and none of these words: free, guaranteed, offer, discount, urgent, act now, limited time, winner
- "body": the plain text email body (90-120 words, 2-4 short paragraphs, ending with the one CTA — no signature, no sign-off, no links)

Just the JSON object, nothing else.`;

  const unsub = lead.email ? unsubLink(lead.email) : null;
  const headers = lead.email ? unsubHeaders(lead.email) : undefined;

  let subject;
  let body;

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
    subject = pickVariant(`${lead.place_id || lead.name}-${stage}`, parsed.subjects) || parsed.subjects?.[0];
    body = parsed.body;
    if (!subject || !body) throw new Error('AI response missing subject/body');
  } catch (err) {
    logger.error('AI email generation failed, using fallback', { message: err.message, stage });
    subject = `Quick question for ${lead.name}`;
    body = `Hi${firstName ? ` ${firstName}` : ''},\n\nI came across ${lead.name} and wanted to reach out — we help businesses like yours with ${offer}.${observation ? ` ${observation}` : ''}\n\nWould you be open to a quick 15-minute call?`;
  }

  const text = assembleEmailText(body, unsub);
  return { subject, text, headers };
}

/** Appends the fixed signature + respectful unsubscribe line to an AI-generated body. */
function assembleEmailText(body, unsub) {
  const parts = [body.trim(), '', buildSignature()];
  if (unsub) {
    parts.push('', `If this isn't relevant, simply reply "No thanks" and I won't reach out again. Unsubscribe: ${unsub}`);
  }
  return parts.join('\n');
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
