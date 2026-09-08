import Papa from 'papaparse';
import { parse, isWithinInterval, startOfDay, endOfDay } from 'date-fns';

// ─── Sheet IDs ────────────────────────────────────────────────────────────────
const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export const SHEET_IDS = {
  employee:   '1tolJ6KfjF9RQwEb6Sv-WraZctm8SD7PzYswTaj5x5VQ',
  attendance: '1Y8FWhSqwd-pMrGAGM9-ja8Pq_PTJ58sUHET1aJsUte0',
  sickLeave:  '1EyQF18Coi_SHgThuDxSHNQNrJ7sRc_1aYNLNYy9Fvg8',
};

// ─── Config Sheet GIDs ───────────────────────────────────────────────────────
export const CONFIG_SHEET_ID  = '1tolJ6KfjF9RQwEb6Sv-WraZctm8SD7PzYswTaj5x5VQ';
export const CONFIG_HOL_GID   = '168585636';
export const CONFIG_SET_GID   = '389494663';

// ─── Fetch config from Google Sheets ─────────────────────────────────────────
export async function fetchConfig() {
  const result = { holidays: {}, settings: {} };
  try {
    // Fetch holidays
    const holUrl = `https://docs.google.com/spreadsheets/d/${CONFIG_SHEET_ID}/export?format=csv&gid=${CONFIG_HOL_GID}`;
    const holRes = await fetch(holUrl);
    const holCsv = await holRes.text();
    const holRows = holCsv.trim().split('\n').slice(1); // skip header
    for (const row of holRows) {
      const cols = row.split(',').map(c => c.trim().replace(/^"|"$/g,''));
      const [date, name, type] = cols;
      if (date && name) {
        result.holidays[date] = { name, type: type || 'company' };
      }
    }
  } catch(e) { console.warn('Config holidays fetch failed:', e.message); }

  try {
    // Fetch settings
    const setUrl = `https://docs.google.com/spreadsheets/d/${CONFIG_SHEET_ID}/export?format=csv&gid=${CONFIG_SET_GID}`;
    const setRes = await fetch(setUrl);
    const setCsv = await setRes.text();
    const setRows = setCsv.trim().split('\n').slice(1); // skip header
    for (const row of setRows) {
      const commaIdx = row.indexOf(',');
      if (commaIdx === -1) continue;
      const key = row.slice(0, commaIdx).trim().replace(/^"|"$/g,'');
      const val = row.slice(commaIdx+1).trim().replace(/^"|"$/g,'');
      if (key) result.settings[key] = val;
    }
  } catch(e) { console.warn('Config settings fetch failed:', e.message); }

  return result;
}

// ─── Attendance: positional fallbacks (0-based, confirmed from user) ──────────
//   C=2  → First Name / Employee Name
//   G=6  → Record Date
//   L=11 → Check In time (column L "Check In", updated from M=12)
const ATT_POS = { name:2, date:6, time:11 };

// ─── Sick/Leave: positional columns (0-based) — NEW FORMAT ───────────────────
//   A=0  → Department   F=5  → Time Type (leave code)
//   G=6  → startDate    H=7  → endDate    I=8 → Quantity
//   J=9  → approvalStatus                 M=12 → Person ID (NIK, may be 0)
//   N=13 → Full Name
const SL_POS = { dept:0, type:5, startDate:6, endDate:7, qty:8, status:9, nik:12, name:13 };

