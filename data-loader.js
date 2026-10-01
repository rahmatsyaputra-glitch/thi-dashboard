/**
 * data-loader.js  — API Gateway Version
 * Fetches data via Apps Script Web App gateway for security.
 * No direct Google Sheets access.
 *
 * Flow:
 *   1. Fetch quarter list from gateway (?action=list)
 *   2. For each quarter, fetch data (?action=data&quarter=Quarter+1)
 *   3. Parse JSON response into THI data structure
 */

// ─── CONFIG ───────────────────────────────────────────────────────────
const GATEWAY_URL   = 'https://script.google.com/macros/s/AKfycbxIGm4lZscQOV_rNJPrWu89qH5_IGa9ZsFQ-Da2gHHbCK6wajPUH6jtCVMmbk1eovCO7w/exec';
const GATEWAY_TOKEN = 'GW_hynCwPyhXbXi3vNAkArqluMh';

// ─── SURVEY DURATION CONFIG ───────────────────────────────────────────
const SURVEY_DURATION = {
  'Quarter 1': { start: '2026-01-15', end: '2026-01-18' },
  'Quarter 2': { start: '2026-04-14', end: '2026-04-18' },
  'Quarter 3': { start: null, end: null },
  'Quarter 4': { start: null, end: null },
};

// ─── AREA DEFINITIONS ─────────────────────────────────────────────────
const AREAS = [
  { key:'vv',  label:'Vision & Values',            items:[0,1,2,3] },
  { key:'ld',  label:'Leadership',                 items:[4,5,6,7,8] },
  { key:'tw',  label:'Teamwork',                   items:[9,10,11,12] },
  { key:'cm',  label:'Communication',              items:[13,14,15,16] },
  { key:'cu',  label:'Culture',                    items:[17,18,19,20] },
  { key:'pd',  label:'Personal Development',       items:[21,22,23,24] },
  { key:'ap',  label:'Accountability & Performance',items:[25,26,27,28,29] },
  { key:'rc',  label:'Recognition',                items:[30,31,32,33] },
  { key:'ws',  label:'Workplace Support',          items:[34,35,36] },
  { key:'in',  label:'Integrity',                  items:[37,38,39] },
  { key:'tx',  label:'Timmy Experience',           items:[40,41,42] },
];

const QUESTION_LABELS = [];

// ─── COLUMN DETECTION ─────────────────────────────────────────────────
let COL = { dept: 4, tenure: 5, q_start: 6, q_end: 49, q45: 50, q46: 51, city: 3, email: 1 };
let CHECKLIST_COLS = [];
let OTHER_V_COLS = [];
let OTHER_X_COLS = [];

function detectColumns(headerRow) {
  let col = { dept: 4, tenure: 5, q_start: 6, q_end: 49, q45: 50, q46: 51, city: 3, email: 1 };
  let checklistCols = [];
  let otherVCols = [], otherXCols = [];
  let deptIdx = -1, tenureIdx = -1, qStart = -1, q45Idx = -1, q46Idx = -1, cityIdx = -1, emailIdx = -1;

  headerRow.forEach((cell, i) => {
    const c  = (cell || '').trim();
    const cl = c.toLowerCase();

    if (cl === 'email address' || cl === 'email') { emailIdx = i; return; }
    if (cl.includes('office location') || cl === 'city') { cityIdx = i; return; }
    if (c === 'Team' || cl === 'team') { deptIdx = i; return; }
    if (cl.startsWith('how long'))     { tenureIdx = i; return; }
    if (qStart === -1 && (c.match(/^1\./) || cl.includes('believe in the vision'))) {
      qStart = i; return;
    }
    if (cl.includes('top 3 things') && cl.includes('done well')) { q45Idx = i; return; }
    if (cl.includes('top 3 things') && cl.includes('improve'))   { q46Idx = i; return; }

    // "Other V" / "Other X" — free-text custom topics, separate from the fixed checklist
    if (c === 'Other V') { otherVCols.push(i); return; }
    if (c === 'Other X') { otherXCols.push(i); return; }

    if (q46Idx > -1 && i > q46Idx && c.length > 1) {
      const isChecklist = cl.includes('v=') || cl.includes('x=') || cl.includes('✓') ||
        cl.includes('vision') || cl.includes('leadership') || cl.includes('teamwork') ||
        cl.includes('culture') || cl.includes('integrity') || cl.includes('recognition') ||
        cl.includes('communication') || cl.includes('accountability') ||
        cl.includes('personal development') || cl.includes('timmy experience') ||
        cl.includes('workplace');
      if (isChecklist) {
        const label = c.replace(/^[vVxX]=\s*/,'').replace(/✓/,'').trim();
        checklistCols.push({ idx: i, label });
      }
    }
  });

  if (deptIdx > -1)   col.dept    = deptIdx;
  if (tenureIdx > -1) col.tenure  = tenureIdx;
  if (cityIdx > -1)   col.city    = cityIdx;
  if (emailIdx > -1)  col.email   = emailIdx;
  if (qStart > -1) {
    col.q_start = qStart;
    col.q_end   = qStart + 43;
  }
  if (q45Idx > -1) col.q45 = q45Idx;
  if (q46Idx > -1) col.q46 = q46Idx;

  // Fill QUESTION_LABELS from the actual header text of each question column
  // (only once — first quarter to detect columns wins, avoids overwriting on later loads)
  if (QUESTION_LABELS.length === 0) {
    for (let i = col.q_start; i <= col.q_end; i++) {
      const raw = (headerRow[i] || '').trim();
      // Strip a leading "1. " / "12." style numbering if present
      const clean = raw.replace(/^\d+\.\s*/, '');
      QUESTION_LABELS.push(clean || `Question ${i - col.q_start + 1}`);
    }
  }

  console.log('Detected columns →', JSON.stringify(col));
  console.log('Checklist cols →', checklistCols.map(c=>c.label));
  console.log('Other V/X cols →', otherVCols, otherXCols);

  // Also update globals for backward compat
  Object.assign(COL, col);
  CHECKLIST_COLS = checklistCols;
  OTHER_V_COLS = otherVCols;
  OTHER_X_COLS = otherXCols;

  return { col, checklistCols, otherVCols, otherXCols };
}

