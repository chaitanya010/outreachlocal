#!/usr/bin/env node
/**
 * CLI entrypoint for the lead generation pipeline.
 *
 * Usage:
 *   node generate-leads.js --city="Miami"
 *   node generate-leads.js --city="Austin, TX" --types="spa,massage,clinic"
 */

require('dotenv').config();

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const { validate } = require('./src/config');
const { runPipeline, DEFAULT_TYPES } = require('./src/jobs/leadPipeline');
const logger = require('./src/utils/logger');

const argv = yargs(hideBin(process.argv))
  .option('city', {
    type: 'string',
    description: 'City to search (e.g. "Miami" or "Austin, TX")',
    demandOption: true,
  })
  .option('types', {
    type: 'string',
    description: `Comma-separated business types (default: "${DEFAULT_TYPES.join(',')}")`,
    default: DEFAULT_TYPES.join(','),
  })
  .example('node generate-leads.js --city="Miami"')
  .example('node generate-leads.js --city="Dallas" --types="spa,clinic"')
  .argv;

(async () => {
  try {
    validate();
  } catch (err) {
    logger.error(err.message);
    process.exit(1);
  }

  const types = argv.types.split(',').map((t) => t.trim()).filter(Boolean);

  try {
    const result = await runPipeline(argv.city, types);
    console.log('\n✅ Pipeline complete:');
    console.table(result);
    process.exit(0);
  } catch (err) {
    logger.error('Pipeline failed', { message: err.message });
    process.exit(1);
  }
})();
