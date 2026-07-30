'use strict';

const { createHmac } = require('crypto');

const SECRET = () => process.env.CRON_SECRET || 'dev';
const BASE_URL = () => process.env.SERVER_URL || 'http://localhost:3000';

function unsubToken(email) {
  return createHmac('sha256', SECRET())
    .update(String(email).toLowerCase())
    .digest('hex')
    .slice(0, 24);
}

function unsubLink(email) {
  return `${BASE_URL()}/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubToken(email)}`;
}

function verifyUnsubToken(email, token) {
  return !!email && !!token && unsubToken(email) === token;
}

function unsubHeaders(email) {
  const link = unsubLink(email);
  return {
    'List-Unsubscribe': `<${link}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

module.exports = { unsubToken, unsubLink, verifyUnsubToken, unsubHeaders };