// ─── ROW PARSER ───────────────────────────────────────────────────────
function parseRow(row, col, checklistCols) {
  // Fallback to globals if not passed
  col = col || COL;
  checklistCols = checklistCols || CHECKLIST_COLS;

  const qs = [];
  for (let i = col.q_start; i <= col.q_end; i++) {
    const v = parseInt(row[i]);
    qs.push(isNaN(v) ? null : v);
  }
  const checklist = {};
  checklistCols.forEach(({idx, label}) => {
    const val = (row[idx] || '').toString().trim().toUpperCase();
    if (val === 'V' || val === '✓' || val === 'TRUE' || val === '1') checklist[label] = 'V';
    else if (val === 'X' || val === 'FALSE') checklist[label] = 'X';
    else checklist[label] = null;
  });
  // "Other V"/"Other X" — free-text custom topic names, not V/X marks
  const otherWell = OTHER_V_COLS.map(idx => (row[idx] || '').toString().trim()).filter(Boolean);
  const otherImprove = OTHER_X_COLS.map(idx => (row[idx] || '').toString().trim()).filter(Boolean);
  return {
    timestamp: row[0],
    email:     (row[col.email] || '').toString().trim().toLowerCase(),
    // city/dept/deptGroup/tenure/level below are SELF-REPORTED form answers —
    // used only as a fallback for a respondent whose email isn't found in the
    // Participant roster. For everyone else, parsePopulation's roster join
    // (in loadQuarterData, right after this parses) overwrites all five with
    // the authoritative HR data, since Timmys often get their own Team/tenure/
    // location form answers wrong or stale.
    city:      normalizeCity(row[col.city]),
    dept:      normalizeTeam(row[col.dept]),
    deptGroup: getDeptGroup(normalizeTeam(row[col.dept])),
    tenure:    parseTenure(row[col.tenure]),
    level:     null, // only ever comes from the roster join — no self-reported fallback exists for this one
    qs,
    q45:       row[col.q45] || '',
    q46:       row[col.q46] || '',
    checklist,
    otherWell,
    otherImprove,
  };
}

// ─── NORMALIZERS ──────────────────────────────────────────────────────
// "Office Location" is a free-text form field, not a fixed dropdown — different
// quarters (and different people) have typed the same city with different
// capitalization (e.g. Q1 "SURABAYA" vs Q2 "Surabaya"). Since the dashboard
// treats city values as exact strings everywhere (filters, filtering logic,
// the SR Feedback sheet lookup), an un-normalized mismatch would silently
// split what should be one location into two, or make a curated Location
// entry stop matching depending on which quarter is active. Canonicalize to
// one consistent spelling/casing per known location, same pattern as normalizeTeam.
function normalizeCity(raw) {
  const t = (raw || '').toString().trim();
  if (!t) return 'UNKNOWN';
  const map = {
    'Jakarta (IDN HQ)':'JAKARTA (IDN HQ)', 'Jakarta':'JAKARTA (IDN HQ)',
    'Surabaya':'SURABAYA', 'Palangkaraya':'PALANGKARAYA', 'Jogja':'JOGJA',
    'Yogyakarta':'JOGJA', 'Bandung':'BANDUNG', 'Medan':'MEDAN', 'Bali':'BALI',
  };
  if (map[t]) return map[t];
  const key = Object.keys(map).find(k => k.toLowerCase() === t.toLowerCase());
  return key ? map[key] : t.toUpperCase(); // unknown city — still normalize casing rather than discard it
}

