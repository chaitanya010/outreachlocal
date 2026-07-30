'use strict';

const logger = require('../utils/logger');

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL;
const FROM_NAME = process.env.RESEND_FROM_NAME || 'StanWeb';

/**
 * Send an email via Resend.
 *
 * @param {object} opts
 * @param {string} opts.to        recipient email
 * @param {string} opts.subject
 * @param {string} opts.html      HTML body
 * @param {string} opts.text      plain-text fallback
 * @param {string} [opts.replyTo]
 * @param {object} [opts.headers]     extra email headers (e.g. List-Unsubscribe)
 * @param {object[]} [opts.attachments] Resend attachments: [{ filename, content (base64) }]
 * @returns {Promise<{ messageId: string }>}
 */
async function sendEmail({ to, subject, html, text, replyTo, headers, attachments }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is required');
  if (!FROM_EMAIL) throw new Error('RESEND_FROM_EMAIL is required');

  const body = {
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to: [to],
    subject,
    html,
    text,
  };
  if (replyTo) body.reply_to = replyTo;
  if (headers) body.headers = headers;
  if (attachments && attachments.length) body.attachments = attachments;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    logger.error('Resend send failed', { to, subject, status: res.status, errText });
    throw new Error(`Resend send failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const messageId = data.id || 'unknown';
  logger.info('Email sent', { to, subject, messageId });
  return { messageId };
}

module.exports = { sendEmail };
