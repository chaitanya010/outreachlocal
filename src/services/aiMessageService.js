'use strict';

const OpenAI = require('openai');
const logger = require('../utils/logger');
const { unsubLink, unsubHeaders } = require('../utils/unsubscribe');
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
  1: (lead, offer, painPoint) =>
    `This is the FIRST email in the sequence — a short, human introduction.
${painPoint ? `Specific observation to weave in naturally: ${painPoint}` : ''}
Introduce StanWeb briefly and pitch: ${offer}.
End with a low-pressure CTA to reply or book a free call.`,
  2: (lead, offer) =>
    `This is a FOLLOW-UP email (their 2nd from us, no reply yet) — lead with a concrete value angle, not a re-introduction.
Focus on the concrete outcome of ${offer} (e.g. fewer missed calls, more booked appointments) — one brief proof point or number is fine, don't invent specific customer stories.
Keep it short. End with a simple, easy-to-answer CTA.`,
  3: (lead, offer) =>
    `This is a FOLLOW-UP email (their 3rd from us, no reply yet) — make it easy to say yes.
Offer a completely FREE website redesign/mockup with no obligation, as a way to show the value of ${offer} before they commit to anything.
Keep it short and low-pressure. End with "reply yes and I'll get started" style CTA.`,
  4: (lead, offer) =>
    `This is the LAST email in the sequence (their 4th from us, no reply yet) — a brief, polite breakup note.
Acknowledge this is the last email on this topic, leave the door open, mention ${offer} one more time briefly.
No pressure, thank them for their time. Keep it very short.`,
};

/**
 * Generate a personalized email subject + body for a lead at a given
 * sequence stage (1=intro, 2=value, 3=free-redesign offer, 4=last touch).
 */
async function generateEmail(lead, stage = 1) {
  const offer = offerForLead(lead);
  const painPoint = getColdCallContext(lead);
  const angle = (STAGE_ANGLES[stage] || STAGE_ANGLES[1])(lead, offer, painPoint);

  const prompt = `Write a cold outreach email to the owner of ${lead.name}, a ${lead.business_type || 'local business'} in ${lead.city}.
They currently have no website.

${angle}

Return JSON with exactly two fields:
- "subject": email subject line (max 60 chars, no clickbait)
- "body": plain text email body (80-120 words, 3-4 short paragraphs, no HTML)

Just the JSON object, nothing else.`;

  const unsub = lead.email ? unsubLink(lead.email) : null;
  const headers = lead.email ? unsubHeaders(lead.email) : undefined;

  try {
    const res = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      max_tokens: 400,
      temperature: 0.8,
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(res.choices[0].message.content);
    const subject = parsed.subject || `${offer} for ${lead.name}`;
    const text = parsed.body || '';

    const html = buildHtml(text, unsub);
    const fullText = unsub ? `${text}\n\nUnsubscribe: ${unsub}` : text;

    return { subject, html, text: fullText, headers };
  } catch (err) {
    logger.error('AI email generation failed, using fallback', { message: err.message, stage });
    const fallbackText = `Hi,\n\nI came across ${lead.name} and wanted to reach out — we help businesses like yours with ${offer}.\n\nSee our demo: ${DEMO_URL}\nBook a free call: ${BUSINESS_URL}\n\nBest,\nStanWeb.tech`;
    const fullText = unsub ? `${fallbackText}\n\nUnsubscribe: ${unsub}` : fallbackText;
    return {
      subject: `${offer} for ${lead.name}`,
      text: fullText,
      html: buildHtml(fallbackText, unsub),
      headers,
    };
  }
}

function buildHtml(text, unsub) {
  const unsubHtml = unsub
    ? `<p style="font-size:12px;color:#888;margin-top:24px">
    StanWeb.tech — ${CONTACT_EMAIL}<br>
    <a href="${unsub}">Unsubscribe</a></p>`
    : '';
  return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
  <p>${text.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>
  <p>
    <a href="${DEMO_URL}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin-right:10px">
      View Our Demo
    </a>
    <a href="${BUSINESS_URL}" style="background:#16a34a;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">
      Book a Free Call
    </a>
  </p>
  ${unsubHtml}
</div>`;
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
