'use strict';

/**
 * Message templates for each outreach channel.
 * All templates receive a `lead` object and return a string.
 *
 * lead shape: { name, city, phone, address, ... }
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

const firstName = (lead) => lead.name.split(' ')[0] || lead.name;

// ─── SMS ─────────────────────────────────────────────────────────────────────

const SMS_TEMPLATES = [
  (lead) =>
    `Hi ${firstName(lead)}! I help local businesses in ${lead.city} get professional websites that bring in new clients. ` +
    `I noticed ${lead.name} doesn't have one yet — I'd love to show you what we can build. ` +
    `Reply YES for a free mockup, or STOP to opt out.`,

  (lead) =>
    `Hey, this is Alex from EliteLocal. We specialize in websites for spas & clinics in ${lead.city}. ` +
    `${lead.name} came up in our search — we'd love to create a free demo site for you. ` +
    `Interested? Reply YES. Reply STOP to opt out.`,
];

// ─── WhatsApp ─────────────────────────────────────────────────────────────────

const WHATSAPP_TEMPLATES = [
  (lead) =>
    `👋 Hi! I came across *${lead.name}* and noticed you don't have a website yet.\n\n` +
    `We build stunning, mobile-first websites for local businesses in *${lead.city}* — ` +
    `starting at $997/mo with AI booking, reviews automation & more.\n\n` +
    `Would you like to see a *free mockup* for your business? Just reply *YES* 🙌`,

  (lead) =>
    `Hello from EliteLocal! 👋\n\n` +
    `We help spas, salons & clinics in ${lead.city} attract more clients online.\n\n` +
    `We'd love to build a *free demo website* for *${lead.name}* — no strings attached.\n\n` +
    `Reply *YES* to see it, or *STOP* to opt out.`,
];

// ─── Email ───────────────────────────────────────────────────────────────────

const EMAIL_TEMPLATES = [
  (lead) => ({
    subject: `Free website mockup for ${lead.name}`,
    html: `
      <p>Hi ${firstName(lead)},</p>
      <p>
        I came across <strong>${lead.name}</strong> while researching local businesses in
        <strong>${lead.city}</strong> and noticed you don't have a website yet.
      </p>
      <p>
        We build high-converting, mobile-first websites specifically for spas, salons,
        and clinics — complete with AI booking, automated reviews, and SMS follow-ups.
      </p>
      <p>
        I'd love to create a <strong>free custom mockup</strong> for ${lead.name} so you
        can see exactly what it would look like before committing to anything.
      </p>
      <p>
        <a href="https://elitelocal.io/book" style="background:#6c63ff;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">
          Book a 15-min Call →
        </a>
      </p>
      <p>Best,<br/>Alex<br/>EliteLocal</p>
      <p style="font-size:11px;color:#999;">
        Reply UNSUBSCRIBE to opt out of future messages.
      </p>
    `,
    text:
      `Hi ${firstName(lead)},\n\n` +
      `I came across ${lead.name} and noticed you don't have a website yet.\n\n` +
      `We build websites for local businesses in ${lead.city} with AI booking and review automation.\n\n` +
      `I'd love to send you a free mockup — no obligation.\n\n` +
      `Book a quick call: https://elitelocal.io/book\n\n` +
      `Best, Alex — EliteLocal\n\n` +
      `Reply UNSUBSCRIBE to opt out.`,
  }),
];

// ─── Call Script (TwiML / Bland.ai prompt) ────────────────────────────────────

const CALL_SCRIPT = (lead) =>
  `Hello, may I speak with the owner of ${lead.name}? ` +
  `Hi, my name is Alex calling from EliteLocal. ` +
  `We help local businesses in ${lead.city} get more clients through professional websites and AI booking systems. ` +
  `I noticed ${lead.name} doesn't have a website yet, and I'd love to show you a free mockup we've already created for you. ` +
  `Would you have two minutes to hear about it?`;

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * Pick a random template variant (A/B rotation).
 */
function getSmsMessage(lead) {
  const tmpl = SMS_TEMPLATES[Math.floor(Math.random() * SMS_TEMPLATES.length)];
  return tmpl(lead);
}

function getWhatsAppMessage(lead) {
  const tmpl = WHATSAPP_TEMPLATES[Math.floor(Math.random() * WHATSAPP_TEMPLATES.length)];
  return tmpl(lead);
}

function getEmailContent(lead) {
  const tmpl = EMAIL_TEMPLATES[0];
  return tmpl(lead);
}

function getCallScript(lead) {
  return CALL_SCRIPT(lead);
}

module.exports = { getSmsMessage, getWhatsAppMessage, getEmailContent, getCallScript };
