'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getClient } = require('../src/db/supabaseClient');

// Minimal quote-aware CSV line splitter (handles "a, b" quoted fields).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

async function main() {
  const csvPath = process.argv[2];
  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(raw);
  const header = rows[0];
  const idx = (name) => header.indexOf(name);

  const col = {
    first: idx('First Name'),
    last: idx('Last Name'),
    title: idx('Title'),
    company: idx('Company Name'),
    email: idx('Email'),
    workPhone: idx('Work Direct Phone'),
    companyPhone: idx('Company Phone'),
    industry: idx('Industry'),
    website: idx('Website'),
    city: idx('City'),
    companyCity: idx('Company City'),
    companyAddress: idx('Company Address'),
    apolloId: idx('Apollo Contact Id'),
  };

  const cleanPhone = (s) => (s || '').replace(/^'/, '').trim() || null;

  const leads = rows.slice(1).map((r) => ({
    place_id: `apollo:${r[col.apolloId]}`,
    name: r[col.company].trim(),
    city: (r[col.city] || r[col.companyCity] || '').trim() || 'Unknown',
    address: r[col.companyAddress] || null,
    phone: cleanPhone(r[col.workPhone]) || cleanPhone(r[col.companyPhone]),
    website: r[col.website] || null,
    has_website: true,
    email: r[col.email].trim().toLowerCase(),
    business_type: r[col.industry] || null,
    decision_maker_name: `${r[col.first]} ${r[col.last]}`.trim() || null,
    decision_maker_role: r[col.title] || null,
    source: 'apollo_import',
    outreach_status: 'pending',
    email_stage: 0,
    prospect_score: 50,
  }));

  console.log(`Parsed ${leads.length} contacts from CSV.`);

  const db = getClient();

  // Dedup check: skip anything already in leads by email (avoid double-contacting
  // the same person via a different source/place_id).
  const emails = leads.map((l) => l.email);
  const { data: existing, error: existErr } = await db.from('leads').select('email').in('email', emails);
  if (existErr) throw existErr;
  const existingSet = new Set((existing || []).map((e) => e.email));

  const toInsert = leads.filter((l) => !existingSet.has(l.email));
  const skipped = leads.filter((l) => existingSet.has(l.email));

  if (skipped.length) {
    console.log(`Skipping ${skipped.length} already-known email(s):`, skipped.map((l) => l.email));
  }

  if (!toInsert.length) {
    console.log('Nothing new to insert.');
    return;
  }

  const { data, error } = await db.from('leads').upsert(toInsert, { onConflict: 'place_id', ignoreDuplicates: false }).select('id, name, email');
  if (error) throw error;

  console.log(`Inserted ${data.length} leads:`);
  data.forEach((d) => console.log(' -', d.name, d.email));
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
