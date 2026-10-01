/**
 * Capture City 2050 — anonymous game-end statistics, stored in a Google Sheet.
 *
 * Setup (once, by the sheet owner):
 *   1. Create a Google Sheet. Extensions → Apps Script. Replace the code with this file. Save.
 *   2. Deploy → New deployment → type "Web app" → Execute as: Me → Who has access: Anyone → Deploy.
 *   3. Copy the web-app URL (ends in /exec) into STATS_URL in game/index.html.
 *
 * POST (from the game, once per finished game): appends one row to the "games" tab.
 * GET  (anyone):  an aggregate JSON summary per region × difficulty (games, wins, causes of defeat, median end year)
 *                 — no individual rows, so nothing personal can be read back.
 */
const SHEET = 'games';
const COLS = ['received', 'v', 'region', 'diff', 'win', 'why', 'endYear', 'month', 'score', 'stars', 'cumCO2', 'captured',
  'anger', 'funds', 'blackouts', 'fails', 'maxBreach', 'plants', 'fleet', 'techs', 'found', 'price', 'lang', 'device', 'minutes', 'years'];
const REGIONS = ['taiwan', 'germany', 'texas'];
const DIFFS = ['easy', 'normal', 'hard', 'hell'];

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) { sh = ss.insertSheet(SHEET); sh.appendRow(COLS); sh.setFrozenRows(1); }
  return sh;
}

function doPost(e) {
  const body = e && e.postData && e.postData.contents || '';
  if (body.length > 6000) return ContentService.createTextOutput('too big');
  let d;
  try { d = JSON.parse(body); } catch (err) { return ContentService.createTextOutput('bad json'); }
  if (REGIONS.indexOf(d.region) < 0 || DIFFS.indexOf(d.diff) < 0) return ContentService.createTextOutput('bad game');
  d.received = new Date();
  const row = COLS.map(k => {
    const v = d[k];
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 2000);
    return typeof v === 'string' ? v.slice(0, 200) : v;
  });
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try { sheet_().appendRow(row); } finally { lock.releaseLock(); }
  return ContentService.createTextOutput('ok');
}

function doGet() {
  const rows = sheet_().getDataRange().getValues();
  const head = rows.shift() || [];
  const ix = k => head.indexOf(k);
  const out = {};
  rows.forEach(r => {
    const key = r[ix('region')] + '/' + r[ix('diff')];
    const g = out[key] || (out[key] = { games: 0, wins: 0, why: {}, endYears: [] });
    g.games += 1;
    if (r[ix('win')] === true || r[ix('win')] === 'TRUE') g.wins += 1;
    else { const w = r[ix('why')] || '?'; g.why[w] = (g.why[w] || 0) + 1; g.endYears.push(Number(r[ix('endYear')])); }
  });
  Object.keys(out).forEach(k => {
    const y = out[k].endYears.sort((a, b) => a - b);
    out[k].medianDefeatYear = y.length ? y[Math.floor(y.length / 2)] : null;
    delete out[k].endYears;
  });
  return ContentService.createTextOutput(JSON.stringify({ updated: new Date(), groups: out })).setMimeType(ContentService.MimeType.JSON);
}
