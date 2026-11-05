/*
 * holiday-parser.js — turn OCR output of a holiday announcement into holiday rows.
 * Input: { tables: string[][][], text: string } from Google Drive OCR.
 * Output: [{ date:'YYYY-MM-DD', name, subA, subB, subC }]
 * The result is always shown to the engineer for review before saving.
 */
(function (root) {
  'use strict';

  const MONTHS = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
    jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
    'ม.ค': 1, 'มกราคม': 1, 'ก.พ': 2, 'กุมภาพันธ์': 2, 'มี.ค': 3, 'มีนาคม': 3, 'เม.ย': 4, 'เมษายน': 4,
    'พ.ค': 5, 'พฤษภาคม': 5, 'มิ.ย': 6, 'มิถุนายน': 6, 'ก.ค': 7, 'กรกฎาคม': 7, 'ส.ค': 8, 'สิงหาคม': 8,
    'ก.ย': 9, 'กันยายน': 9, 'ต.ค': 10, 'ตุลาคม': 10, 'พ.ย': 11, 'พฤศจิกายน': 11, 'ธ.ค': 12, 'ธันวาคม': 12,
  };

  // 01-Jan-26 | 1-Jan | 1 Jan 2026 | 1 ม.ค. 69 | 1 มกราคม 2569 | 01/01/2026
  // The year must sit on the same line, and a 2-digit "year" that is really the next date's day ("13-Apr 14-Apr") is rejected.
  const NAMED_RE = /(\d{1,2})[ \t]*[-\/. \t][ \t]*([A-Za-z]{3,9}|[ก-๙]{1,2}\.[ \t]?[ก-๙]{1,2}\.?|[ก-๙]{5,10})\.?(?:(?:[ \t]*[-\/][ \t]*|[ \t]*[.,]?[ \t]+)(\d{4}|\d{2})(?!\d|[ \t]*[-\/.][ \t]*[A-Za-zก-๙]))?/g;
  const NUMERIC_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/g;

  function normYear(y) {
    if (y == null || y === '') return null;
    y = +y;
    if (y < 100) y = y >= 43 ? y + 2500 : y + 2000; // 69 → 2569 (BE), 26 → 2026
    if (y > 2400) y -= 543;                          // Buddhist Era → AD
    return y;
  }
  function monthOf(word) {
    const w = word.toLowerCase().replace(/\s/g, '').replace(/\.$/, '');
    return MONTHS[w] || MONTHS[w.replace(/\.$/, '')] || null;
  }
  const pad = n => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  function valid(y, m, d) {
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }

  /** All date tokens in a string, in order: [{day, month, year|null, index}] */
  function findDates(str) {
    const out = [];
    const s = String(str || '');
    let m;
    NAMED_RE.lastIndex = 0;
    while ((m = NAMED_RE.exec(s))) {
      const mon = monthOf(m[2]);
      if (!mon) continue;
      out.push({ day: +m[1], month: mon, year: normYear(m[3]), index: m.index });
    }
    NUMERIC_RE.lastIndex = 0;
    while ((m = NUMERIC_RE.exec(s))) {
      out.push({ day: +m[1], month: +m[2], year: normYear(m[3]), index: m.index });
    }
    return out.sort((a, b) => a.index - b.index).filter(t => t.month >= 1 && t.month <= 12 && t.day >= 1 && t.day <= 31);
  }

  /** Resolve a token without a year relative to a reference ISO date (closest year). */
  function resolve(tok, refIso, fallbackYear) {
    if (!tok) return '';
    if (tok.year) return valid(tok.year, tok.month, tok.day) ? iso(tok.year, tok.month, tok.day) : '';
    const ry = refIso ? +refIso.slice(0, 4) : fallbackYear;
    let best = '', bestDiff = Infinity;
    [ry - 1, ry, ry + 1].forEach(y => {
      if (!valid(y, tok.month, tok.day)) return;
      const d = iso(y, tok.month, tok.day);
      const diff = refIso ? Math.abs(Date.parse(d) - Date.parse(refIso)) : Math.abs(y - ry);
      if (diff < bestDiff) { bestDiff = diff; best = d; }
    });
    return best;
  }

  // Names by keyword (order of appearance in the document) — longest first.
  const NAME_KEYS = [
    [/new\s*year'?s?\s*eve|วันสิ้นปี/i, "New Year's Eve"],
    [/new\s*year|วันขึ้นปีใหม่/i, 'New Year Day'],
    [/makha|มาฆบูชา/i, 'Makha Bucha Day'],
    [/chakri|จักรี/i, 'Chakri Memorial Day'],
    [/songkran|สงกรานต์/i, 'Songkran Festival'],
    [/labou?r|แรงงาน/i, 'National Labor Day'],
    [/coronation|ฉัตรมงคล/i, 'Coronation Day'],
    [/visakha|วิสาขบูชา/i, 'Visakha Bucha Day'],
    [/suthida|พระราชินี/i, "H.M. Queen Suthida's Birthday"],
    [/asarnha|asalha|อาสาฬหบูชา/i, 'Asarnha Bucha Day'],
    [/khao\s*phansa|เข้าพรรษา/i, 'Khao Phansa Day'],
    [/king'?s\s*birthday|พระบาทสมเด็จพระเจ้าอยู่หัว|เฉลิมพระชนมพรรษา ร\.?10/i, "H.M. The King's Birthday"],
    [/mother|วันแม่/i, "Mother's Day"],
    [/bhumibol(?:\s+adulyadej)?(?:\s+memorial)?(?:\s+day)?|memorial\s*day|นวมินทรมหาราช/i, 'H.M. Bhumibol Adulyadej Memorial Day'],
    [/chulalongkorn|ปิยมหาราช/i, 'Chulalongkorn Day'],
    [/father|วันพ่อ/i, "Father's Day"],
    [/constitution|รัฐธรรมนูญ/i, 'Constitution Day'],
  ];
  const FIXED_NAMES = {
    '01-01': 'New Year Day', '04-06': 'Chakri Memorial Day', '04-13': 'Songkran Festival', '04-14': 'Songkran Festival',
    '04-15': 'Songkran Festival', '05-01': 'National Labor Day', '05-04': 'Coronation Day',
    '06-03': "H.M. Queen Suthida's Birthday", '07-28': "H.M. The King's Birthday", '08-12': "Mother's Day",
    '10-13': 'H.M. Bhumibol Adulyadej Memorial Day', '10-23': 'Chulalongkorn Day', '12-05': "Father's Day",
    '12-10': 'Constitution Day', '12-31': "New Year's Eve",
  };
  function nameFromText(s) {
    for (const [re, name] of NAME_KEYS) if (re.test(s)) return name;
    return '';
  }
  function namesInOrder(text) {
    // scan for keywords left→right; each keyword occurrence = one holiday column
    const hits = [];
    NAME_KEYS.forEach(([re, name]) => {
      const g = new RegExp(re.source, 'gi');
      let m;
      while ((m = g.exec(text))) hits.push({ index: m.index, end: m.index + m[0].length, name });
    });
    hits.sort((a, b) => a.index - b.index || (b.end - b.index) - (a.end - a.index));
    const out = [];
    let lastEnd = -1;
    hits.forEach(h => { if (h.index >= lastEnd) { out.push(h.name); lastEnd = h.end; } });
    return out;
  }

  const TEAM_RE = /(?:4\s*off\s*2\s*)?team\s*([ABC])\b|ทีม\s*([ABC])\b/i;
  function teamOf(label) {
    const s = String(label || '');
    if (/office|6\s*off\s*1|off-?(sat|sun)/i.test(s)) return null;
    const m = s.match(TEAM_RE);
    return m ? (m[1] || m[2]).toUpperCase() : null;
  }

  function finish(master, names, teamDates, fallbackYear) {
    return master.map((date, i) => {
      const h = { date, name: names[i] || FIXED_NAMES[date.slice(5)] || '', subA: '', subB: '', subC: '' };
      ['A', 'B', 'C'].forEach(t => {
        const tok = teamDates[t] && teamDates[t][i];
        const d = tok ? resolve(tok, date, fallbackYear) : '';
        if (d && d !== date) h['sub' + t] = d;
      });
      return h;
    });
  }

  /** Table layout: one row of holiday dates (columns), one row per team. */
  function parseTables(tables, fallbackYear) {
    for (const rows of tables || []) {
      const parsed = rows.map(r => r.map(c => findDates(c)[0] || null));
      // master row = row with most dates that carry a year (else most dates)
      let mi = -1, best = 0;
      parsed.forEach((r, i) => {
        const withYear = r.filter(t => t && t.year).length;
        const score = withYear * 100 + r.filter(Boolean).length;
        if (r.filter(Boolean).length >= 2 && score > best) { best = score; mi = i; }
      });
      if (mi < 0) continue;
      const cols = [];
      parsed[mi].forEach((t, c) => { if (t) cols.push(c); });
      const master = cols.map(c => resolve(parsed[mi][c], null, fallbackYear));
      // names: nearest row above with text in those columns
      let names = cols.map(() => '');
      for (let r = mi - 1; r >= 0; r--) {
        const cand = cols.map(c => (rows[r][c] || '').trim());
        if (cand.filter(Boolean).length >= Math.ceil(cols.length / 2)) {
          names = cand.map(s => nameFromText(s) || s); break;
        }
      }
      const teamDates = {};
      rows.forEach((r, ri) => {
        if (ri === mi) return;
        const t = teamOf(r.slice(0, Math.max(1, cols[0])).join(' '));
        if (t && !teamDates[t]) teamDates[t] = cols.map(c => parsed[ri][c]);
      });
      if (master.length) return finish(master, names, teamDates, fallbackYear);
    }
    return null;
  }

  /** Plain-text layout (no table structure): dates in reading order. */
  function parseText(text, fallbackYear) {
    const s = String(text || '');
    const toks = findDates(s);
    if (!toks.length) return [];
    // master dates: the run of tokens WITH a year (header row like 01-Jan-26 …)
    let master = toks.filter(t => t.year);
    let rest;
    if (master.length >= 2) {
      const lastMasterIdx = toks.indexOf(master[master.length - 1]);
      rest = toks.slice(lastMasterIdx + 1);
    } else {
      master = toks; rest = [];
    }
    const masterIso = master.map(t => resolve(t, null, fallbackYear));
    const n = masterIso.length;

    // team rows: find labels after the header and take the next n date tokens after each label
    const teamDates = {};
    const labelRe = /(?:4\s*off\s*2\s*)?team\s*([ABC])\b|office\s*\(?sat-?sun\)?|6\s*off\s*1\s*\(?off-?(?:sat|sun)\)?/gi;
    let m;
    const labels = [];
    while ((m = labelRe.exec(s))) labels.push({ index: m.index, team: m[1] ? m[1].toUpperCase() : null });
    labels.forEach((lab, li) => {
      if (!lab.team || teamDates[lab.team]) return;
      const nextIdx = li + 1 < labels.length ? labels[li + 1].index : Infinity;
      let row = rest.filter(t => t.index > lab.index && t.index < nextIdx);
      if (row.length < n) {
        // labels may all come before the dates (column-wise OCR): fall back to chunks of n
        const pos = labels.filter(l => l.index <= lab.index).length - 1;
        row = rest.slice(pos * n, pos * n + n);
      }
      if (row.length >= n) teamDates[lab.team] = row.slice(0, n);
    });

    let names = namesInOrder(s.slice(0, master.length ? master[0].index : s.length));
    if (names.length !== n) names = [];
    return finish(masterIso, names, teamDates, fallbackYear);
  }

  function parse(ocr, fallbackYear) {
    fallbackYear = fallbackYear || new Date().getFullYear();
    const fromTables = parseTables(ocr && ocr.tables, fallbackYear);
    const list = (fromTables && fromTables.length) ? fromTables : parseText(ocr && ocr.text, fallbackYear);
    // de-duplicate, sort
    const seen = {};
    return list.filter(h => h.date && !seen[h.date] && (seen[h.date] = 1)).sort((a, b) => a.date < b.date ? -1 : 1);
  }

  const api = { parse, findDates, parseTables, parseText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HolidayParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