function normalizeTeam(raw) {
  const t = (raw || '').trim();
  const map = {
    'Audience Development':'Audience Development','Boss Creator':'Boss Creator',
    'Business Development':'Commercial','Business Operations':'Business Operations',
    'Commercial':'Commercial','Communications':'Communications',
    'Corporate Strategy':'Corporate Strategy','Engineering':'Engineering',
    'Finance & Accounting':'Finance & Accounting','Finance':'Finance & Accounting','Fortune':'Fortune',
    'GGWP':'GGWP','GGWP ID.':'GGWP','GGWP.ID':'GGWP','ICE':'ICE','IDN App':'IDN App','IDN Creative':'IDN Creative',
    'IDN Event':'IDN Event','IDN Kids':'IDN Kids',
    'IDN Research Institute':'IDN Research Institute','IDN Times':'IDN Times',
    'JKT48':'JKT48','Lifestyle Media':'Lifestyle Media','Marketing':'Marketing',
    'People & Culture':'People & Culture','People Operations':'People & Culture',
    'Product':'Product','Special Project':'Special Project','Video':'Video',
  };
  if (map[t]) return map[t];
  const key = Object.keys(map).find(k => k.toLowerCase() === t.toLowerCase());
  if (key) return map[key];
  if (t) console.warn('Unknown dept:', t);
  return t || 'Unknown';
}

// Some departments were renamed/merged between quarters. "Business Development" → "Commercial"
// is a straight rename (handled above in normalizeTeam, so it's seamless everywhere).
// "Audience Development" + "Communications" merged INTO "Marketing" from Q2 onward — but unlike
// the Commercial rename, we still want to see Audience Development / Communications as their own
// distinct departments where they existed (Q1), while ALSO being able to view the combined
// "Marketing" history across quarters. DEPT_GROUPS captures that second, non-destructive mapping.
const DEPT_GROUPS = {
  'Audience Development': 'Marketing',
  'Communications': 'Marketing',
  'Marketing': 'Marketing',
};
function getDeptGroup(dept) {
  const t = (dept || '').toString().trim();
  if (DEPT_GROUPS[t]) return DEPT_GROUPS[t];
  const key = Object.keys(DEPT_GROUPS).find(k => k.toLowerCase() === t.toLowerCase());
  return key ? DEPT_GROUPS[key] : (dept || '');
}

function parseTenure(raw) {
  const t = (raw || '').toString().trim().toLowerCase();
  if (t.includes('6 month') && t.includes('<') || t === '< 6 months' || t.includes('less than 6') || t.includes('baru') || t.includes('0-6')) return '< 6 months';
  if ((t.includes('6') && t.includes('1')) || t.includes('6 month') || t.includes('6-12') || t.includes('half') || t.includes('6 bln') || t === '6 months – 1 yr') return '6 months – 1 yr';
  if (t.includes('1') && t.includes('2') && !t.includes('12')) return '1 – 2 years';
  if (t.includes('2') && t.includes('3')) return '2 – 3 years';
  if (t.includes('3') && t.includes('4')) return '3 – 4 years';
  if (t.includes('4') && t.includes('5')) return '4 – 5 years';
  if (t.includes('5') || t.includes('more than') || t.includes('lebih')) return '> 5 years';
  return raw || '';
}

// Buckets a raw "Position Level" value into one of 6 canonical levels.
// Anything that doesn't clearly match Associate/Manager/Team Lead falls into "Functional".
const LEVEL_ORDER = ['Associate','Sr. Associate','Manager','Sr. Manager','Functional','Team Lead'];
function normalizeLevel(raw) {
  const t = (raw || '').toString().trim().toLowerCase();
  if (!t) return null;
  const isSr = /\bsr\.?\b/i.test(t) || /\bsenior\b/i.test(t);
  if (t.includes('team lead') || t.includes('teamlead') || t === 'tl') return 'Team Lead';
  if (t.includes('manager')) return isSr ? 'Sr. Manager' : 'Manager';
  if (t.includes('associate')) return isSr ? 'Sr. Associate' : 'Associate';
  if (t.includes('specialist') || t.includes('principal') || t.includes('functional')) return 'Functional';
  return null; // doesn't fit any of the 6 canonical levels — excluded from the Level breakdown
}

