'use strict';

const nodemailer = require('nodemailer');
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
const logger = require('../utils/logger');

const FROM_EMAIL = process.env.SES_FROM_EMAIL;
const FROM_NAME = process.env.SES_FROM_NAME || 'StanWeb';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!region) throw new Error('AWS_REGION is required');
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required');
  }

  const sesClient = new SESv2Client({ region, credentials: { accessKeyId, secretAccessKey } });
  transporter = nodemailer.createTransport({ SES: { sesClient, SendEmailCommand } });
  return transporter;
}

/**
 * Send an email via the AWS SES API (HTTPS, not SMTP). Switched from SMTP
 * after discovering Railway blocks outbound SMTP ports (25/465/587/2525) on
 * its Free/Trial/Hobby plans -- production sends were silently hanging.
 * HTTPS isn't blocked, so this sidesteps the issue without needing a paid
 * Railway plan. Uses an IAM access key/secret with ses:SendEmail permission
 * (not the SMTP username/password -- those are a different, SMTP-only
 * credential derived from an IAM secret and not valid for direct API calls).
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
