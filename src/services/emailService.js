'use strict';

const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

const FROM_EMAIL = process.env.SES_FROM_EMAIL;
const FROM_NAME = process.env.SES_FROM_NAME || 'StanWeb';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const region = process.env.AWS_REGION;
  const user = process.env.SES_SMTP_USER;
  const pass = process.env.SES_SMTP_PASSWORD;
  if (!region) throw new Error('AWS_REGION is required');
  if (!user || !pass) throw new Error('SES_SMTP_USER and SES_SMTP_PASSWORD are required');

  transporter = nodemailer.createTransport({
    host: `email-smtp.${region}.amazonaws.com`,
    port: 587,
    secure: false, // STARTTLS on port 587
    requireTLS: true,
    auth: { user, pass },
  });
  return transporter;
}

/**
 * Send an email via AWS SES's SMTP interface (SMTP credentials generated
 * from the SES console -> SMTP settings -> Create SMTP credentials; these
 * are NOT the same as an IAM access key/secret).
 *
 * @param {object} opts
 * @param {string} opts.to        recipient email
 * @param {string} opts.subject
 * @param {string} opts.html      HTML body
 * @param {string} opts.text      plain-text fallback
 * @param {string} [opts.replyTo]
 * @param {object} [opts.headers]     extra email headers (e.g. List-Unsubscribe)
 * @param {object[]} [opts.attachments] [{ filename, content (base64 string) }]
 * @returns {Promise<{ messageId: string }>}
 */
async function sendEmail({ to, subject, html, text, replyTo, headers, attachments }) {
  if (!FROM_EMAIL) throw new Error('SES_FROM_EMAIL is required');

  const mailOptions = {
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to,
    subject,
    html,
    text,
  };
  if (replyTo) mailOptions.replyTo = replyTo;
  if (headers) {
    mailOptions.headers = Object.entries(headers).map((name) => ({ key: name[0], value: name[1] }));
  }
  if (attachments && attachments.length) {
    mailOptions.attachments = attachments.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content, 'base64'),
    }));
  }

  try {
    const info = await getTransporter().sendMail(mailOptions);
    const messageId = info.messageId || 'unknown';
    logger.info('Email sent', { to, subject, messageId });
    return { messageId };
  } catch (err) {
    logger.error('SES send failed', { to, subject, message: err.message });
    throw new Error(`SES send failed: ${err.message}`);
  }
}

module.exports = { sendEmail };