// ─── SCORE CALCULATIONS ───────────────────────────────────────────────
function calcAreaScores(respondents, method = 'avg') {
  if (!respondents || !respondents.length) {
    const empty = { total: 0 };
    AREAS.forEach(a => { empty[a.key] = 0; });
    return empty;
  }
  const score = (vals, method) => {
    if (!vals.length) return 0;
    if (method === 'avg') return (vals.reduce((a,b)=>a+b,0)/vals.length / 7) * 100;
    const fav = method === 'fav67'
      ? vals.filter(v => v >= 6).length / vals.length * 100
      : vals.filter(v => v >= 5).length / vals.length * 100;
    return fav;
  };
  const result = {};
  AREAS.forEach(a => {
    const vals = respondents.flatMap(r => a.items.map(i => r.qs[i]).filter(v => v !== null && !isNaN(v)));
    result[a.key] = score(vals, method);
  });
  // Total = average of the 11 area scores (each area weighted equally),
  // NOT the average of all raw answers (which would weight areas by question count).
  const areaScores = AREAS.map(a => result[a.key]);
  result.total = areaScores.reduce((a,b) => a+b, 0) / areaScores.length;
  return result;
}

function calcItemScores(respondents, method = 'avg') {
  return AREAS.flatMap(a => a.items.map(i => {
    const vals = respondents.map(r => r.qs[i]).filter(v => v !== null && !isNaN(v));
    if (!vals.length) return { area: a.label, item: i + 1, score: 0, n: 0 };
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    return { area: a.label, item: i + 1, score: method === 'avg' ? (avg / 7) * 100 : vals.filter(v => v >= (method === 'fav67' ? 6 : 5)).length / vals.length * 100, n: vals.length };
  }));
}

function calcNPS(respondents) {
  const vals = respondents.map(r => r.qs[43]).filter(v => v !== null && !isNaN(v));
  if (!vals.length) return { nps: 0, promoters: 0, passives: 0, detractors: 0, n: 0 };
  const promoters  = vals.filter(v => v >= 6).length;              // 6 & 7
  const detractors = vals.filter(v => v <= 2).length;              // 1 & 2
  const passives   = vals.filter(v => v >= 3 && v <= 5).length;    // 3, 4 & 5
  return {
    nps: ((promoters - detractors) / vals.length) * 100,
    promoters:  (promoters  / vals.length) * 100,
    passives:   (passives   / vals.length) * 100,
    detractors: (detractors / vals.length) * 100,
    n: vals.length,
  };
}

function calcHeatmapDept(respondents, method) {
  const depts = [...new Set(respondents.map(r=>r.dept))].sort();
  const rows  = AREAS.map(area => {
    const cols = {};
    depts.forEach(d => {
      const sub = respondents.filter(r=>r.dept===d);
      if (!sub.length) { cols[d] = null; return; }
      cols[d] = Math.round(calcAreaScores(sub, method)[area.key]);
    });
    const allSc = calcAreaScores(respondents, method);
    cols['_all'] = Math.round(allSc[area.key]);
    return { area: area.label, cols };
  });
  const totalCols = {};
  depts.forEach(d => {
    const sub = respondents.filter(r=>r.dept===d);
    if (!sub.length) { totalCols[d] = null; return; }
    const sc = calcAreaScores(sub, method);
    totalCols[d] = Math.round(sc.total);
  });
  totalCols['_all'] = Math.round(calcAreaScores(respondents, method).total);
  return { depts, rows, totalCols };
}

function calcHeatmapTenure(respondents, method) {
  const tenures = ['< 6 months','6 months – 1 yr','1 – 2 years','2 – 3 years','3 – 4 years','4 – 5 years','> 5 years'];
  const rows = AREAS.map(area => {
    const cols = {};
    tenures.forEach(t => {
      const sub = respondents.filter(r=>r.tenure===t);
      if (!sub.length) { cols[t] = null; return; }
      cols[t] = Math.round(calcAreaScores(sub, method)[area.key]);
    });
    const allSc = calcAreaScores(respondents, method);
    cols['_all'] = Math.round(allSc[area.key]);
    return { area: area.label, cols };
  });
  const totalCols = {};
  tenures.forEach(t => {
    const sub = respondents.filter(r=>r.tenure===t);
    if (!sub.length) { totalCols[t] = null; return; }
    totalCols[t] = Math.round(calcAreaScores(sub, method).total);
  });
  totalCols['_all'] = Math.round(calcAreaScores(respondents, method).total);
  return { tenures, rows, totalCols };
}

function calcHeatmapLevel(respondents, method) {
  const levels = LEVEL_ORDER.filter(l => respondents.some(r => r.level === l));
  const rows = AREAS.map(area => {
    const cols = {};
    levels.forEach(l => {
      const sub = respondents.filter(r=>r.level===l);
      if (!sub.length) { cols[l] = null; return; }
      cols[l] = Math.round(calcAreaScores(sub, method)[area.key]);
    });
    const allSc = calcAreaScores(respondents, method);
    cols['_all'] = Math.round(allSc[area.key]);
    return { area: area.label, cols };
  });
  const totalCols = {};
  levels.forEach(l => {
    const sub = respondents.filter(r=>r.level===l);
    if (!sub.length) { totalCols[l] = null; return; }
    totalCols[l] = Math.round(calcAreaScores(sub, method).total);
  });
  totalCols['_all'] = Math.round(calcAreaScores(respondents, method).total);
  return { levels, rows, totalCols };
}

