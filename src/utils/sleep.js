/**
 * Pause execution for `ms` milliseconds.
 * Used to respect API rate limits between paginated requests.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = sleep;
