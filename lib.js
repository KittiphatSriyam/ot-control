/*
 * lib.js — shared logic (pattern 4W2H, hour totals, colours)
 * Used by the web app; also loadable from Node for tests.
 */
(function (root) {
  'use strict';

  // ---------- Pattern 4W2H ----------
  // 12-day cycle per team: Day x4, Off x2, Night x4, Off x2
  const CYCLE = ['D', 'D', 'D', 'D', 'H', 'H', 'N', 'N', 'N', 'N', 'H', 'H'];
  // Anchor: 2026-01-01 Team A = Day (cycle position 0); B = Night (pos 8); C = Holiday (pos 4)
  const ANCHOR = Date.UTC(2026, 0, 1);
  const TEAM_OFFSET = { A: 0, B: 8, C: 4 };
  const TEAMS = ['A', 'B', 'C'];
  const DAY = 864e5;

  function toTime(s) {
    const [y, m, d] = String(s).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }
  function fmt(t) { return new Date(t).toISOString().slice(0, 10); }
  function addDays(s, n) { return fmt(toTime(s) + n * DAY); }
  function dow(s) { return new Date(toTime(s)).getUTCDay(); } // 0=Sun
  function diffDays(a, b) { return Math.round((toTime(b) - toTime(a)) / DAY); }
  function range(from, to) {
    const out = [];
    for (let s = from; s <= to; s = addDays(s, 1)) out.push(s);
    return out;
  }
  function todayStr() {
    // Asia/Bangkok date
    return fmt(Date.now() + 7 * 3600e3);
  }
  function monthStr(s) { return s.slice(0, 7); }
  function monthFirst(m) { return m + '-01'; }
  function monthLast(m) {
    const [y, mm] = m.split('-').map(Number);
    return fmt(Date.UTC(y, mm, 0));
  }
  function addMonths(m, n) {
    const [y, mm] = m.split('-').map(Number);
    const d = new Date(Date.UTC(y, mm - 1 + n, 1));
    return d.toISOString().slice(0, 7);
  }

  /** Pattern status of a team on a date: 'D' | 'N' | 'H' | null */
  function teamStatus(team, s) {
    const off = TEAM_OFFSET[team];
    if (off == null) return null;
    const i = (((diffDays(fmt(ANCHOR), s) + off) % 12) + 12) % 12;
    return CYCLE[i];
  }
  /** Which team is on Day / Night / Holiday for a date */
  function teamsOn(s) {
    const r = { D: null, N: null, H: [] };
    TEAMS.forEach(t => {
      const st = teamStatus(t, s);
      if (st === 'H') r.H.push(t); else r[st] = t;
    });
    return r;
  }

  // ---------- Work week (Sat–Fri, like the Control sheet) ----------
  function weekStart(s) { return addDays(s, -((dow(s) + 1) % 7)); }
  function weekDays(ws) { return range(ws, addDays(ws, 6)); }

  // ---------- Holidays ----------
  /** holidays: [{date,name,subA,subB,subC}] → effective holiday for a team on a date (or null) */
  function teamHolidayOn(holidays, team, s) {
    for (const h of holidays || []) {
      const eff = (team && h['sub' + team]) || h.date;
      if (eff === s) return h;
    }
    return null;
  }
  function publicHolidayOn(holidays, s) {
    return (holidays || []).find(h => h.date === s) || null;
  }
  /** Teams that have a substitute holiday on date s */
  function substituteTeamsOn(holidays, s) {
    const out = [];
    (holidays || []).forEach(h => TEAMS.forEach(t => { if (h['sub' + t] === s) out.push({ team: t, holiday: h }); }));
    return out;
  }

  // ---------- Entry types ----------
  const TYPES = {
    OT_WD: { label: 'OT 3.5', long: 'OT วันทำงาน', hours: 3.5, shift: true, normal: true },
    OT_HD: { label: 'OT 10.5', long: 'มาทำวันหยุด (OT300)', hours: 10.5, shift: true, normal: false },
    NO_OT: { label: 'ออกโอ', long: 'ทำงาน ไม่ทำ OT', hours: 0, shift: true, normal: true },
    OFF: { label: 'OFF', long: 'หยุด', hours: 0, shift: false, normal: false },
    AL: { label: 'AL', long: 'ลาพักร้อน', hours: 0, shift: false, normal: false },
    SL: { label: 'SL', long: 'ลาป่วย', hours: 0, shift: false, normal: false },
    PL: { label: 'ลากิจ', long: 'ลากิจ / ลางาน', hours: 0, shift: false, normal: false },
  };
  const LEAVE_TYPES = ['AL', 'SL', 'PL'];

  // Colours copied from the Excel Control sheet
  const COLORS = {
    D: '#FFFFFF',      // Day shift  (white)
    N: '#B4C6E7',      // Night shift (theme blue, tint 60%)
    OT_HD: '#66FFFF',  // OT 10.5 on a day off (cyan)
    NO_OT: '#00FF00',  // ออกโอ (green)
    AL: '#FFE699',
    SL: '#F8CBAD',
    PL: '#E2EFDA',
    OFF: '#F2F2F2',
    OVER: '#FF7C80',   // weekly total over cap
    HOLIDAY: '#FF0000',
    SUB: '#0000FF',
    TEAM: { A: '#FFC000', B: '#548235', C: '#9BC2E6' },
    TEAM_TEXT: { A: '#000000', B: '#FFFFFF', C: '#000000' },
  };

  function cellText(e) {
    if (!e) return '';
    if (e.type === 'OT_WD' || e.type === 'OT_HD') return String(+e.hours);
    return (TYPES[e.type] || {}).label || e.type;
  }
  function cellColor(e) {
    if (!e) return null;
    if (e.type === 'OT_WD') return e.shift === 'N' ? COLORS.N : COLORS.D;
    if (COLORS[e.type]) return COLORS[e.type];
    return null;
  }

  // ---------- Hours ----------
  const DEFAULT_CFG = { weeklyCap: 60, normalHours: 7 };

  function dayHours(e, cfg) {
    cfg = cfg || DEFAULT_CFG;
    if (!e || e.status === 'rejected') return { normal: 0, ot: 0 };
    const t = TYPES[e.type];
    if (!t) return { normal: 0, ot: 0 };
    const ot = (e.type === 'OT_WD' || e.type === 'OT_HD') ? (+e.hours || 0) : 0;
    return { normal: t.normal ? cfg.normalHours : 0, ot };
  }

  /** byDate: {yyyy-mm-dd: entry} for ONE person */
  function weekTotals(byDate, ws, cfg) {
    cfg = cfg || DEFAULT_CFG;
    let normal = 0, ot = 0, pending = 0;
    const days = weekDays(ws).map(d => {
      const e = byDate[d] || null;
      const h = dayHours(e, cfg);
      normal += h.normal; ot += h.ot;
      if (e && e.status === 'pending') pending++;
      return { date: d, entry: e, ...h };
    });
    const total = normal + ot;
    return { weekStart: ws, days, normal, ot, total, over: total > cfg.weeklyCap, pending };
  }

  /** Monthly summary for one person. entries: list for that person covering the weeks of the month */
  function monthSummary(entries, month, cfg, opts) {
    cfg = cfg || DEFAULT_CFG;
    opts = opts || {};
    const use = e => e.status !== 'rejected' && (!opts.approvedOnly || e.status === 'approved');
    const first = monthFirst(month), last = monthLast(month);
    const byDate = {};
    entries.forEach(e => { if (use(e)) byDate[e.date] = e; });
    const s = { otWdDays: 0, otWdHours: 0, otHdDays: 0, otHdHours: 0, noOtDays: 0, dayShifts: 0, nightShifts: 0,
      AL: 0, SL: 0, PL: 0, OFF: 0, pending: 0, rejected: 0, normalHours: 0, totalHours: 0, weeksOver: 0, maxWeek: 0 };
    entries.forEach(e => {
      if (e.date < first || e.date > last) return;
      if (e.status === 'pending') s.pending++;
      if (e.status === 'rejected') s.rejected++;
      if (!use(e)) return;
      const h = dayHours(e, cfg);
      s.normalHours += h.normal; s.totalHours += h.normal + h.ot;
      if (e.type === 'OT_WD') { s.otWdDays++; s.otWdHours += +e.hours || 0; }
      if (e.type === 'OT_HD') { s.otHdDays++; s.otHdHours += +e.hours || 0; }
      if (e.type === 'NO_OT') s.noOtDays++;
      if (TYPES[e.type] && TYPES[e.type].shift) { if (e.shift === 'N') s.nightShifts++; else s.dayShifts++; }
      if (s[e.type] != null && LEAVE_TYPES.concat('OFF').includes(e.type)) s[e.type]++;
    });
    // weeks that start inside the month (each WW counted once, in the month it starts)
    for (let ws = weekStart(first); ws <= last; ws = addDays(ws, 7)) {
      if (ws < first) continue;
      const w = weekTotals(byDate, ws, cfg);
      if (w.over) s.weeksOver++;
      s.maxWeek = Math.max(s.maxWeek, w.total);
    }
    return s;
  }

  /** Position of the date in the team's 12-day cycle (0-3 Day, 4-5 off, 6-9 Night, 10-11 off) */
  function cyclePos(team, s) {
    const off = TEAM_OFFSET[team];
    if (off == null) return null;
    return (((diffDays(fmt(ANCHOR), s) + off) % 12) + 12) % 12;
  }

  /**
   * Default entry for one day (rule confirmed by the user; matches 94–99% of the 2025-26 Control sheets):
   *  work day (D/N)                         → OT 3.5 on that shift
   *  day off next to the team's DAY shift   → OT 10.5, Day shift
   *  day off next to the team's NIGHT shift → OFF
   *    Day x4 | 10.5  OFF | Night x4 | OFF  10.5 | Day …   (cycle positions 4 = 10.5, 5 = OFF, 10 = OFF, 11 = 10.5)
   *  team holiday / substitute on a work day → OFF
   */
  function defaultEntry(team, s, holidays) {
    const st = teamStatus(team, s);
    if (!st) return null;
    if (st !== 'H' && teamHolidayOn(holidays, team, s)) return { date: s, type: 'OFF', shift: '', hours: 0, note: '' };
    if (st === 'D' || st === 'N') return { date: s, type: 'OT_WD', shift: st, hours: 3.5, note: '' };
    const pos = cyclePos(team, s);
    if (pos === 5 || pos === 10) return { date: s, type: 'OFF', shift: '', hours: 0, note: '' }; // touches the Night block
    return { date: s, type: 'OT_HD', shift: 'D', hours: 10.5, note: '' };                         // pos 4 / 11: touches the Day block
  }

  /**
   * Suggested entries for a week (only days without an entry), kept within the weekly cap:
   * if the week goes over, the suggested OT 3.5 day closest to an OT 10.5 day becomes "ออกโอ" (as in the Excel sheets).
   */
  function suggestWeek(team, ws, byDate, holidays, cfg) {
    cfg = cfg || DEFAULT_CFG;
    const out = [];
    weekDays(ws).forEach(d => {
      if (byDate[d]) return;
      const e = defaultEntry(team, d, holidays);
      if (e) out.push(e);
    });
    const total = () => {
      const by = Object.assign({}, byDate);
      out.forEach(x => { by[x.date] = x; });
      return weekTotals(by, ws, cfg).total;
    };
    const hdDays = weekDays(ws).filter(d => {
      const e = out.find(x => x.date === d) || byDate[d];
      return e && e.type === 'OT_HD' && e.status !== 'rejected';
    });
    while (total() > cfg.weeklyCap) {
      const cands = out.filter(x => x.type === 'OT_WD');
      if (!cands.length) break;
      const dist = x => hdDays.length ? Math.min(...hdDays.map(h => Math.abs(diffDays(h, x.date)))) : 0;
      cands.sort((a, b) => dist(a) - dist(b) || (a.date < b.date ? 1 : -1)); // nearest to 10.5; tie → the later day
      cands[0].type = 'NO_OT'; cands[0].hours = 0;
    }
    return out;
  }

  const lib = {
    CYCLE, TEAMS, TEAM_OFFSET, TYPES, LEAVE_TYPES, COLORS, DEFAULT_CFG,
    toTime, fmt, addDays, dow, diffDays, range, todayStr, monthStr, monthFirst, monthLast, addMonths,
    teamStatus, teamsOn, weekStart, weekDays,
    teamHolidayOn, publicHolidayOn, substituteTeamsOn,
    cellText, cellColor, dayHours, weekTotals, monthSummary, suggestWeek, defaultEntry, cyclePos,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = lib;
  else root.OTLib = lib;
})(typeof window !== 'undefined' ? window : globalThis);