// ─── THI GLOBAL OBJECT ────────────────────────────────────────────────
window.THI = {
  quarters: [],
  activeQuarter: 0,
  activeMethod: 'avg',
  openFeedback: {},
  config: {},
  scopedDept: null, // null = admin (all depts). A department name = locked to that dept only.
  AREAS, QUESTION_LABELS,
  calcAreaScores, calcItemScores, calcNPS, calcHeatmapDept, calcHeatmapTenure, calcHeatmapLevel, getDeptGroup,
};

// ─── API FETCH HELPERS ────────────────────────────────────────────────
// Retries transient upstream failures — Apps Script sometimes rejects a request
// with a 404/500 when several quarters are fetched in parallel (concurrency limits),
// even though the underlying script is healthy. Genuine errors (e.g. "Quarter not
// found in Source sheet") are not transient and are not retried.
async function gatewayFetch(params, retries = 2, delayMs = 800) {
  const url = new URL(GATEWAY_URL);
  url.searchParams.set('token', GATEWAY_TOKEN);
  if (THI.accessToken && !params.access_token) url.searchParams.set('access_token', THI.accessToken);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`Gateway error: ${res.status}`);
      const data = await res.json();

      const isTransientUpstreamError = data && data.error && /returned \d+/.test(data.error);
      if (isTransientUpstreamError && attempt < retries) {
        throw new Error(data.error);
      }
      return data;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        console.warn(`Gateway fetch failed (attempt ${attempt + 1}/${retries + 1}) for ${JSON.stringify(params)}, retrying in ${delayMs * (attempt + 1)}ms...`, e.message);
        await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

// ─── LOAD QUARTER LIST ────────────────────────────────────────────────
async function loadRegistry() {
  try {
    const data = await gatewayFetch({ action: 'list' });
    if (data.error) throw new Error(data.error);
    return data.quarters.map(q => ({
      label:       q.label,
      url:         q.url || null,
      sheetId:     q.url || null,  // alias — script.js checks sheetId to know if quarter has data
      year:        q.year || null,
      respondents: null,
      loaded:      false,
      population:  null,
    }));
  } catch(e) {
    console.error('Registry fetch failed:', e);
    // Fallback — 4 empty quarters
    return ['Quarter 1','Quarter 2','Quarter 3','Quarter 4'].map(label => ({
      label, url: null, sheetId: null, year: null, respondents: [], loaded: false, population: null,
    }));
  }
}

// ─── LOAD QUARTER DATA ────────────────────────────────────────────────
async function loadQuarterData(quarter) {
  if (quarter.loaded) return;
  if (!quarter.url) {
    quarter.respondents = [];
    quarter.loaded = true;
    return;
  }
  try {
    const data = await gatewayFetch({ action: 'data', quarter: quarter.label });
    if (data.error) throw new Error(data.error);

    let qCol = null, qChecklistCols = [];
    if (data.headers && data.headers.length) {
      const detected = detectColumns(data.headers);
      qCol = detected.col;
      qChecklistCols = detected.checklistCols;
    }

    const col = qCol || COL;
    const ckCols = qChecklistCols.length ? qChecklistCols : CHECKLIST_COLS;

    // Require email + at least one survey answer to count as a respondent — NOT
    // a filled-in "Team" field, since dept now comes from the Participant
    // roster join below rather than this self-reported form field, and
    // requiring it here could wrongly drop a real response that left it blank.
    const respondents = (data.respondents || [])
      .filter(row => row[col.email] && row[col.q_start])
      .map(row => parseRow(row, col, ckCols))
      .filter(r => r.qs.some(v => v !== null));

    quarter.respondents = respondents;
    quarter.loaded = true;
    console.log(`Loaded ${respondents.length} respondents for ${quarter.label}`);

    if (data.population) {
      parsePopulation(quarter, data.population);
    }

  } catch(e) {
    console.error(`Failed to load ${quarter.label}:`, e);
    quarter.respondents = [];
    quarter.loaded = true;
  }
}
window.loadQuarterData = loadQuarterData;

