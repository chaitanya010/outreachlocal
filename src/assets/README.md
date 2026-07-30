Drop the pitch deck PDF here as `StanWeb_PitchDeck.pdf`.

`src/utils/deckAttachment.js` loads it at server startup and attaches it to every
stage-1 (intro) email. If the file is missing, emails just go out without an
attachment — nothing breaks, it only logs a warning.