// ─── Indonesian Public Holidays 2024–2026 ─────────────────────────────────────
export const DEFAULT_HOLIDAYS = {
  // ── 2024 ──────────────────────────────────────────────────────────────────
  '2024-01-01': { name: 'Tahun Baru 2024',                    type: 'public' },
  '2024-02-08': { name: 'Tahun Baru Imlek 2575',              type: 'public' },
  '2024-02-09': { name: 'Cuti Bersama Imlek',                 type: 'company' },
  '2024-03-11': { name: "Isra Mi'raj 1445 H",                 type: 'public' },
  '2024-03-12': { name: "Cuti Bersama Isra Mi'raj",           type: 'company' },
  '2024-03-29': { name: 'Nyepi 2024',                         type: 'public' },
  '2024-04-08': { name: 'Cuti Bersama Nyepi',                 type: 'company' },
  '2024-04-09': { name: 'Pemilu 2024',                        type: 'public' },
  '2024-03-29': { name: 'Wafat Yesus Kristus',                type: 'public' },
  '2024-04-10': { name: 'Cuti Bersama Idul Fitri',            type: 'company' },
  '2024-04-11': { name: 'Idul Fitri 1445 H',                  type: 'public' },
  '2024-04-12': { name: 'Idul Fitri 1445 H',                  type: 'public' },
  '2024-04-15': { name: 'Cuti Bersama Idul Fitri',            type: 'company' },
  '2024-05-01': { name: 'Hari Buruh Internasional',           type: 'public' },
  '2024-05-09': { name: 'Kenaikan Yesus Kristus',             type: 'public' },
  '2024-05-10': { name: 'Cuti Bersama Kenaikan Yesus',        type: 'company' },
  '2024-05-23': { name: 'Hari Raya Waisak',                   type: 'public' },
  '2024-05-24': { name: 'Cuti Bersama Waisak',                type: 'company' },
  '2024-06-01': { name: 'Hari Lahir Pancasila',               type: 'public' },
  '2024-06-17': { name: 'Idul Adha 1445 H',                   type: 'public' },
  '2024-06-18': { name: 'Cuti Bersama Idul Adha',             type: 'company' },
  '2024-07-07': { name: 'Tahun Baru Islam 1446 H',            type: 'public' },
  '2024-08-17': { name: 'HUT Kemerdekaan RI',                 type: 'public' },
  '2024-09-16': { name: 'Maulid Nabi Muhammad SAW',           type: 'public' },
  '2024-12-25': { name: 'Hari Natal',                         type: 'public' },
  '2024-12-26': { name: 'Cuti Bersama Natal',                 type: 'company' },
  // ── 2025 ──────────────────────────────────────────────────────────────────
  '2025-01-01': { name: 'Tahun Baru 2025',                    type: 'public' },
  '2025-01-27': { name: 'Isra Mikraj Nabi Muhammad SAW',      type: 'public' },
  '2025-01-28': { name: 'Tahun Baru Imlek 2576',              type: 'public' },
  '2025-03-28': { name: 'Hari Suci Nyepi',                    type: 'public' },
  '2025-03-29': { name: 'Wafat Yesus Kristus',                type: 'public' },
  '2025-03-31': { name: 'Idul Fitri 1446 H',                  type: 'public' },
  '2025-04-01': { name: 'Idul Fitri 1446 H',                  type: 'public' },
  '2025-05-01': { name: 'Hari Buruh Internasional',           type: 'public' },
  '2025-05-12': { name: 'Hari Raya Waisak',                   type: 'public' },
  '2025-05-29': { name: 'Kenaikan Yesus Kristus',             type: 'public' },
  '2025-06-01': { name: 'Hari Lahir Pancasila',               type: 'public' },
  '2025-06-06': { name: 'Idul Adha 1446 H',                   type: 'public' },
  '2025-06-27': { name: 'Tahun Baru Islam 1447 H',            type: 'public' },
  '2025-08-17': { name: 'HUT Kemerdekaan RI',                 type: 'public' },
  '2025-09-05': { name: 'Maulid Nabi Muhammad SAW',           type: 'public' },
  '2025-12-25': { name: 'Hari Natal',                         type: 'public' },
  '2025-12-26': { name: 'Cuti Bersama Natal',                 type: 'company' },
  // ── 2026 ──────────────────────────────────────────────────────────────────
  '2026-01-01': { name: 'Tahun Baru 2026 Masehi',             type: 'public' },
  '2026-01-16': { name: 'Isra Mikraj Nabi Muhammad SAW',      type: 'public' },
  '2026-02-17': { name: 'Tahun Baru Imlek 2577 Kongzili',     type: 'public' },
  '2026-03-19': { name: 'Hari Suci Nyepi Tahun Baru Saka 1948', type: 'public' },
  '2026-04-03': { name: 'Wafat Yesus Kristus',                type: 'public' },
  '2026-05-01': { name: 'Hari Buruh Internasional',           type: 'public' },
  '2026-05-14': { name: 'Kenaikan Yesus Kristus',             type: 'public' },
  '2026-05-27': { name: 'Hari Raya Idul Adha 1447 Hijriah',   type: 'public' },
  '2026-05-31': { name: 'Hari Raya Waisak 2570 BE',           type: 'public' },
  '2026-06-01': { name: 'Hari Lahir Pancasila',               type: 'public' },
  '2026-06-16': { name: 'Tahun Baru Islam 1448 Hijriah',      type: 'public' },
  '2026-08-17': { name: 'HUT Proklamasi Kemerdekaan RI',      type: 'public' },
  '2026-08-25': { name: 'Maulid Nabi Muhammad SAW',           type: 'public' },
  '2026-12-25': { name: 'Hari Natal/Kelahiran Yesus Kristus', type: 'public' },
};

// ─── Calendar helpers ─────────────────────────────────────────────────────────
export function getWorkdaysInMonth(year, month, holidays = {}) {
  const dim = new Date(year, month + 1, 0).getDate();
  const out = [];
  for (let d = 1; d <= dim; d++) {
    const dow = new Date(year, month, d).getDay();
    if (dow === 0 || dow === 6) continue;
    const key = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    if (!holidays[key]) out.push(d);
  }
  return out;
}

export function getEligibleDays(joinDate, workdays, year, month) {
  if (!workdays.length) return 0;
  if (!joinDate) return workdays.length;           // no join date = always eligible
  const jd = joinDate instanceof Date ? joinDate : new Date(joinDate);
  if (isNaN(jd)) return workdays.length;
  const [jY, jM] = [jd.getFullYear(), jd.getMonth()];
  // Not joined yet this month → 0
  if (jY > year || (jY === year && jM > month)) return 0;
  // Joined this month or earlier → count full month (treat join day as day 1)
  return workdays.length;
}

export function toHolidayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
async function fetchRaw(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} — check sharing settings`);
  const text = await res.text();
  if (text.includes('Sign in') || text.includes('accounts.google.com'))
    throw new Error('Sheet requires login — share as "Anyone with link → Viewer"');
  if (text.length < 30) throw new Error('Empty response — check sheet ID');
  return new Promise((ok, fail) =>
    Papa.parse(text, { header:false, skipEmptyLines:true, complete:r=>ok(r.data), error:fail })
  );
}

function csvUrl(id, gid=null) {
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gid?`&gid=${gid}`:''}`;
}

function hMap(row) {
  const m = {};
  row.forEach((h,i) => { m[String(h||'').trim().toLowerCase()] = i; });
  return m;
}
function findH(map, ...names) {
  for (const n of names) { const k=n.trim().toLowerCase(); if (k in map) return map[k]; }
  return -1;
}
function resolveCol(map, pos, ...names) {
  const h = findH(map, ...names);
  return h !== -1 ? h : pos;
}