// ─── PARSE POPULATION ─────────────────────────────────────────────────
function parsePopulation(quarter, popData) {
  try {
    const rows    = popData.rows    || [];
    const headers = popData.headers || [];
    const total   = popData.total   || rows.length;

    // Auto-detect dept, tenure, email, level, name, and city columns from headers.
    // The Participant sheet is the authoritative HR roster for all of these — a
    // Timmy's self-reported answers in the survey form (Team/tenure/location
    // dropdowns) are frequently wrong or stale, so those fields get OVERWRITTEN
    // from this roster by email further down (see the join after parseRow),
    // rather than trusted from the form. Email is the only field read from the
    // form responses for identification/joining purposes.
    let deptCol   = -1;
    let tenureCol = -1;
    let emailCol  = -1;
    let levelCol  = -1;
    let nameCol   = -1;
    let cityCol   = -1;
    headers.forEach((h, i) => {
      const hl = (h || '').toString().trim().toLowerCase();
      if (deptCol   === -1 && (hl === 'department' || hl.includes('dept') || hl === 'team')) deptCol = i;
      if (emailCol  === -1 && (hl === 'email' || hl === 'email address')) emailCol = i;
      if (levelCol  === -1 && (hl === 'level' || hl === 'leveling' || hl.includes('level'))) levelCol = i;
      // "Name"/"Full Name"/"Nama" but not things like "Username" or "Department Name"
      if (nameCol   === -1 && (hl === 'name' || hl === 'full name' || hl === 'nama' || hl === 'employee name')) nameCol = i;
      if (cityCol   === -1 && (hl === 'office location' || hl === 'city' || hl === 'location')) cityCol = i;
    });

    // Fallback to known positions if not found in headers
    if (deptCol   === -1) deptCol   = 8;  // column I
    tenureCol = 20; // column U — always, no header-name guessing (avoids re-matching the wrong column)

    console.log(`Participant: total=${total}, deptCol=${deptCol}(${headers[deptCol]}), tenureCol=${tenureCol}(${headers[tenureCol]}), emailCol=${emailCol}(${headers[emailCol]}), levelCol=${levelCol}(${headers[levelCol]}), nameCol=${nameCol}(${headers[nameCol]})`);
    console.log('Participant sheet headers →', JSON.stringify(headers));

    const byDept = {}, byDeptGroup = {}, byTenure = {}, byLevel = {};
    const emailToLevel = {};
    // The single source of truth for joining HR data onto each survey response
    // by email — dept/deptGroup/tenure/city/level all come from here, not from
    // whatever the Timmy typed/selected in the survey form itself.
    const emailToRoster = {};
    let levelColRawSample = [];
    const tenureRawSeen = {}; // raw text -> {parsedTo, count} — diagnoses unmatched tenure text
    // Individual roster entries — needed to answer "who specifically hasn't
    // responded yet" (Participation table's click-to-detail popover), not just
    // the aggregate counts below. Keeps only what that feature needs.
    const roster = [];

    if (rows.length && deptCol > -1) {
      rows.forEach(r => {
        const dept   = normalizeTeam(r[deptCol]);
        const group  = getDeptGroup(dept);
        const tenureRaw = (r[tenureCol] || '').toString().trim();
        const tenure = parseTenure(r[tenureCol]);
        const city   = cityCol > -1 ? normalizeCity(r[cityCol]) : null;
        if (dept)   byDept[dept]         = (byDept[dept]      || 0) + 1;
        if (group)  byDeptGroup[group]   = (byDeptGroup[group]|| 0) + 1;
        if (tenure) byTenure[tenure]     = (byTenure[tenure]  || 0) + 1;
        if (tenureRaw) {
          if (!tenureRawSeen[tenureRaw]) tenureRawSeen[tenureRaw] = { parsedTo: tenure, count: 0 };
          tenureRawSeen[tenureRaw].count++;
        }
        let normLevel = null;
        if (emailCol > -1 && levelCol > -1) {
          const email = (r[emailCol] || '').toString().trim().toLowerCase();
          const level = (r[levelCol] || '').toString().trim();
          if (levelColRawSample.length < 5) levelColRawSample.push(r[levelCol]);
          if (email && level) {
            normLevel = normalizeLevel(level);
            emailToLevel[email] = normLevel;
            if (normLevel) byLevel[normLevel] = (byLevel[normLevel] || 0) + 1;
          }
        }
        const email = emailCol > -1 ? (r[emailCol] || '').toString().trim().toLowerCase() : '';
        const name  = nameCol  > -1 ? (r[nameCol]  || '').toString().trim() : '';
        if (email) emailToRoster[email] = { dept, deptGroup: group, tenure, city, level: normLevel };
        if (email || name) roster.push({ name: name || email || 'Unknown', email, dept, deptGroup: group, tenure, level: normLevel });
      });
    }
    if (levelCol > -1) console.log('Sample raw values from detected Level column →', JSON.stringify(levelColRawSample));
    if (tenureCol > -1) console.log(`Raw Tenure values seen in Participant sheet (${quarter.label}) → parsed bucket →`, tenureRawSeen);

    quarter.population = {
      total: total || rows.length,
      byDept,
      byDeptGroup,
      byTenure,
      byLevel,
      emailToLevel, // kept for compat; superseded by emailToRoster below
      emailToRoster, // {dept,deptGroup,tenure,city,level} by email — the HR source of truth
      roster, // individual {name,email,dept,deptGroup,tenure,level} — for "who hasn't responded"
    };
    console.log(`Population set for ${quarter.label}: ${quarter.population.total} total, ${Object.keys(emailToLevel).length} with Level, ${Object.keys(emailToRoster).length} with full roster match`);

    // Overwrite each respondent's dept/deptGroup/tenure/city/level with the
    // Participant roster's values, joined by email — the HR roster is treated
    // as authoritative over whatever the Timmy typed/selected in the survey
    // form itself (self-reported Team/tenure/location answers are frequently
    // wrong or stale). A respondent whose email isn't found in the roster
    // (e.g. a brand-new hire not yet added, or a typo'd email) keeps their
    // self-reported form values as a fallback rather than losing the data —
    // logged below so mismatches stay visible rather than silently swallowed.
    if (quarter.respondents?.length) {
      let matched = 0, unmatched = [];
      quarter.respondents.forEach(r => {
        const hr = emailToRoster[r.email];
        if (hr) {
          r.dept = hr.dept || r.dept;
          r.deptGroup = hr.deptGroup || r.deptGroup;
          r.tenure = hr.tenure || r.tenure;
          r.city = hr.city || r.city;
          r.level = hr.level ?? r.level;
          matched++;
        } else {
          unmatched.push(r.email);
        }
      });
      console.log(`Roster join for ${quarter.label}: ${matched} matched by email, ${unmatched.length} fell back to self-reported form answers${unmatched.length ? ' → ' + JSON.stringify(unmatched.slice(0,10)) + (unmatched.length>10?' …':'') : ''}`);
    }

  } catch(e) {
    console.warn('Failed to parse population:', e);
    // Last resort fallback
    if (quarter.respondents?.length) {
      quarter.population = { total: quarter.respondents.length, byDept: {}, byDeptGroup: {}, byTenure: {}, byLevel: {}, emailToLevel: {} };
    }
  }
}

