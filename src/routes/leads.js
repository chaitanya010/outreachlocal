const { Router } = require('express');
const { runPipeline, DEFAULT_TYPES } = require('../jobs/leadPipeline');
const { getLeads } = require('../db/leadsRepository');
const { getColdCallContext } = require('../services/prospectScorer');
const logger = require('../utils/logger');

const router = Router();

// ─── POST /generate-leads ─────────────────────────────────────────────────────

/**
 * Trigger lead generation pipeline for a city.
 *
 * Body: { city: string, types?: string[] }
 */
router.post('/generate-leads', async (req, res) => {
  const { city, types } = req.body;

  if (!city || typeof city !== 'string' || !city.trim()) {
    return res.status(400).json({ error: 'city is required' });
  }

  const businessTypes = Array.isArray(types) && types.length ? types : DEFAULT_TYPES;

  try {
    const summary = await runPipeline(city.trim(), businessTypes);
    return res.status(200).json({ success: true, ...summary });
  } catch (err) {
    logger.error('Pipeline error', { message: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /leads ───────────────────────────────────────────────────────────────

/**
 * Query stored leads.
 *
 * Query params:
 *   noWebsite=true        only businesses without a website
 *   city=Miami            filter by city
 *   status=pending        filter by outreach_status
 *   limit=100             pagination
 *   offset=0
 */
router.get('/leads', async (req, res) => {
  const {
    noWebsite,
    city,
    status,
    limit = '100',
    offset = '0',
  } = req.query;

  const opts = {
    noWebsite: noWebsite === 'true',
    city: city || undefined,
    outreachStatus: status || undefined,
    limit: Math.min(parseInt(limit, 10) || 100, 500),
    offset: parseInt(offset, 10) || 0,
  };

  try {
    const { leads, total } = await getLeads(opts);
    return res.status(200).json({
      total,
      count: leads.length,
      offset: opts.offset,
      leads,
    });
  } catch (err) {
    logger.error('Get leads error', { message: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /dashboard ───────────────────────────────────────────────────────────

/**
 * Simple aggregate stats for a quick dashboard view.
 */
router.get('/dashboard', async (req, res) => {
  try {
    const [all, noWebsite, pending, contacted] = await Promise.all([
      getLeads({ limit: 1 }),
      getLeads({ noWebsite: true, limit: 1 }),
      getLeads({ outreachStatus: 'pending', limit: 1 }),
      getLeads({ outreachStatus: 'contacted', limit: 1 }),
    ]);

    return res.status(200).json({
      totalLeads: all.total,
      noWebsiteLeads: noWebsite.total,
      outreach: {
        pending: pending.total,
        contacted: contacted.total,
      },
    });
  } catch (err) {
    logger.error('Dashboard error', { message: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /leads/export ────────────────────────────────────────────────────────

/**
 * Export prospects as a formatted Excel (.xlsx) file.
 * Query params: city?, minScore=0, limit=1000
 */
router.get('/leads/export', async (req, res) => {
  const ExcelJS = require('exceljs');
  const { city, minScore = '0', limit = '1000' } = req.query;

  try {
    const { leads } = await getLeads({
      city: city || undefined,
      limit: Math.min(parseInt(limit, 10) || 1000, 2000),
      offset: 0,
    });

    const min = parseInt(minScore, 10) || 0;
    const prospects = leads
      .filter((l) => (l.prospect_score || 0) >= min)
      .sort((a, b) => (b.prospect_score || 0) - (a.prospect_score || 0));

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'StanWeb.tech';
    const sheet = workbook.addWorksheet('Prospects', { views: [{ state: 'frozen', ySplit: 1 }] });

    // ── Column definitions ──
    sheet.columns = [
      { header: 'Business Name',    key: 'name',          width: 30 },
      { header: 'Business Type',    key: 'business_type', width: 22 },
      { header: 'City',             key: 'city',          width: 18 },
      { header: 'Phone',            key: 'phone',         width: 18 },
      { header: 'Email',            key: 'email',         width: 28 },
      { header: 'Rating',           key: 'rating',        width: 10 },
      { header: 'Reviews',          key: 'review_count',  width: 10 },
      { header: 'Has Website',      key: 'has_website',   width: 13 },
      { header: 'Has Booking',      key: 'has_booking',   width: 13 },
      { header: 'Prospect Score',   key: 'prospect_score',width: 15 },
      { header: 'Problems',         key: 'problems',      width: 35 },
      { header: 'Cold Call Notes',  key: 'notes',         width: 60 },
    ];

    // ── Header row styling ──
    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF1D4ED8' } } };
    });
    headerRow.height = 28;

    // ── Data rows ──
    prospects.forEach((l, i) => {
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

      // Alternate row background
      const bgColor = i % 2 === 0 ? 'FFFFFFFF' : 'FFF0F4FF';
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        cell.alignment = { vertical: 'middle', wrapText: false };
      });

      // Score cell: green (high) → yellow → red (low)
      const scoreCell = row.getCell('prospect_score');
      const fgColor = score >= 70 ? 'FF16A34A' : score >= 40 ? 'FFD97706' : 'FFDC2626';
      scoreCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      scoreCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fgColor } };
      scoreCell.alignment = { horizontal: 'center', vertical: 'middle' };

      // Has Website / Has Booking color
      ['has_website', 'has_booking'].forEach((key) => {
        const cell = row.getCell(key);
        const isNo = cell.value === 'No';
        cell.font = { color: { argb: isNo ? 'FFDC2626' : 'FF16A34A' }, bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });

      row.height = 20;
    });

    // ── Auto-filter on header ──
    sheet.autoFilter = { from: 'A1', to: 'L1' };

    const filename = `prospects-${(city || 'all').replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    logger.error('Export error', { message: err.message });
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
