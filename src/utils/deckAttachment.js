'use strict';

/**
 * Loads the StanWeb pitch deck PDF once at startup and exposes it as a
 * Resend-ready attachment (base64 content). Drop the file at
 * src/assets/StanWeb_PitchDeck.pdf — if it's missing, getDeckAttachment()
 * returns null and emails simply go out without an attachment (never fails
 * a send because of a missing file).
 */

const { readFileSync, existsSync } = require('fs');
const path = require('path');
const logger = require('./logger');

const DECK_PATH = path.join(__dirname, '..', 'assets', 'StanWeb_PitchDeck.pdf');
const DECK_FILENAME = 'StanWeb-Pitch-Deck.pdf';

let cached; // undefined = not loaded yet, null = missing, object = attachment

function getDeckAttachment() {
  if (cached !== undefined) return cached;

  if (!existsSync(DECK_PATH)) {
    logger.warn('Pitch deck not found, sending emails without attachment', { path: DECK_PATH });
    cached = null;
    return cached;
  }

  try {
    const content = readFileSync(DECK_PATH).toString('base64');
    cached = { filename: DECK_FILENAME, content };
  } catch (err) {
    logger.error('Failed to load pitch deck', { message: err.message });
    cached = null;
  }

  return cached;
}

module.exports = { getDeckAttachment };