// ─── OPEN FEEDBACK BY DEPARTMENT ──────────────────────────────────────
// Reads the "Open Feedback" sheet in the same THI gateway file. Expected columns
// (per the sheet layout): B=Dept, C=Quarter, D=What we did well, E=What we need to improve.
// Each of D/E is a single cell with multiple "- " bullet lines.
function parseBullets(text) {
  if (!text) return [];
  return text.toString()
    .split(/\r?\n/)
    .map(line => line.replace(/^[-•]\s*/, '').trim())
    .filter(line => line.length > 0);
}

async function loadOpenFeedback() {
  try {
    // "Open Feedback" is a tab inside the same THI gateway file, not a registered
    // quarter — so it can't go through action='data' (that looks the quarter name
    // up in the "Source" registry sheet, pointing to a separate external sheet).
    // This needs a dedicated gateway action that reads the tab directly from the
    // bound spreadsheet. See apps-script-open-feedback-snippet.gs for the Code.gs
    // addition this depends on.
    const data = await gatewayFetch({ action: 'openFeedback' });
    if (data.error) throw new Error(data.error);

    // Auto-detect columns from the header row instead of hardcoding B/C/D/E,
    // in case the sheet layout shifts.
    const headers = data.headers || [];
    let deptIdx = -1, quarterIdx = -1, wellIdx = -1, impIdx = -1;
    headers.forEach((h, i) => {
      const hl = (h || '').toString().trim().toLowerCase();
      if (deptIdx    === -1 && (hl === 'dept' || hl === 'department')) deptIdx = i;
      if (quarterIdx === -1 && hl === 'quarter') quarterIdx = i;
      if (wellIdx    === -1 && (hl.includes('did well') || hl.includes('what we did'))) wellIdx = i;
      if (impIdx     === -1 && (hl.includes('need') && hl.includes('improve'))) impIdx = i;
    });
    // Fallback to the known layout (col B, C, D, E → index 1, 2, 3, 4) if headers weren't usable
    if (deptIdx    === -1) deptIdx = 1;
    if (quarterIdx === -1) quarterIdx = 2;
    if (wellIdx    === -1) wellIdx = 3;
    if (impIdx     === -1) impIdx = 4;

    const rows = data.respondents || data.rows || [];
    const byQuarter = {};
    rows.forEach(row => {
      const dept    = normalizeTeam(row[deptIdx]);
      const quarter = (row[quarterIdx] || '').toString().trim();
      if (!dept || !quarter) return;
      const well    = parseBullets(row[wellIdx]);
      const improve = parseBullets(row[impIdx]);
      if (!byQuarter[quarter]) byQuarter[quarter] = [];
      byQuarter[quarter].push({ dept, well, improve });
    });

    THI.openFeedback = byQuarter;
    console.log(`Loaded Open Feedback: ${Object.keys(byQuarter).map(q => `${q} (${byQuarter[q].length})`).join(', ')}`);
  } catch (e) {
    console.error('Failed to load Open Feedback sheet:', e);
    THI.openFeedback = {};
  }
}
window.loadOpenFeedback = loadOpenFeedback;

