'use strict';

const { Router } = require('express');
const { getEmailLogs } = require('../db/statsRepository');
const logger = require('../utils/logger');

const router = Router();

// Bucketing by America/New_York calendar day so "today"/"yesterday" line up
// with the send cron's own timezone (CRON_TIMEZONE), not server UTC.
function nyDateKey(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));
}

function buildStats(logs, daysBack) {
  const byDay = {};
  const bySender = {};
  const byStage = {};
  let totalSent = 0;
  let totalFailed = 0;

  for (const row of logs) {
    const day = nyDateKey(row.created_at);
    if (!byDay[day]) byDay[day] = { sent: 0, failed: 0 };

    if (row.status === 'sent') {
      byDay[day].sent++;
      totalSent++;
      const senderKey = row.sender || '(unassigned — legacy)';
      bySender[senderKey] = (bySender[senderKey] || 0) + 1;
      byStage[row.stage] = (byStage[row.stage] || 0) + 1;
    } else if (row.status === 'failed') {
      byDay[day].failed++;
      totalFailed++;
    }
  }

  // Fill in every day in the window (even zero-send days) so the chart has a
  // continuous axis instead of only showing days that had activity.
  const days = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = nyDateKey(d.toISOString());
    days.push(key);
    if (!byDay[key]) byDay[key] = { sent: 0, failed: 0 };
  }

  const todayKey = days[days.length - 1];
  const yesterdayKey = days[days.length - 2];

  return {
    today: byDay[todayKey],
    yesterday: byDay[yesterdayKey] || { sent: 0, failed: 0 },
    totalSent,
    totalFailed,
    byDay,
    days,
    bySender,
    byStage,
  };
}

function renderHtml(stats, daysBack) {
  const maxDay = Math.max(1, ...stats.days.map((d) => stats.byDay[d].sent + stats.byDay[d].failed));

  const barsHtml = stats.days
    .map((d) => {
      const { sent, failed } = stats.byDay[d];
      const total = sent + failed;
      const heightPct = Math.round((total / maxDay) * 100);
      const sentPct = total ? Math.round((sent / total) * 100) : 0;
      const label = d.slice(5);
      return `
      <div class="bar-col" title="${d}: ${sent} sent, ${failed} failed">
        <div class="bar-count">${total || ''}</div>
        <div class="bar" style="height:${heightPct}%">
          <div class="bar-sent" style="height:${sentPct}%"></div>
        </div>
        <div class="bar-label">${label}</div>
      </div>`;
    })
    .join('');

  const senderRows = Object.entries(stats.bySender)
    .sort((a, b) => b[1] - a[1])
    .map(([sender, count]) => `<tr><td>${sender}</td><td>${count}</td></tr>`)
    .join('') || '<tr><td colspan="2">No sends yet</td></tr>';

  const stageRows = Object.entries(stats.byStage)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([stage, count]) => `<tr><td>Stage ${stage}</td><td>${count}</td></tr>`)
    .join('') || '<tr><td colspan="2">No sends yet</td></tr>';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>OutreachLocal — Email Dashboard</title>
<meta http-equiv="refresh" content="60">
<style>
  :root { color-scheme: dark light; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 24px; background: #0b0d12; color: #e6e8eb; }
  @media (prefers-color-scheme: light) { body { background: #f6f7f9; color: #1a1d23; } }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h3 { font-size: 14px; margin: 0 0 8px; color: #999; }
  .sub { color: #888; font-size: 13px; margin-bottom: 24px; }
  .cards { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 32px; }
  .card { background: rgba(127,127,127,0.08); border: 1px solid rgba(127,127,127,0.2); border-radius: 10px; padding: 16px 20px; min-width: 140px; }
  .card .num { font-size: 28px; font-weight: 700; }
  .card .lbl { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.04em; }
  .card.fail .num { color: #e5484d; }
  .chart { display: flex; align-items: flex-end; gap: 6px; height: 200px; margin-bottom: 32px; border-bottom: 1px solid rgba(127,127,127,0.2); padding-bottom: 4px; overflow-x: auto; }
  .bar-col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; min-width: 28px; height: 100%; }
  .bar { width: 20px; background: rgba(127,127,127,0.25); border-radius: 3px 3px 0 0; display: flex; align-items: flex-end; overflow: hidden; }
  .bar-sent { width: 100%; background: #3b82f6; }
  .bar-label { font-size: 10px; color: #888; margin-top: 4px; white-space: nowrap; }
  .bar-count { font-size: 10px; color: #666; margin-bottom: 2px; }
  table { border-collapse: collapse; margin-bottom: 24px; }
  th, td { text-align: left; padding: 6px 16px 6px 0; font-size: 13px; }
  th { color: #888; font-weight: 500; border-bottom: 1px solid rgba(127,127,127,0.2); }
  .grid { display: flex; gap: 48px; flex-wrap: wrap; }
</style>
</head>
<body>
  <h1>Cold Email Send Dashboard</h1>
  <div class="sub">outreachlocal · auto-refreshes every 60s · last ${daysBack} days (America/New_York)</div>

  <div class="cards">
    <div class="card"><div class="num">${stats.today.sent}</div><div class="lbl">Sent Today</div></div>
    <div class="card"><div class="num">${stats.yesterday.sent}</div><div class="lbl">Sent Yesterday</div></div>
    <div class="card"><div class="num">${stats.totalSent}</div><div class="lbl">Total (${daysBack}d)</div></div>
    <div class="card fail"><div class="num">${stats.totalFailed}</div><div class="lbl">Failed (${daysBack}d)</div></div>
  </div>

  <div class="chart">${barsHtml}</div>

  <div class="grid">
    <div>
      <h3>By Sender (${daysBack}d)</h3>
      <table><tr><th>Mailbox</th><th>Sent</th></tr>${senderRows}</table>
    </div>
    <div>
      <h3>By Stage (${daysBack}d)</h3>
      <table><tr><th>Stage</th><th>Sent</th></tr>${stageRows}</table>
    </div>
  </div>
</body>
</html>`;
}

// ─── GET /dashboard/emails ──────────────────────────────────────────────────
// HTML view. Query param: days (default 14, capped 60).
router.get('/dashboard/emails', async (req, res) => {
  try {
    const daysBack = Math.min(parseInt(req.query.days, 10) || 14, 60);
    const logs = await getEmailLogs(daysBack);
    const stats = buildStats(logs, daysBack);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderHtml(stats, daysBack));
  } catch (err) {
    logger.error('Email dashboard HTML error', { message: err.message });
    res.status(500).send(`<pre>Dashboard error: ${err.message}</pre>`);
  }
});

// ─── GET /dashboard/emails.json ─────────────────────────────────────────────
// Same data as JSON, for scripting/monitoring.
router.get('/dashboard/emails.json', async (req, res) => {
  try {
    const daysBack = Math.min(parseInt(req.query.days, 10) || 14, 60);
    const logs = await getEmailLogs(daysBack);
    res.json(buildStats(logs, daysBack));
  } catch (err) {
    logger.error('Email dashboard JSON error', { message: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
