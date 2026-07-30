#!/usr/bin/env node
require('dotenv').config();

const ExcelJS = require('exceljs');
const { getClient } = require('./src/db/supabaseClient');
const { getColdCallContext } = require('./src/services/prospectScorer');
const path = require('path');

const city = process.argv[2] || null;
const minScore = parseInt(process.argv[3] || '0', 10);

(async () => {
  const db = getClient();

  let query = db
    .from('leads')
    .select('*')
    .order('prospect_score', { ascending: false })
    .limit(2000);

  if (city) query = query.ilike('city', `%${city}%`);
  if (minScore > 0) query = query.gte('prospect_score', minScore);

  const { data: leads, error } = await query;
  if (error) { console.error('DB error:', error.message); process.exit(1); }

  console.log(`Exporting ${leads.length} prospects...`);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'StanWeb.tech';
  const sheet = workbook.addWorksheet('Prospects', { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.columns = [
    { header: 'Business Name',   key: 'name',           width: 30 },
    { header: 'Business Type',   key: 'business_type',  width: 22 },
    { header: 'City',            key: 'city',           width: 18 },
    { header: 'Phone',           key: 'phone',          width: 18 },
    { header: 'Email',           key: 'email',          width: 28 },
    { header: 'Rating',          key: 'rating',         width: 10 },
    { header: 'Reviews',         key: 'review_count',   width: 10 },
    { header: 'Has Website',     key: 'has_website',    width: 13 },
    { header: 'Has Booking',     key: 'has_booking',    width: 13 },
    { header: 'Prospect Score',  key: 'prospect_score', width: 15 },
    { header: 'Problems',        key: 'problems',       width: 38 },
    { header: 'Cold Call Notes', key: 'notes',          width: 65 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF1D4ED8' } } };
  });
  headerRow.height = 28;

  leads.forEach((l, i) => {
    const score = l.prospect_score || 0;
    const row = sheet.addRow({
      name:          l.name,
      business_type: l.business_type || '',
      city:          l.city,
      phone:         l.phone || '',
      email:         l.email || '',
      rating:        l.rating ?? '',
      review_count:  l.review_count ?? 0,
      has_website:   l.has_website ? 'Yes' : 'No',
      has_booking:   l.has_booking ? 'Yes' : 'No',
      prospect_score: score,
      problems:      (l.problems || []).join(', '),
      notes:         getColdCallContext(l),
    });

    const bgColor = i % 2 === 0 ? 'FFFFFFFF' : 'FFF0F4FF';
    row.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      cell.alignment = { vertical: 'middle' };
    });

    const scoreCell = row.getCell('prospect_score');
    const fgColor = score >= 70 ? 'FF16A34A' : score >= 40 ? 'FFD97706' : 'FFDC2626';
    scoreCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    scoreCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fgColor } };
    scoreCell.alignment = { horizontal: 'center', vertical: 'middle' };

    ['has_website', 'has_booking'].forEach((key) => {
      const cell = row.getCell(key);
      cell.font = { color: { argb: cell.value === 'No' ? 'FFDC2626' : 'FF16A34A' }, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    row.height = 20;
  });

  sheet.autoFilter = { from: 'A1', to: 'L1' };

  const filename = `prospects-${(city || 'all').replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.xlsx`;
  const outPath = path.join(__dirname, filename);
  await workbook.xlsx.writeFile(outPath);
  console.log(`✅ Saved: ${outPath}`);
})();