// ── CONFIG (Target NPS / Target OKR per quarter) ─────────────────────
async function loadConfig() {
  try {
    const data = await gatewayFetch({ action: 'config' });
    if (data.error) throw new Error(data.error);
    const map = {};
    (data.config || []).forEach(row => { map[row.quarter] = row; });
    THI.config = map;
    // The Config sheet's survey_start/survey_end columns are the real source of
    // truth for the Participation "Daily Progress" chart's date range — mirror
    // them into SURVEY_DURATION (previously a separate hardcoded object) so a
    // new quarter's dates just need to be filled into the sheet, not redeployed
    // in code. Only overwrite when the sheet actually has a value, so a quarter
    // with no survey_start/survey_end yet keeps falling back to whatever (if
    // anything) was hardcoded for it.
    Object.keys(map).forEach(label => {
      const row = map[label];
      if (!row.surveyStart && !row.surveyEnd) return;
      SURVEY_DURATION[label] = {
        start: row.surveyStart || SURVEY_DURATION[label]?.start || null,
        end:   row.surveyEnd   || SURVEY_DURATION[label]?.end   || null,
      };
    });
    console.log(`Loaded Config: ${Object.keys(map).join(', ')}`);
    console.log(`SURVEY_DURATION after merge: ${JSON.stringify(SURVEY_DURATION)}`);
  } catch (e) {
    console.error('Failed to load Config sheet:', e);
    THI.config = {};
  }
}
window.loadConfig = loadConfig;

// ── SR FEEDBACK (curated Open Feedback for Office Management / Culture &
// Learning) — read straight from the "SR Feedback" sheet, grouped into
// THI.srFeedback[quarter][location][area] = {well:[], improve:[], keywords:[]}.
// Adding a new quarter (or a new location breakdown) only means adding rows
// to that sheet — nothing here needs to change.
async function loadSRFeedback() {
  try {
    const data = await gatewayFetch({ action: 'srFeedback' });
    if (data.error) throw new Error(data.error);
    const tree = {};
    (data.rows || []).forEach(row => {
      const { quarter, location, area, type, text } = row;
      if (!quarter || !area || !type) return;
      if (!tree[quarter]) tree[quarter] = {};
      if (!tree[quarter][location]) tree[quarter][location] = {};
      if (!tree[quarter][location][area]) tree[quarter][location][area] = { well: [], improve: [], keywords: [] };
      const bucket = tree[quarter][location][area];
      if (type === 'well') bucket.well.push(text);
      else if (type === 'improve') bucket.improve.push(text);
      else if (type === 'keyword') bucket.keywords.push(text);
    });
    THI.srFeedback = tree;
    console.log(`Loaded SR Feedback: ${Object.keys(tree).map(q => `${q} (${Object.keys(tree[q]).join('/')})`).join(', ')}`);
  } catch (e) {
    console.error('Failed to load SR Feedback sheet:', e);
    THI.srFeedback = {};
  }
}
window.loadSRFeedback = loadSRFeedback;

// ── ACCESS TOKEN (per-department / admin / special role) ────────────
// Reads ?t=<token> from the URL and asks the gateway which department it
// unlocks. Returns {department:'ALL'} for admin, {department:'Engineering'}
// for a scoped dept token, {department:'ALL:Office Management'} for a
// full-access "special role" token (sees all depts, but gets its own
// dashboard design — see THI.specialRole below), or {error:'...'} if
// missing/invalid.
async function resolveAccessToken() {
  const params = new URLSearchParams(window.location.search);
  const accessToken = params.get('t');
  if (!accessToken) return { error: 'missing' };
  THI.accessToken = accessToken;
  try {
    const data = await gatewayFetch({ action: 'resolveToken', access_token: accessToken });
    if (data.error) return { error: data.error };
    return { department: data.department };
  } catch (e) {
    return { error: e.message };
  }
}
window.resolveAccessToken = resolveAccessToken;

// ─── INIT ─────────────────────────────────────────────────────────────
window.initDataLoader = async function() {
  // Registry, Open Feedback, Config, and SR Feedback live on independent sheets —
  // fetch all concurrently instead of one-after-another. Quarter data still has
  // to wait for the registry (we need the per-quarter URLs first).
  const [quarters] = await Promise.all([
    loadRegistry(),
    loadOpenFeedback(),
    loadConfig(),
    loadSRFeedback(),
  ]);
  THI.quarters = quarters;

  const withUrl = quarters.filter(q => q.url);
  await Promise.all(withUrl.map(q => loadQuarterData(q)));

  // Default to Quarter 1 (first loaded quarter)
  const first = quarters.find(q => q.loaded && q.respondents?.length) || quarters[0];
  THI.activeQuarter = quarters.indexOf(first);

  return THI;
};
