'use strict';

const OpenAI = require('openai');
const logger = require('../utils/logger');
const { unsubHeaders } = require('../utils/unsubscribe');
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
// Live testing (real sends, checking inbox vs Promotions) narrowed this down
// hard: it was never really about HTML vs plain text, links, or attachments.
// The email that consistently lands in the Inbox has NO company self-intro
// ("At StanWeb, we..."), NO service list, and signs off with just a first
// name -- it reads as one person reaching out to another, not a pitch.
// Every version that named the company or listed services landed in
// Promotions, even in bare plain text with zero links. So: no company name,
// no service list, no "we help businesses like yours" framing, in the body.
const EMAIL_SYSTEM_PROMPT = `You write short, personal cold outreach emails on behalf of Chaitanya, who
helps local businesses (salons, spas, clinics, med spas, and similar) reduce no-shows and
bring in more repeat business.

Rules -- follow all of these exactly:
- Write like a real 1:1 email from one person to another business owner. NOT a company
  pitch: do not name the company, do not list services or tools, do not say "we help
  businesses like yours" or anything that reads as a sales introduction.
- 40-70 words total. 2-4 short sentences/paragraphs. Plain text only, no HTML, no emojis,
  no bold, no bullet lists, no exaggeration, no hype words.
- Include exactly ONE genuine personalized observation, using ONLY the specific fact(s)
  given to you below. Never invent a detail that wasn't given to you.
- Include exactly ONE call to action asking for a short conversation (e.g. "Would you
  have 15 minutes this week to talk?"), not a reply-for-more-info CTA and not a link.
- Do not include a signature or sign-off -- that's added separately.
- Do not include any links or company/brand names in the body text.`;

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

// `offer` (from offerForLead/INDUSTRY_OFFERS) is deliberately used only as an
// internal angle hint below, never as text to quote or name-drop in the
// email itself -- naming specific services/tools is exactly what pushed
// every earlier version into Promotions.

// stage: 1=intro (day 0), 2=value (day 3), 3=free redesign offer (day 7), 4=last touch (day 14)
const STAGE_ANGLES = {
  1: () =>
    `This is the FIRST email -- reach out directly and personally, like you're writing to
one specific business owner you looked into, not sending a pitch. Do not introduce a
company or explain what you do.`,
  2: (offer) =>
    `This is a brief FOLLOW-UP (their 2nd email, no reply yet). Keep the same personal,
non-pitchy tone -- something like "wanted to follow up on my last note." You can hint
at the underlying angle (${offer}) in your own words, but don't name it as a product or
service. Still end with a request for a short conversation.`,
  3: (offer) =>
    `This is a brief FOLLOW-UP (their 3rd email, no reply yet). Make it low-effort to say
yes -- offer to just share a couple of specific ideas for their business (related to:
${offer}) if they're open to it, still in plain conversational language, not as a
named offer/product.`,
  4: () =>
    `This is the LAST email (their 4th, no reply yet) -- a brief, polite breakup note.
Acknowledge this is the last note on this, leave the door open, no pressure, thank them
for their time.`,
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
 * 3=free-redesign offer, 4=last touch). Sends both html (minimal
 * "personal letter" style, see buildHtml) and a plain-text fallback — no
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
- "subjects": an array of exactly 5 subject line variants, each 2-4 words, plain and low-key (like "quick question" or "for {lead.name}"), not curiosity-bait, no ALL CAPS, no exclamation marks, and none of these words: free, guaranteed, offer, discount, urgent, act now, limited time, winner
- "body": the plain text email body (40-70 words, 2-4 short sentences/paragraphs, ending with the one CTA — no signature, no sign-off, no links, no company name)

Just the JSON object, nothing else.`;

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
    subject = 'quick question';
    body = `Hi${firstName ? ` ${firstName}` : ''},\n\nI came across ${lead.name} and noticed ${observation || 'you don\'t have a website yet'}. Wanted to reach out directly rather than send a generic pitch.\n\nWould you have 15 minutes this week to talk?`;
  }

  // Plain text only, no html field -- live testing showed even the
  // minimal-HTML "letter" style (Georgia serif, no colors/buttons, modeled
  // on FootWord's proven templates) still landed in Promotions for this
  // domain's current sending reputation, while a completely bare plain-text
  // email with no HTML part at all landed in the Inbox. buildHtml() is kept
  // for reference/re-testing later, just not used in the default send path.
  const text = assembleEmailText(body);
  return { subject, text, headers };
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