// ─── sanitizeTime: regex-based, handles ALL string formats from Google Sheets ──
// Verified formats: "HH:MM", "HH:MM:SS", "H:MM AM/PM", "0.354..." (Excel),
//                   "1899-12-30T08:30:00Z" (ISO), leading/trailing whitespace.
// Returns { minutes: integer|null, display: "HH:MM"|null }
//   minutes = total minutes since midnight (480 = 08:00), null if unparseable
//   display = canonical HH:MM string for UI
export function parseTime(raw) {
  if (raw == null || raw === '') return { minutes: null, display: null };
  const s = String(raw).trim();
  if (!s || s === '-' || s.toLowerCase() === 'n/a') return { minutes: null, display: null };

  const _fmt = (totalMins) => {
    if (isNaN(totalMins) || totalMins < 0 || totalMins >= 1440)
      return { minutes: null, display: null };
    const h = Math.floor(totalMins / 60), m = totalMins % 60;
    return { minutes: totalMins, display: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}` };
  };

  // ── 1. Excel decimal fraction (e.g. 0.354166… = 08:30) ──
  if (!s.includes(':') && !s.includes(' ') && !isNaN(s)) {
    const frac = parseFloat(s);
    if (frac > 0 && frac < 1) return _fmt(Math.round(frac * 1440));
    return { minutes: null, display: null };
  }

  // ── 2. ISO datetime string (e.g. "1899-12-30T08:30:00.000Z") ──
  const isoM = s.match(/T(\d{1,2}):(\d{2})/);
  if (isoM) return _fmt(parseInt(isoM[1], 10) * 60 + parseInt(isoM[2], 10));

  // ── 3. 12-hour AM/PM format (e.g. "8:30 AM", "09:15 PM") ──
  const m12 = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])/);
  if (m12) {
    let h = parseInt(m12[1], 10), m = parseInt(m12[2], 10);
    const ap = m12[3].toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return _fmt(h * 60 + m);
  }

  // ── 4. 24-hour: HH:MM or HH:MM:SS (regex extracts first occurrence) ──
  const m24 = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (m24) {
    const h = parseInt(m24[1], 10), m = parseInt(m24[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return _fmt(h * 60 + m);
  }

  return { minutes: null, display: null };
}

// ─── parseDate: robust string → Date ─────────────────────────────────────────
// Attendance date format: dd/MM/yyyy (e.g. 06/02/2026 = 6 Feb)
function parseDateAtt(s) {
  if (!s) return null;
  s = String(s).trim();
  // Excel serial
  if (/^\d{4,5}$/.test(s)) {
    const n = parseInt(s, 10);
    if (n > 40000 && n < 60000) return new Date(Date.UTC(1899,11,30) + n*86400000);
  }
  // ISO yyyy-MM-dd (unambiguous, try first)
  try { const d=parse(s,'yyyy-MM-dd',new Date()); if(!isNaN(d)&&d.getFullYear()>2000) return d; } catch {}
  // dd/MM/yyyy — primary attendance format
  try { const d=parse(s,'dd/MM/yyyy',new Date()); if(!isNaN(d)&&d.getFullYear()>2000) return d; } catch {}
  // d/M/yyyy fallback
  try { const d=parse(s,'d/M/yyyy',new Date()); if(!isNaN(d)&&d.getFullYear()>2000) return d; } catch {}
  return null;
}

// Leave date format: M/d/yyyy (e.g. 2/4/2026 = Feb 4)
function parseDateLeave(s) {
  if (!s) return null;
  s = String(s).trim();
  // Excel serial
  if (/^\d{4,5}$/.test(s)) {
    const n = parseInt(s, 10);
    if (n > 40000 && n < 60000) return new Date(Date.UTC(1899,11,30) + n*86400000);
  }
  // ISO yyyy-MM-dd (unambiguous, try first)
  try { const d=parse(s,'yyyy-MM-dd',new Date()); if(!isNaN(d)&&d.getFullYear()>2000) return d; } catch {}
  // M/d/yyyy — primary leave format
  try { const d=parse(s,'M/d/yyyy',new Date()); if(!isNaN(d)&&d.getFullYear()>2000) return d; } catch {}
  // MM/dd/yyyy fallback
  try { const d=parse(s,'MM/dd/yyyy',new Date()); if(!isNaN(d)&&d.getFullYear()>2000) return d; } catch {}
  return null;
}

// Generic parseDate for joinDate etc — tries ISO then both formats
function parseDate(s) {
  if (!s) return null;
  s = String(s).trim();
  if (/^\d{4,5}$/.test(s)) {
    const n = parseInt(s, 10);
    if (n > 40000 && n < 60000) return new Date(Date.UTC(1899,11,30) + n*86400000);
  }
  try { const d=parse(s,'yyyy-MM-dd',new Date()); if(!isNaN(d)&&d.getFullYear()>2000) return d; } catch {}
  try { const d=parse(s,'d-MMM-yyyy',new Date()); if(!isNaN(d)&&d.getFullYear()>2000) return d; } catch {}
  try { const d=parse(s,'dd-MMM-yyyy',new Date()); if(!isNaN(d)&&d.getFullYear()>2000) return d; } catch {}
  try { const d=parse(s,'dd/MM/yyyy',new Date()); if(!isNaN(d)&&d.getFullYear()>2000) return d; } catch {}
  try { const d=parse(s,'M/d/yyyy',new Date()); if(!isNaN(d)&&d.getFullYear()>2000) return d; } catch {}
  const native = new Date(s);
  if (!isNaN(native) && native.getFullYear()>2000 && native.getFullYear()<2100) return native;
  return null;
}

const inRange = (d, s, e) => {
  if (!d) return false;
  if (!s && !e) return true;
  try { return isWithinInterval(d, { start: s?startOfDay(s):new Date(0), end: e?endOfDay(e):new Date(9999,0) }); }
  catch { return true; }
};

// ─── FETCH ────────────────────────────────────────────────────────────────────
export async function fetchAllSheets(attGid = '607806096') {
  const diag = { empRows:0, attRows:0, slRows:0, errors:[], attGidUsed:null };
  let empRaw = [], attRaw = [], slRaw = [];
  try { empRaw = await fetchRaw(csvUrl(SHEET_IDS.employee)); diag.empRows = empRaw.length-1; }
  catch(e) { diag.errors.push(`Employee: ${e.message}`); }
  for (const gid of [attGid, '0', null]) {
    try {
      const rows = await fetchRaw(csvUrl(SHEET_IDS.attendance, gid));
      if (rows.length > 1) { attRaw = rows; diag.attGidUsed = gid ?? 'default'; break; }
    } catch(e) { if (gid === null) diag.errors.push(`Attendance: ${e.message}`); }
  }
  diag.attRows = Math.max(0, attRaw.length-1);
  try { slRaw = await fetchRaw(csvUrl(SHEET_IDS.sickLeave)); diag.slRows = slRaw.length-1; }
  catch(e) { diag.errors.push(`Sick/Leave: ${e.message}`); }
  return { empRaw, attRaw, slRaw, diag };
}

// ─── EMPLOYEE MAP ─────────────────────────────────────────────────────────────
export function buildEmpMap(empRaw) {
  if (!empRaw?.length) return { map:{}, colMap:{}, header:[], totalEmp:0 };
  const [header, ...rows] = empRaw;
  const hm = hMap(header);
  const iNIK  = findH(hm,'personnel_id','personnel id','personnelid','nik','employee_id','emp_id','id_karyawan','nip','employee id','employeeid');
  const iName = findH(hm,'name','employee_name','full_name','nama','emp_name','employee name','fullname','nama_karyawan');
  const iFN   = findH(hm,'first_name','firstname','first name','nama depan');
  const iDept = findH(hm,'department_name','department name','department','dept','divisi','unit','departemen');
  const iPos  = findH(hm,'position','jabatan','title','job_title','role','posisi');
  const iLoc  = findH(hm,'location','office','lokasi','city','work_location','site');
  const iStat = findH(hm,'status','employment_status','emp_status','aktif');
  const iJoin = findH(hm,
    'join date','join date (to idn)','joindate','join_date','joining_date','tanggal_masuk','tgl_masuk','start_date','hire_date',
    'entry_date','tgl_bergabung','tanggal_bergabung','employment_start','date_of_joining','doj','tmt');

  const map = {};
  for (const row of rows) {
    const nik = String(row[iNIK]??'').trim();
    if (!nik) continue;
    const joinDate = iJoin !== -1 ? parseDate(String(row[iJoin]??'').trim()) : null;
    const dept = String(row[iDept]??'').trim();
    if (!dept) continue; // skip employees without department
    map[nik] = {
      nik,
      name:     String(row[iName]??row[iFN]??'').trim() || nik,
      dept,
      pos:      String(row[iPos] ??'').trim(),
      loc:      String(row[iLoc] ??'').trim(),
      status:   String(row[iStat]??'').trim().toLowerCase(),
      joinDate,
    };
  }
  return { map, colMap:{ nik:iNIK, name:iName, dept:iDept, join:iJoin }, header, totalEmp: Object.keys(map).length };
}

// ─── PROCESS ATTENDANCE ───────────────────────────────────────────────────────
export function processAttendance(attRaw, slRaw, empMap, { startDate, endDate } = {}) {
  const diag = {
    attParsed:0, attSkipped:0, slParsed:0, slSkipped:0,
    missingTime:0, unregisteredNIKs:new Set(),
    colsAtt:{}, colsSL:{}, attHeader:[], slHeader:[],
    parseErrors:[], // collect parsing issues
  };

  // ── Attendance ──────────────────────────────────────────────────────────────
  const [attHead = [], ...attData] = attRaw;
  const aH = hMap(attHead);
  diag.attHeader = attHead.slice(0, 12);

  const iDate = resolveCol(aH, ATT_POS.date, 'date','record_date','attendance_date','tanggal','work_date','att_date','tgl','trans_date','recorddate');
  const iTime = resolveCol(aH, ATT_POS.time, 'check_in','check in','checkin','clock_in','clock in','in_time','in time','earliest_time','time_in','jam_masuk','masuk','tap_in','first_in','earlyest_time');
  const iName = resolveCol(aH, ATT_POS.name, 'name','employee_name','full_name','nama','emp_name','employee name','fullname','first_name','firstname','first name','nama_karyawan');
  const iNIK  = findH(aH, 'personnel_id','personnel id','personnelid','nik','employee_id','emp_id','id_karyawan','nip','employee id','employeeid','no karyawan');
  const iDept = findH(aH, 'department_name','department name','department','dept','divisi','unit','departemen');
  diag.colsAtt = { date:iDate, time:iTime, name:iName, nik:iNIK, dept:iDept };

  const attRecords = [];
  for (let ri = 0; ri < attData.length; ri++) {
    const row = attData[ri];
    try {
      const nikRaw  = iNIK !== -1 ? String(row[iNIK]??'').trim() : '';
      const dateRaw = String(row[iDate]??'').trim();
      const timeRaw = String(row[iTime]??'').trim();
      const nameRaw = String(row[iName]??'').trim();

      const d = parseDateAtt(dateRaw);
      if (!d || !inRange(d, startDate, endDate)) { diag.attSkipped++; continue; }

      // Parse time — keep both minutes and display string
      const { minutes: checkInMin, display: checkInStr } = parseTime(timeRaw);

      // Opsi A: baris tanpa waktu tap-in yang valid = TIDAK hadir.
      // Sistem absensi sering mengekspor baris kosong untuk hari karyawan tidak masuk.
      // Jika kolom check-in kosong/tidak terbaca, skip baris ini agar hari tersebut
      // dianggap absent (merah) bukan present_notime (hijau).
      if (checkInMin === null) { diag.missingTime++; diag.attSkipped++; continue; }

      const emp = empMap[nikRaw] || empMap[nikRaw.padStart(6,'0')] || empMap[nikRaw.replace(/^0+/,'')];
      if (nikRaw && !emp && Object.keys(empMap).length > 0) diag.unregisteredNIKs.add(nikRaw);

      const dept = emp?.dept || (iDept !== -1 ? String(row[iDept]??'').trim() : '') || '';
      const name = emp?.name || nameRaw || nikRaw || 'Unknown';

      attRecords.push({
        date: d,
        month: d.getMonth(),
        dayOfWeek: d.getDay(),
        nik:  nikRaw,
        dept, name,
        loc:  emp?.loc || '',
        checkInMin,   // integer minutes since midnight, or null
        checkInStr,   // "HH:MM" display string, or null
        registered: !!emp,
      });
      diag.attParsed++;
    } catch (err) {
      diag.parseErrors.push(`Row ${ri+2}: ${err.message}`);
      diag.attSkipped++;
    }
  }

  // ── Sick / Leave — NEW FORMAT ───────────────────────────────────────────────
  // New sheet: 1 row = date range (startDate→endDate). Must expand per day.
  // NIK = Person ID (may be "0" = unknown), fallback match by Full Name → empMap
  const [slHead = [], ...slData] = slRaw;
  const sH = hMap(slHead);
  diag.slHeader = slHead.slice(0, 14);

  const iSLType      = resolveCol(sH, SL_POS.type,      'time type','time_type','leave_type','type','jenis_cuti');
  const iSLStart     = resolveCol(sH, SL_POS.startDate,  'startdate','start_date','start date','booking_date');
  const iSLEnd       = resolveCol(sH, SL_POS.endDate,    'enddate','end_date','end date');
  const iSLStatus    = resolveCol(sH, SL_POS.status,     'approvalstatus','approval_status','approvalStatus','status');
  const iSLNIK       = resolveCol(sH, SL_POS.nik,        'person id','person_id','personnelid','personnel_id','nik');
  const iSLName      = resolveCol(sH, SL_POS.name,       'full name','full_name','fullname','name');
  const iSLDept      = resolveCol(sH, SL_POS.dept,       'department (label)','department','dept');
  diag.colsSL = { type:iSLType, startDate:iSLStart, endDate:iSLEnd, status:iSLStatus, nik:iSLNIK, name:iSLName };

  // Build name→NIK lookup from empMap for fallback matching
  const nameToNik = {};
  for (const [nik, emp] of Object.entries(empMap)) {
    if (emp.name) nameToNik[emp.name.trim().toLowerCase()] = nik;
  }

  const leaveRecords = [];
  for (const row of slData) {
    try {
      const typeRaw   = String(row[iSLType]   ?? '').trim().toUpperCase();
      const statusRaw = String(row[iSLStatus] ?? '').trim().toUpperCase();
      const startRaw  = String(row[iSLStart]  ?? '').trim();
      const endRaw    = String(row[iSLEnd]    ?? '').trim();
      const nikRaw    = String(row[iSLNIK]    ?? '').trim();
      const nameRaw   = String(row[iSLName]   ?? '').trim();
      const deptRaw   = String(row[iSLDept]   ?? '').trim();

      // Skip if no date or not APPROVED
      if (!startRaw) { diag.slSkipped++; continue; }
      if (statusRaw !== 'APPROVED') { diag.slSkipped++; continue; }

      // Resolve NIK: use Person ID if non-zero, else fallback to name lookup
      let resolvedNik = (nikRaw && nikRaw !== '0') ? nikRaw : '';
      if (!resolvedNik && nameRaw) {
        resolvedNik = nameToNik[nameRaw.toLowerCase()] || '';
      }
      // Skip rows with no identifiable employee
      if (!resolvedNik) { diag.slSkipped++; continue; }

      // Map type code
      let type;
      if (typeRaw === 'ANL' || typeRaw.includes('ANNUAL') || typeRaw.includes('TAHUNAN')) {
        type = 'annual';
      } else if (typeRaw === 'SL' || typeRaw.includes('SICK') || typeRaw.includes('SAKIT')) {
        type = 'sick';
      } else if (['IBDH','MATL','C01','C02','C04','C05','C06','C07','HAID','UNPAID'].includes(typeRaw)) {
        type = typeRaw.toLowerCase();
      } else {
        diag.slSkipped++;
        continue;
      }

      // Parse date range and expand per-day
      const dStart = parseDateLeave(startRaw);
      const dEnd   = endRaw ? parseDateLeave(endRaw) : dStart;
      if (!dStart) { diag.slSkipped++; continue; }

      const endTime = dEnd ? dEnd.getTime() : dStart.getTime();
      const emp  = empMap[resolvedNik] || empMap[resolvedNik.padStart(8,'0')] || empMap[resolvedNik.replace(/^0+/,'')];
      const dept = emp?.dept || deptRaw || '';

      // Expand range: one record per calendar day (skip weekends)
      const cur = new Date(dStart);
      while (cur.getTime() <= endTime) {
        const dow = cur.getDay();
        if (dow !== 0 && dow !== 6) { // skip weekends
          if (inRange(cur, startDate, endDate)) {
            leaveRecords.push({
              date:  new Date(cur),
              month: cur.getMonth(),
              nik:   resolvedNik,
              dept,
              type,
            });
            diag.slParsed++;
          }
        }
        cur.setDate(cur.getDate() + 1);
      }
    } catch(e) {
      diag.slSkipped++;
    }
  }

  diag.unregisteredNIKs = [...diag.unregisteredNIKs];
  return { attRecords, leaveRecords, diag };
}

// ─── DEPT STATS ───────────────────────────────────────────────────────────────
export function buildDeptStats(attRecords, leaveRecords, empMap, holidays = {}) {
  if (!attRecords.length && !Object.keys(empMap).length) return [];

  // Dominant year from data
  const yc = {};
  for (const r of attRecords) { const y=r.date.getFullYear(); yc[y]=(yc[y]||0)+1; }
  const year = parseInt(Object.entries(yc).sort((a,b)=>b[1]-a[1])[0]?.[0] || new Date().getFullYear());

  const monthsWithData = [...new Set(attRecords.filter(r=>r.date.getFullYear()===year).map(r=>r.month))];
  if (!monthsWithData.length) monthsWithData.push(...[0,1,2,3,4,5,6,7,8,9,10,11]);

  // Attendance presence lookup: key exists = employee was present that day
  const attPresence  = new Set();
  const attOnTime    = new Set();
  const leavePresence= new Set(); // approved leave = excused = counts as present
  for (const r of attRecords) {
    if (r.date.getFullYear() !== year) continue;
    const key = `${r.nik}|${r.month}|${r.date.getDate()}`;
    attPresence.add(key);
    if (r.checkInMin !== null && r.checkInMin <= 540) attOnTime.add(key);
  }
  for (const r of leaveRecords) {
    if (r.date.getFullYear() !== year) continue;
    leavePresence.add(`${r.nik}|${r.month}|${r.date.getDate()}`);
  }

  // CI for avg check-in time per dept
  const deptCI = {};
  for (const r of attRecords) {
    const dept = empMap[r.nik]?.dept || r.dept || '';
    if (!deptCI[dept]) deptCI[dept] = [];
    if (r.checkInMin !== null) deptCI[dept].push(r.checkInMin);
  }

  // Leave counts per dept
  const sickD = {}, annD = {};
  for (const r of leaveRecords) {
    const dept = empMap[r.nik]?.dept || r.dept || '';
    if (r.type === 'sick')   sickD[dept] = (sickD[dept]||0) + 1;
    if (r.type === 'annual') annD[dept]  = (annD[dept] ||0) + 1;
  }

  // Group employees by dept
  const deptEmps = {};
  for (const emp of Object.values(empMap)) {
    const k = emp.dept || '';
    if (!deptEmps[k]) deptEmps[k] = [];
    deptEmps[k].push(emp);
  }

  return Object.entries(deptEmps).map(([deptName, emps]) => {
    let presNum=0, onTimeNum=0, den=0;
    const eligibleEmps = new Set();
    for (const mi of monthsWithData) {
      const workdays = getWorkdaysInMonth(year, mi, holidays);
      for (const emp of emps) {
        const eligible = getEligibleDays(emp.joinDate, workdays, year, mi);
        if (!eligible) continue;
        eligibleEmps.add(emp.nik);
        den += eligible;
        for (const wd of workdays) {
          const key = `${emp.nik}|${mi}|${wd}`;
          if (attPresence.has(key)) presNum++;   // Opsi A: tap-in only, no leave
          if (attOnTime.has(key))   onTimeNum++;
        }
      }
    }
    const ci = deptCI[deptName] || [];
    const avgMin = ci.length ? Math.round(ci.reduce((a,b)=>a+b,0)/ci.length) : 528;
    const short  = deptName.length>14 ? deptName.slice(0,13)+'…' : deptName;
    return {
      name:deptName, short, count:eligibleEmps.size,
      hadir:  den ? Math.min(100, Math.round((presNum  /den)*10000)/100) : 0,
      tepat:  den ? Math.min(100, Math.round((onTimeNum/den)*10000)/100) : 0,
      avgMin,
      sick:      den ? Math.round(((sickD[deptName]||0)/den)*100) : 0,
      annual:    den ? Math.round(((annD[deptName] ||0)/den)*100) : 0,
      sickDays:  sickD[deptName]||0,
      annualDays:annD[deptName] ||0,
      _debug:{ presNum, onTimeNum, den },
    };
  }).filter(d => d.count > 0).sort((a,b) => b.count - a.count);
}

// ─── MONTHLY STATS ────────────────────────────────────────────────────────────
export function buildMonthlyStats(attRecords, leaveRecords, empMap, holidays = {}) {
  // MO defined at module level

  // Dominant year
  const yc = {};
  for (const r of attRecords) { const y=r.date.getFullYear(); yc[y]=(yc[y]||0)+1; }
  const year = parseInt(Object.entries(yc).sort((a,b)=>b[1]-a[1])[0]?.[0] || new Date().getFullYear());

  // Build per-day, per-employee presence/on-time lookups
  const attPresence  = new Set(); // "nik|month|day"
  const leavePresence= new Set(); // approved leave = excused = counts as present
  const attOnTime    = new Set(); // "nik|month|day" where time ≤ 09:00
  const ciByMonth    = Array.from({length:12}, () => ({ times:[], sick:0, annual:0 }));

  for (const r of attRecords) {
    if (r.date.getFullYear() !== year) continue;
    const key = `${r.nik}|${r.month}|${r.date.getDate()}`;
    attPresence.add(key);
    if (r.checkInMin !== null) {
      ciByMonth[r.month].times.push(r.checkInMin);
      if (r.checkInMin <= 540) attOnTime.add(key);
    }
  }
  for (const r of leaveRecords) {
    if (r.date.getFullYear() !== year) continue;
    leavePresence.add(`${r.nik}|${r.month}|${r.date.getDate()}`);
    if (r.type === 'sick')   ciByMonth[r.month].sick++;
    if (r.type === 'annual') ciByMonth[r.month].annual++;
  }

  const empList = Object.values(empMap);

  return MO.map((m, mi) => {
    const workdays = getWorkdaysInMonth(year, mi, holidays);
    const mo = ciByMonth[mi];

    let presNum=0, onTimeNum=0, den=0, activeCount=0;
    for (const emp of empList) {
      const eligible = getEligibleDays(emp.joinDate, workdays, year, mi);
      if (!eligible) continue;
      activeCount++;
      den += eligible;
      for (const wd of workdays) {
        const key = `${emp.nik}|${mi}|${wd}`;
        if (attPresence.has(key)) presNum++;   // Opsi A: tap-in only, no leave
        if (attOnTime.has(key))   onTimeNum++;
      }
    }

    const hadir  = den ? Math.min(100, Math.round((presNum  /den)*100)) : 0;
    const tepat  = den ? Math.min(100, Math.round((onTimeNum/den)*100)) : 0;
    const avgMin = mo.times.length ? Math.round(mo.times.reduce((a,b)=>a+b,0)/mo.times.length) : 528;
    const lateCount = mo.times.filter(t => t > 540).length;

    return {
      m, hadir, tepat, avgMin,
      sick:        den ? Math.round((mo.sick  /den)*100) : 0,
      annual:      den ? Math.round((mo.annual/den)*100) : 0,
      sickCount:   mo.sick,
      annualCount: mo.annual,
      late:        mo.times.length ? Math.round((lateCount/mo.times.length)*100) : 0,
      onTimeCount: onTimeNum,
      total:       activeCount,
      workdays:    workdays.length,
      ciCount:     mo.times.length, // actual tap-in records — 0 = no attendance data
      _debug:{ presNum, onTimeNum, den },
    };
  });
}

// ─── CI DISTRIBUTION ──────────────────────────────────────────────────────────
export function buildCIDistribution(attRecords) {
  const bins = [
    {bin:'< 07:30',     min:0,   max:450,  type:'very_early',    count:0},
    {bin:'07:30–08:00', min:450, max:480,  type:'early',         count:0},
    {bin:'08:00–08:30', min:480, max:510,  type:'early',         count:0},
    {bin:'08:30–09:00', min:510, max:540,  type:'on_time',       count:0},
    {bin:'09:00–09:30', min:540, max:570,  type:'slightly_late', count:0},
    {bin:'09:30–10:00', min:570, max:600,  type:'late',          count:0},
    {bin:'> 10:00',     min:600, max:9999, type:'very_late',     count:0},
  ];
  let total = 0;
  for (const r of attRecords) {
    if (r.checkInMin === null) continue;
    total++;
    for (const b of bins) if (r.checkInMin >= b.min && r.checkInMin < b.max) { b.count++; break; }
  }
  return bins.map(b => ({ ...b, pct: total ? Math.round((b.count/total)*100) : 0 }));
}

// ─── DAILY STATS ──────────────────────────────────────────────────────────────
export function buildDailyStats(attRecords) {
  const days = [{day:'Mon',dow:1},{day:'Tue',dow:2},{day:'Wed',dow:3},{day:'Thu',dow:4},{day:'Fri',dow:5}];
  for (const d of days) {
    const recs = attRecords.filter(r => r.dayOfWeek===d.dow && r.checkInMin!==null);
    d.hadir  = recs.length;
    d.avgMin = recs.length ? Math.round(recs.reduce((a,b)=>a+b.checkInMin,0)/recs.length) : 528;
    d.late   = recs.length ? Math.round((recs.filter(r=>r.checkInMin>540).length/recs.length)*100) : 0;
    d.tepat  = 100 - d.late;
  }
  const mH = Math.max(...days.map(d=>d.hadir), 1);
  for (const d of days) d.hadir = Math.round((d.hadir/mH)*100);
  return days;
}

// ─── EMPLOYEE DAILY GRID ──────────────────────────────────────────────────────
// Priority per spec:
//   1. Approved leave (ANL/SL) always wins — overrides attendance record
//   2. Attendance with valid time → show HH:MM
//   3. Attendance row exists but no time → present_notime (recorded as present)
//   4. Nothing on a workday → absent
export function buildEmployeeDailyData(attRecords, leaveRecords, empMap, year, month) {
  // Seed from employee master
  const eM = {};
  for (const emp of Object.values(empMap)) {
    eM[emp.nik] = { nik:emp.nik, name:emp.name, dept:emp.dept, loc:emp.loc||'', joinDate:emp.joinDate, days:{} };
  }

  // Step 1: Fill attendance (registered NIKs only)
  for (const r of attRecords) {
    if (!eM[r.nik]) continue;
    if (r.date.getFullYear() !== year || r.date.getMonth() !== month) continue;
    const status = r.checkInMin !== null
      ? (r.checkInMin > 540 ? 'late' : 'ontime')
      : 'present_notime';
    eM[r.nik].days[r.date.getDate()] = {
      status, checkInMin: r.checkInMin, checkInStr: r.checkInStr,
    };
  }

  // Step 2: Apply leave — ALWAYS overrides attendance (leave takes priority)
  // Normalise NIK to handle leading/trailing spaces from CSV
  const leaveByNikDate = {};
  for (const r of leaveRecords) {
    const nik = String(r.nik||'').trim();
    if (!nik || r.date.getFullYear()!==year || r.date.getMonth()!==month) continue;
    const key = `${nik}|${r.date.getDate()}`;
    leaveByNikDate[key] = r.type; // last one wins if duplicate
  }

  for (const emp of Object.values(eM)) {
    const daysInMonth = new Date(year, month+1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      // Try exact NIK match and padded variants (handles leading zeros in CSV)
      const nikVariants = [emp.nik, emp.nik.padStart(6,'0'), emp.nik.replace(/^0+/,'')];
      let leaveType = null;
      for (const v of nikVariants) {
        if (leaveByNikDate[`${v}|${d}`]) { leaveType = leaveByNikDate[`${v}|${d}`]; break; }
      }
      if (leaveType) {
        const existing = eM[emp.nik].days[d];
        if (existing && (existing.status==='ontime' || existing.status==='late') && existing.checkInMin!=null) {
          // Half-day: tap-in EXISTS on same leave day → keep tap-in status, flag leaveType
          eM[emp.nik].days[d] = { ...existing, leaveType };
        } else {
          // Pure leave day (no tap-in) → override with leave status (preserve actual type)
          eM[emp.nik].days[d] = { status: leaveType };
        }
      }
    }
  }

  // Filter out employees not yet joined in this month
  return Object.values(eM)
    .filter(emp => {
      if (!emp.joinDate) return true;
      const jd = emp.joinDate instanceof Date ? emp.joinDate : new Date(emp.joinDate);
      if (isNaN(jd)) return true;
      const [jY, jM] = [jd.getFullYear(), jd.getMonth()];
      // Only exclude if join month is strictly after current month
      return !(jY > year || (jY === year && jM > month));
    })
    .sort((a,b) => a.dept.localeCompare(b.dept) || a.name.localeCompare(b.name));
}

// ─── Build all-time monthly stats (multi-year) ──────────────────────────────
export function buildAllTimeStats(attRecords, leaveRecords, empMap, holidays) {
  if (!attRecords.length) return [];

  // Group records by year
  const years = [...new Set([
    ...attRecords.map(r => r.date.getFullYear()),
    ...leaveRecords.map(r => r.date.getFullYear()),
  ])].sort();

  const empList = Object.values(empMap);
  const results = [];

  for (const year of years) {
    const attPresence = new Set();
    const attOnTime   = new Set();
    const ciByMonth   = Array.from({length:12}, ()=>({times:[],sick:0,annual:0}));

    for (const r of attRecords) {
      if (r.date.getFullYear() !== year) continue;
      const key = `${r.nik}|${r.month}|${r.date.getDate()}`;
      attPresence.add(key);
      if (r.checkInMin !== null) {
        ciByMonth[r.month].times.push(r.checkInMin);
        if (r.checkInMin <= 540) attOnTime.add(key);
      }
    }
    for (const r of leaveRecords) {
      if (r.date.getFullYear() !== year) continue;
      ciByMonth[r.month].sick   += r.type==='sick'   ? 1 : 0;
      ciByMonth[r.month].annual += r.type==='annual' ? 1 : 0;
    }

    for (let mi = 0; mi < 12; mi++) {
      const workdays = getWorkdaysInMonth(year, mi, holidays);
      const mo = ciByMonth[mi];
      if (!mo.times.length && !mo.sick && !mo.annual) continue; // skip empty months

      let presNum=0, onTimeNum=0, den=0, activeCount=0;
      for (const emp of empList) {
        const eligible = getEligibleDays(emp.joinDate, workdays, year, mi);
        if (!eligible) continue;
        activeCount++;
        den += eligible;
        for (const wd of workdays) {
          const key = `${emp.nik}|${mi}|${wd}`;
          if (attPresence.has(key)) presNum++;
          if (attOnTime.has(key))   onTimeNum++;
        }
      }

      const hadir  = den ? Math.min(100, Math.round((presNum  /den)*10000)/100) : 0;
      const tepat  = den ? Math.min(100, Math.round((onTimeNum/den)*10000)/100) : 0;
      const avgMin = mo.times.length ? Math.round(mo.times.reduce((a,b)=>a+b,0)/mo.times.length) : 528;
      const lateCount = mo.times.filter(t=>t>540).length;

      results.push({
        year, month: mi,
        label: `${MO[mi]} ${year}`,
        shortLabel: `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][mi]} ${year}`,
        m: MO[mi],
        hadir, tepat, avgMin,
        sick:        den ? Math.round((mo.sick  /den)*100) : 0,
        annual:      den ? Math.round((mo.annual/den)*100) : 0,
        sickCount:   mo.sick,
        annualCount: mo.annual,
        late:        mo.times.length ? Math.round((lateCount/mo.times.length)*100) : 0,
        total:       activeCount,
        ciCount:     mo.times.length,
      });
    }
  }
  return results; // sorted by year+month
}
