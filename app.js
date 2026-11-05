/* OT Control — LINE mini app (LIFF) front-end */
(function () {
  'use strict';
  const L = window.OTLib;
  const C = L.COLORS;
  const CFG = window.CONFIG || {};

  const S = {
    idToken: null, profile: null, lineUserId: null,
    user: null, cfg: L.DEFAULT_CFG, holidays: [],
    tab: null,
    week: L.weekStart(L.todayStr()),
    month: L.monthStr(L.todayStr()),
    year: L.todayStr().slice(0, 4),
    approvedOnly: false,
    pendingCount: 0,
  };

  const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const TH_MONTH_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const SHIFT_NAME = { D: 'กะเช้า (Day)', N: 'กะดึก (Night)', H: 'วันหยุด (Holiday)' };
  const STATUS_TH = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ' };

  const TECH_TABS = [
    { id: 'home', label: 'สัปดาห์นี้' },
    { id: 'cal', label: 'ปฏิทิน' },
    { id: 'req', label: 'คำขอของฉัน' },
    { id: 'pattern', label: 'Pattern / วันหยุด' },
  ];
  const ENG_TABS = [
    { id: 'approve', label: 'อนุมัติ' },
    { id: 'week', label: 'ตารางสัปดาห์' },
    { id: 'month', label: 'สรุปรายเดือน' },
    { id: 'pattern', label: 'Pattern' },
    { id: 'holiday', label: 'วันหยุด' },
    { id: 'users', label: 'ผู้ใช้' },
  ];

  // ================= utils =================
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => (Math.round(n * 100) / 100).toString();
  const dShort = s => { const [, m, d] = s.split('-').map(Number); return d + ' ' + TH_MONTH[m - 1]; };
  const dLong = s => DOW[L.dow(s)] + ' ' + dShort(s) + ' ' + s.slice(0, 4);
  const mLabel = m => { const [y, mm] = m.split('-').map(Number); return TH_MONTH_FULL[mm - 1] + ' ' + y; };
  const isEng = () => S.user && S.user.role === 'engineer';
  const uName = u => u ? (u.name || '') + (u.nickname ? ' (' + u.nickname + ')' : '') : '';
  const teamBadge = t => t ? `<span class="team" style="background:${C.TEAM[t]};color:${C.TEAM_TEXT[t]}">${esc(t)}</span>` : '<span class="muted">-</span>';
  const ptBadge = st => st ? `<span class="pt ${st}" title="${SHIFT_NAME[st]}">${st}</span>` : '';
  const shiftIcon = sh => sh === 'N' ? '🌙' : sh === 'D' ? '☀️' : '';

  function chip(e) {
    if (!e) return '<span class="muted small">—</span>';
    const bg = L.cellColor(e) || '#fff';
    const icon = (e.type === 'OT_HD' || e.type === 'NO_OT') ? ' ' + shiftIcon(e.shift) : '';
    return `<span class="chip ${e.status}" style="background:${bg}">${esc(L.cellText(e))}${icon}</span>`;
  }

  function toast(msg, isErr) {
    const d = document.createElement('div');
    d.textContent = msg;
    if (isErr) d.className = 'err';
    $('#toast').appendChild(d);
    setTimeout(() => d.remove(), isErr ? 5000 : 2600);
  }
  let busyN = 0;
  function busy(on) { busyN += on ? 1 : -1; $('#busy').hidden = busyN <= 0; }

  async function api(action, data, opts) {
    opts = opts || {};
    if (!opts.quiet) busy(true);
    try {
      const res = await fetch(CFG.API_URL, {
        method: 'POST',
        body: JSON.stringify({ action, idToken: S.idToken, data: data || {} }), // text/plain → no CORS preflight
      });
      const j = await res.json();
      if (!j.ok) {
        if (j.error === 'AUTH' && window.liff && !CFG.DEV_USER) {
          // LINE token expired → log in with LINE again
          try { liff.logout(); } catch (e) { /* ignore */ }
          liff.login({ redirectUri: location.href });
        }
        const err = new Error(j.message || j.error); err.code = j.error; throw err;
      }
      return j.data;
    } finally { if (!opts.quiet) busy(false); }
  }

  function modal(html, onMount) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`;
    const bg = $('.modal-bg', root);
    bg.addEventListener('click', e => { if (e.target === bg) closeModal(); });
    if (onMount) onMount($('.modal', root));
  }
  function closeModal() { $('#modal-root').innerHTML = ''; }

  function byDateOf(entries) { const m = {}; entries.forEach(e => { m[e.date] = e; }); return m; }
  function holidayNote(date, team) {
    const pub = L.publicHolidayOn(S.holidays, date);
    const mine = team ? L.teamHolidayOn(S.holidays, team, date) : null;
    const out = [];
    if (mine) out.push('🎌 วันหยุด' + (mine.date !== date ? 'ชดเชย' : '') + 'ของทีม ' + team + ': ' + mine.name);
    else if (pub) out.push('🎌 ' + pub.name + (team && pub['sub' + team] ? ' (ทีม ' + team + ' หยุดชดเชย ' + dShort(pub['sub' + team]) + ')' : ''));
    return out.join('<br>');
  }

  // ================= boot / login with LINE =================
  async function init() {
    try {
      if (!CFG.API_URL || /YOUR_/.test(CFG.API_URL)) throw new Error('ยังไม่ได้ตั้งค่า API_URL ใน config.js');
      if (CFG.DEV_USER) {
        S.idToken = 'dev:' + CFG.DEV_USER;
        S.profile = { displayName: 'DEV ' + CFG.DEV_USER };
      } else {
        if (/YOUR_/.test(CFG.LIFF_ID || 'YOUR_')) throw new Error('ยังไม่ได้ตั้งค่า LIFF_ID ใน config.js');
        await liff.init({ liffId: CFG.LIFF_ID });
        if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
        S.idToken = liff.getIDToken();
        if (!S.idToken) throw new Error('ไม่ได้รับ ID token จาก LINE — ต้องเปิด scope "openid" ใน LIFF app');
        try { S.profile = await liff.getProfile(); } catch (e) { S.profile = null; }
      }
      await loadMe();
    } catch (e) {
      $('#app').innerHTML = `<main><div class="card err"><h3>เปิดแอปไม่สำเร็จ</h3><p>${esc(e.message)}</p>
        <button class="btn primary" onclick="location.reload()">ลองใหม่</button></div></main>`;
    }
  }

  async function loadMe() {
    const d = await api('me');
    S.user = d.user; S.cfg = d.config || L.DEFAULT_CFG; S.holidays = d.holidays || []; S.lineUserId = d.lineUserId;
    if (!S.user) return renderRegister();
    if (S.user.status !== 'active') return renderWaiting();
    renderShell();
  }

  function lineCard() {
    const p = S.profile || {};
    return `<div class="row" style="margin-bottom:10px">
      ${p.pictureUrl ? `<img src="${esc(p.pictureUrl)}" alt="" style="width:48px;height:48px;border-radius:50%">` : ''}
      <div><div class="small muted">เข้าสู่ระบบด้วย LINE</div><b>${esc(p.displayName || '')}</b></div></div>`;
  }

  function renderRegister() {
    $('#app').innerHTML = `
      <div class="top"><div class="bar"><span class="title">OT Control</span></div></div>
      <main><div class="card">
        <h2>ลงทะเบียนผูกบัญชี LINE</h2>
        ${lineCard()}
        <p class="small muted">กรอก EN ของคุณเพื่อผูกกับบัญชี LINE นี้ (ทำครั้งเดียว) จากนั้น Engineer จะอนุมัติ</p>
        <label class="f">EN (รหัสพนักงาน) *</label><input class="in" id="r-en" inputmode="numeric" placeholder="เช่น 535884">
        <label class="f">ชื่อ-นามสกุล (อังกฤษ)</label><input class="in" id="r-name" placeholder="เช่น Oatsadawut S.">
        <label class="f">ชื่อเล่น</label><input class="in" id="r-nick">
        <label class="f">ทีม</label>
        <div class="seg" id="r-team">${L.TEAMS.map(t => `<button data-v="${t}">Team ${t}</button>`).join('')}</div>
        <label class="f">เบอร์โทร</label><input class="in" id="r-phone" inputmode="tel">
        <div id="r-msg"></div>
        <button class="btn primary block" id="r-go" style="margin-top:14px">ลงทะเบียน</button>
      </div></main>`;
    let team = '';
    $$('#r-team button').forEach(b => b.onclick = () => { team = b.dataset.v; $$('#r-team button').forEach(x => x.classList.toggle('on', x === b)); });
    $('#r-go').onclick = async () => {
      const en = $('#r-en').value.trim();
      if (!/^\d{4,8}$/.test(en)) { $('#r-msg').innerHTML = '<div class="alert err">กรุณากรอก EN เป็นตัวเลข</div>'; return; }
      try {
        await api('register', { en, name: $('#r-name').value.trim(), nickname: $('#r-nick').value.trim(), team, phone: $('#r-phone').value.trim() });
        await loadMe();
      } catch (e) { $('#r-msg').innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
    };
  }

  function renderWaiting() {
    const u = S.user;
    $('#app').innerHTML = `
      <div class="top"><div class="bar"><span class="title">OT Control</span></div></div>
      <main><div class="card warn">
        ${lineCard()}
        <h2>${u.status === 'inactive' ? 'บัญชีถูกปิดการใช้งาน' : 'รอ Engineer อนุมัติ'}</h2>
        <p>EN <b>${esc(u.en)}</b> ${esc(uName(u))} ผูกกับ LINE นี้แล้ว</p>
        <p class="small muted">เมื่อได้รับการอนุมัติ กดปุ่มด้านล่างเพื่อเข้าใช้งาน</p>
        <button class="btn primary block" id="w-re">ตรวจสอบอีกครั้ง</button>
      </div></main>`;
    $('#w-re').onclick = () => loadMe().catch(e => toast(e.message, true));
  }

  // ================= shell =================
  function tabs() { return isEng() ? ENG_TABS : TECH_TABS; }

  function renderShell() {
    const u = S.user;
    const list = tabs();
    const fromHash = location.hash.replace('#', '');
    if (!S.tab || !list.some(t => t.id === S.tab)) S.tab = list.some(t => t.id === fromHash) ? fromHash : list[0].id;
    $('#app').innerHTML = `
      <div class="top">
        <div class="bar">
          <span class="title">OT Control</span>
          <div class="who">${esc(u.nickname || u.name || '')} ${teamBadge(u.team)}<br><span style="opacity:.85">EN ${esc(u.en)} · ${isEng() ? 'Engineer' : 'Technician'}</span></div>
          ${S.profile && S.profile.pictureUrl ? `<img src="${esc(S.profile.pictureUrl)}" alt="" style="width:34px;height:34px;border-radius:50%">` : ''}
        </div>
        <nav class="tabs">${list.map(t => `<button data-tab="${t.id}" class="${t.id === S.tab ? 'on' : ''}">${t.label}${t.id === 'approve' && S.pendingCount ? `<span class="badge">${S.pendingCount}</span>` : ''}</button>`).join('')}</nav>
      </div>
      <main id="view"></main>`;
    $$('.tabs button').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; history.replaceState(null, '', '#' + S.tab); renderShell(); });
    renderTab();
  }

  async function renderTab() {
    const el = $('#view');
    el.innerHTML = '<div class="splash" style="min-height:40vh"><div class="spinner"></div></div>';
    const views = { home: viewHome, cal: viewCal, req: viewReq, pattern: viewPattern, approve: viewApprove, week: viewWeek, month: viewMonth, holiday: viewHoliday, users: viewUsers };
    try { await views[S.tab](el); } catch (e) {
      el.innerHTML = `<div class="card err">${esc(e.message)}</div>`;
    }
  }
  const rerender = () => renderTab();

  // ================= entry modal (shared) =================
  /**
   * opts: { user, date, entry, byDate, onSaved }
   * Technician edits own; engineer edits on behalf (auto-approved).
   */
  function openEntry(opts) {
    const u = opts.user, date = opts.date, ex = opts.entry;
    const behalf = isEng() && u.en !== S.user.en;
    const st = L.teamStatus(u.team, date);
    const teamHol = L.teamHolidayOn(S.holidays, u.team, date);
    const f = {
      type: ex ? ex.type : (st === 'H' || teamHol ? 'OT_HD' : 'OT_WD'),
      shift: ex && ex.shift ? ex.shift : (st === 'N' ? 'N' : 'D'),
      hours: ex ? ex.hours : null,
      note: ex ? ex.note : '',
    };
    if (f.hours == null) f.hours = L.TYPES[f.type].hours;

    const canDelete = ex && (isEng() || ex.status !== 'approved');
    modal(`
      <h3>${dLong(date)}</h3>
      <div class="info">
        ${behalf ? `<div><b>${esc(uName(u))}</b> · EN ${esc(u.en)}</div>` : ''}
        <div>ทีม ${teamBadge(u.team)} · Pattern: ${st ? ptBadge(st) + ' ' + SHIFT_NAME[st] : '<span class="muted">ไม่ได้ระบุทีม</span>'}</div>
        ${holidayNote(date, u.team) ? `<div class="hol">${holidayNote(date, u.team)}</div>` : ''}
        ${ex ? `<div>สถานะ: <span class="st ${ex.status}">${STATUS_TH[ex.status]}</span>${ex.reviewNote ? ' — ' + esc(ex.reviewNote) : ''}</div>` : ''}
      </div>
      <label class="f">ประเภท</label>
      <div class="typegrid" id="e-type">${Object.keys(L.TYPES).map(k => {
        const t = L.TYPES[k];
        const bg = k === 'OT_WD' ? '#fff' : (C[k] || '#fff');
        return `<button data-v="${k}" style="background:${bg};border-color:${k === f.type ? '#111' : '#cbd5e1'}" class="${k === f.type ? 'on' : ''}">${t.label}<small>${t.long}</small></button>`;
      }).join('')}</div>
      <div id="e-shiftbox"><label class="f">กะ</label>
        <div class="seg" id="e-shift">
          <button data-v="D" style="background:${C.D}">☀️ Day (กะเช้า)</button>
          <button data-v="N" style="background:${C.N}">🌙 Night (กะดึก)</button>
        </div></div>
      <div id="e-hoursbox"><label class="f">ชั่วโมง OT</label>
        <input class="in" id="e-hours" type="number" step="0.25" min="0.25" max="16" inputmode="decimal"></div>
      <label class="f">หมายเหตุ</label>
      <input class="in" id="e-note" maxlength="200" placeholder="เช่น สลับกะกับ…, งาน rework line …">
      <div id="e-week"></div>
      ${ex && ex.status === 'approved' && !isEng() ? '<div class="alert warn">รายการนี้อนุมัติแล้ว ถ้าแก้ไขจะต้องรออนุมัติใหม่</div>' : ''}
      <div class="actions">
        ${canDelete ? '<button class="btn danger" id="e-del">ลบ</button>' : ''}
        <button class="btn" id="e-cancel">ยกเลิก</button>
        <button class="btn primary" id="e-save">บันทึก</button>
      </div>`, root => {
      const hoursIn = $('#e-hours', root), noteIn = $('#e-note', root);
      noteIn.value = f.note || '';
      function paint() {
        const t = L.TYPES[f.type];
        $$('#e-type button', root).forEach(b => { const on = b.dataset.v === f.type; b.classList.toggle('on', on); b.style.borderColor = on ? '#111' : '#cbd5e1'; });
        $$('#e-shift button', root).forEach(b => b.classList.toggle('on', b.dataset.v === f.shift));
        $('#e-shiftbox', root).classList.toggle('hidden', !t.shift);
        $('#e-hoursbox', root).classList.toggle('hidden', !(f.type === 'OT_WD' || f.type === 'OT_HD'));
        hoursIn.value = f.hours;
        // weekly preview
        if (opts.byDate) {
          const ws = L.weekStart(date);
          const by = Object.assign({}, opts.byDate);
          by[date] = { date, type: f.type, shift: f.shift, hours: f.hours, status: 'pending' };
          const w = L.weekTotals(by, ws, S.cfg);
          $('#e-week', root).innerHTML = `<div class="alert ${w.over ? 'err' : 'ok'}">สัปดาห์ ${dShort(ws)}–${dShort(L.addDays(ws, 6))}: รวม <b>${num(w.total)}</b> / ${S.cfg.weeklyCap} ชม. (ปกติ ${num(w.normal)} + OT ${num(w.ot)})${w.over ? ' — เกินกำหนด!' : ''}</div>`;
        }
      }
      $$('#e-type button', root).forEach(b => b.onclick = () => { f.type = b.dataset.v; f.hours = L.TYPES[f.type].hours; paint(); });
      $$('#e-shift button', root).forEach(b => b.onclick = () => { f.shift = b.dataset.v; paint(); });
      hoursIn.oninput = () => { f.hours = +hoursIn.value || 0; paint(); };
      $('#e-cancel', root).onclick = closeModal;
      $('#e-save', root).onclick = async () => {
        f.note = noteIn.value.trim();
        const t = L.TYPES[f.type];
        const payload = { date, type: f.type, shift: t.shift ? f.shift : '', hours: (f.type === 'OT_WD' || f.type === 'OT_HD') ? f.hours : 0, note: f.note };
        if (opts.byDate) {
          const by = Object.assign({}, opts.byDate); by[date] = Object.assign({ status: 'pending' }, payload);
          const w = L.weekTotals(by, L.weekStart(date), S.cfg);
          if (w.over && !confirm(`สัปดาห์นี้รวม ${num(w.total)} ชม. เกิน ${S.cfg.weeklyCap} ชม.\nต้องการบันทึกต่อหรือไม่?`)) return;
        }
        try {
          await api('saveEntries', { en: behalf ? u.en : undefined, entries: [payload] });
          closeModal(); toast(behalf ? 'บันทึกแล้ว (อนุมัติอัตโนมัติ)' : 'บันทึกแล้ว รอ Engineer อนุมัติ');
          opts.onSaved && opts.onSaved();
        } catch (e) { toast(e.message, true); }
      };
      if ($('#e-del', root)) $('#e-del', root).onclick = async () => {
        if (!confirm('ลบรายการวันที่ ' + dShort(date) + ' ?')) return;
        try {
          await api('deleteEntries', { en: behalf ? u.en : undefined, dates: [date] });
          closeModal(); toast('ลบแล้ว'); opts.onSaved && opts.onSaved();
        } catch (e) { toast(e.message, true); }
      };
      paint();
    });
  }

  async function fillWeekFromPattern(ws, byDate, onDone) {
    if (!S.user.team) return toast('ยังไม่ได้กำหนดทีม ติดต่อ Engineer', true);
    const sug = L.suggestWeek(S.user.team, ws, byDate, S.holidays);
    if (!sug.length) return toast('ทุกวันในสัปดาห์นี้มีข้อมูลแล้ว');
    const by = Object.assign({}, byDate);
    sug.forEach(x => { by[x.date] = Object.assign({ status: 'pending' }, x); });
    const w = L.weekTotals(by, ws, S.cfg);
    modal(`<h3>เติมตาม Pattern ทีม ${esc(S.user.team)}</h3>
      <p class="small muted">เติมเฉพาะวันที่ยังว่าง: วันทำงาน = OT 3.5 ตามกะ, วันหยุด = OFF (แก้ไขทีละวันได้ภายหลัง)</p>
      ${sug.map(x => `<div class="ap-entry"><span style="width:110px">${DOW[L.dow(x.date)]} ${dShort(x.date)}</span>${chip(Object.assign({ status: 'pending' }, x))} ${shiftIcon(x.shift)}</div>`).join('')}
      <div class="alert ${w.over ? 'err' : 'ok'}">รวมสัปดาห์ ${num(w.total)} / ${S.cfg.weeklyCap} ชม.</div>
      <div class="actions"><button class="btn" id="f-c">ยกเลิก</button><button class="btn primary" id="f-ok">บันทึก ${sug.length} วัน</button></div>`, root => {
      $('#f-c', root).onclick = closeModal;
      $('#f-ok', root).onclick = async () => {
        try { await api('saveEntries', { entries: sug }); closeModal(); toast('บันทึกแล้ว รออนุมัติ'); onDone(); } catch (e) { toast(e.message, true); }
      };
    });
  }

  // ================= TECH: week (home) =================
  async function viewHome(el) {
    const ws = S.week, we = L.addDays(ws, 6), today = L.todayStr();
    const entries = await api('listEntries', { from: ws, to: we }, { quiet: true });
    const by = byDateOf(entries);
    const w = L.weekTotals(by, ws, S.cfg);
    const team = S.user.team;
    const tSt = L.teamStatus(team, today);
    const pct = Math.min(100, w.total / S.cfg.weeklyCap * 100);
    el.innerHTML = `
      <div class="card">
        <div class="small muted">วันนี้ ${dLong(today)}</div>
        <div style="font-size:18px;font-weight:700;margin-top:2px">${team ? `ทีม ${teamBadge(team)} ${ptBadge(tSt)} ${SHIFT_NAME[tSt]}` : 'ยังไม่ได้กำหนดทีม'}</div>
        ${holidayNote(today, team) ? `<div class="small" style="color:var(--red)">${holidayNote(today, team)}</div>` : ''}
      </div>
      <div class="card">
        <div class="nav"><button class="btn" id="w-prev">‹</button><div class="label">${dShort(ws)} – ${dShort(we)}</div><button class="btn" id="w-next">›</button></div>
        <div class="row"><span class="big" style="color:${w.over ? 'var(--red)' : 'inherit'}">${num(w.total)}</span><span class="muted">/ ${S.cfg.weeklyCap} ชม.</span><span class="spacer"></span>
          <span class="small muted">ปกติ ${num(w.normal)} · OT ${num(w.ot)}</span></div>
        <div class="progress ${w.over ? 'over' : ''}"><div style="width:${pct}%"></div></div>
        ${w.over ? '<div class="alert err">เกิน ' + S.cfg.weeklyCap + ' ชม./สัปดาห์</div>' : ''}
        <div class="days" style="margin-top:8px">${w.days.map(d => {
          const st = L.teamStatus(team, d.date);
          const hol = holidayNote(d.date, team);
          return `<div class="d ${d.date === today ? 'today' : ''}" data-date="${d.date}">
            <div class="dt"><b>${DOW[L.dow(d.date)]}</b><span class="small muted">${dShort(d.date)}</span></div>
            ${ptBadge(st)}
            <div style="flex:1">${chip(d.entry)} ${d.entry && L.TYPES[d.entry.type].shift ? '<span class="small">' + shiftIcon(d.entry.shift) + '</span>' : ''}
              ${d.entry && d.entry.status !== 'approved' ? `<span class="st ${d.entry.status}">${STATUS_TH[d.entry.status]}</span>` : ''}
              ${hol ? `<div class="hol">${hol}</div>` : ''}</div>
            <span class="muted">›</span></div>`;
        }).join('')}</div>
        <button class="btn primary block" id="w-fill" style="margin-top:10px">⚡ เติมวันที่ว่างตาม Pattern</button>
      </div>
      ${legend()}`;
    $('#w-prev').onclick = () => { S.week = L.addDays(S.week, -7); rerender(); };
    $('#w-next').onclick = () => { S.week = L.addDays(S.week, 7); rerender(); };
    $('#w-fill').onclick = () => fillWeekFromPattern(ws, by, rerender);
    $$('.days .d').forEach(r => r.onclick = () => openEntry({ user: S.user, date: r.dataset.date, entry: by[r.dataset.date], byDate: by, onSaved: rerender }));
  }

  function legend() {
    return `<div class="legend">
      <span><i style="background:${C.D}"></i>Day</span><span><i style="background:${C.N}"></i>Night</span>
      <span><i style="background:${C.OT_HD}"></i>OT 10.5 วันหยุด</span><span><i style="background:${C.NO_OT}"></i>ออกโอ</span>
      <span><i style="background:${C.AL}"></i>AL</span><span><i style="background:${C.SL}"></i>SL</span><span><i style="background:${C.PL}"></i>ลากิจ</span>
      <span><i style="border-style:dashed;border-color:${'#f59e0b'}"></i>รออนุมัติ</span></div>`;
  }

  // ================= TECH: month calendar =================
  async function viewCal(el) {
    const m = S.month, first = L.monthFirst(m), last = L.monthLast(m);
    const from = L.weekStart(first), to = L.addDays(L.weekStart(last), 6);
    const entries = await api('listEntries', { from, to }, { quiet: true });
    const by = byDateOf(entries);
    const team = S.user.team, today = L.todayStr();
    let rows = '';
    for (let ws = from; ws <= to; ws = L.addDays(ws, 7)) {
      const w = L.weekTotals(by, ws, S.cfg);
      rows += '<tr>' + w.days.map(d => {
        const e = d.entry, st = L.teamStatus(team, d.date);
        const hol = L.publicHolidayOn(S.holidays, d.date) || L.teamHolidayOn(S.holidays, team, d.date);
        return `<td data-date="${d.date}" class="${d.date.slice(0, 7) !== m ? 'out' : ''} ${d.date === today ? 'today' : ''}">
          <div class="n ${hol ? 'hol' : ''}">${+d.date.slice(8)}</div>${ptBadge(st)}
          ${e ? `<div class="v ${e.status}" style="background:${L.cellColor(e) || '#fff'}">${esc(L.cellText(e))}</div>${L.TYPES[e.type].shift ? `<span class="sicon">${shiftIcon(e.shift)}</span>` : ''}` : ''}
        </td>`;
      }).join('') + `<td class="tot ${w.over ? 'over' : ''}">${w.total ? num(w.total) : ''}</td></tr>`;
    }
    el.innerHTML = `<div class="card">
      <div class="nav"><button class="btn" id="c-prev">‹</button><div class="label">${mLabel(m)}</div><button class="btn" id="c-next">›</button></div>
      <table class="cal"><thead><tr>${['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(x => `<th>${x}</th>`).join('')}<th>รวม</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="small muted">มุมขวาบน = Pattern ทีม ${esc(team || '-')} (D เช้า / N ดึก / H หยุด) · คอลัมน์ "รวม" = ชม. ต่อสัปดาห์ (เส้นแดง = เกิน ${S.cfg.weeklyCap})</p>
    </div>${legend()}`;
    $('#c-prev').onclick = () => { S.month = L.addMonths(S.month, -1); rerender(); };
    $('#c-next').onclick = () => { S.month = L.addMonths(S.month, 1); rerender(); };
    $$('.cal td[data-date]').forEach(td => td.onclick = () => openEntry({ user: S.user, date: td.dataset.date, entry: by[td.dataset.date], byDate: by, onSaved: rerender }));
  }

  // ================= TECH: my requests =================
  async function viewReq(el) {
    const today = L.todayStr();
    const entries = await api('listEntries', { from: L.addDays(today, -120), to: L.addDays(today, 90) }, { quiet: true });
    const by = byDateOf(entries);
    const open = entries.filter(e => e.status !== 'approved').sort((a, b) => a.date < b.date ? 1 : -1);
    const leaves = entries.filter(e => L.LEAVE_TYPES.includes(e.type)).sort((a, b) => a.date < b.date ? 1 : -1);
    const row = e => `<div class="ap-entry" data-date="${e.date}" style="cursor:pointer">
      <span style="width:110px">${DOW[L.dow(e.date)]} ${dShort(e.date)}</span>${chip(e)}
      <span class="st ${e.status}">${STATUS_TH[e.status]}</span>
      <span class="small muted" style="flex:1">${esc(e.reviewNote || e.note || '')}</span></div>`;
    el.innerHTML = `
      <div class="card"><h3>รออนุมัติ / ไม่อนุมัติ (${open.length})</h3>${open.length ? open.map(row).join('') : '<p class="muted">ไม่มีรายการค้าง</p>'}</div>
      <div class="card"><h3>ประวัติการลา</h3>${leaves.length ? leaves.map(row).join('') : '<p class="muted">ไม่มี</p>'}</div>`;
    $$('[data-date]', el).forEach(r => r.onclick = () => openEntry({ user: S.user, date: r.dataset.date, entry: by[r.dataset.date], byDate: by, onSaved: rerender }));
  }

  // ================= Pattern 4W2H (everyone) =================
  async function viewPattern(el) {
    const m = S.month, days = L.range(L.monthFirst(m), L.monthLast(m)), today = L.todayStr();
    const myTeam = S.user.team;
    const cell = (t, d) => {
      if (!t) return '<td></td>';
      const sub = S.holidays.some(h => h['sub' + t] === d);
      return `<td class="${sub ? 'sub' : ''} ${d === today ? 'today' : ''}" style="background:${C.TEAM[t]};color:${C.TEAM_TEXT[t]};${t === myTeam && !isEng() ? 'font-weight:900;text-decoration:underline' : ''}">${t}</td>`;
    };
    const hdr = days.map(d => {
      const hol = L.publicHolidayOn(S.holidays, d);
      return `<th class="${hol ? 'hol' : ''} ${d === today ? 'today' : ''}" title="${esc(hol ? hol.name : '')}">${+d.slice(8)}</th>`;
    }).join('');
    const yearHol = S.holidays.filter(h => h.date.slice(0, 4) === m.slice(0, 4));
    el.innerHTML = `<div class="card">
      <div class="nav"><button class="btn" id="p-prev">‹</button><div class="label">Pattern 4W2H · ${mLabel(m)}</div><button class="btn" id="p-next">›</button></div>
      <div class="scroll"><table class="pat">
        <tr class="date"><th class="lab">Date</th>${hdr}</tr>
        <tr class="dow"><th class="lab"></th>${days.map(d => `<th>${DOW[L.dow(d)].slice(0, 2)}</th>`).join('')}</tr>
        <tr><td class="lab">Day</td>${days.map(d => cell(L.teamsOn(d).D, d)).join('')}</tr>
        <tr><td class="lab">Night</td>${days.map(d => cell(L.teamsOn(d).N, d)).join('')}</tr>
        <tr><td class="lab">Holiday</td>${days.map(d => cell(L.teamsOn(d).H[0], d)).join('')}</tr>
      </table></div>
      <p class="small muted">สีแดง = วันหยุดนักขัตฤกษ์ · ช่องน้ำเงิน = วันหยุดชดเชยของทีมนั้น · รอบละ 12 วัน: เช้า 4 → หยุด 2 → ดึก 4 → หยุด 2</p>
    </div>
    <div class="card"><h3>วันหยุดประจำปี ${m.slice(0, 4)}</h3>
      ${yearHol.length ? `<div class="scroll"><table class="grid"><tr><th>วันที่</th><th>วันหยุด</th><th>Team A</th><th>Team B</th><th>Team C</th></tr>
      ${yearHol.map(h => `<tr><td>${dShort(h.date)}</td><td style="text-align:left">${esc(h.name)}</td>${['A', 'B', 'C'].map(t => `<td style="${h['sub' + t] ? 'background:#ffc000;font-weight:700' : ''}">${dShort(h['sub' + t] || h.date)}</td>`).join('')}</tr>`).join('')}
      </table></div><p class="small muted">ช่องสีส้ม = วันหยุดชดเชย</p>` : '<p class="muted">ยังไม่มีข้อมูลวันหยุดปีนี้</p>'}
    </div>`;
    $('#p-prev').onclick = () => { S.month = L.addMonths(S.month, -1); rerender(); };
    $('#p-next').onclick = () => { S.month = L.addMonths(S.month, 1); rerender(); };
  }

  // ================= ENG: approvals =================
  async function viewApprove(el) {
    const d = await api('pending', {}, { quiet: true });
    S.pendingCount = d.entries.length;
    const $tabBadge = $('.tabs button[data-tab="approve"]');
    if ($tabBadge) $tabBadge.innerHTML = 'อนุมัติ' + (S.pendingCount ? `<span class="badge">${S.pendingCount}</span>` : '');
    const users = {}; d.users.forEach(u => { users[u.en] = u; });
    const pUsers = d.users.filter(u => u.status === 'pending' && u.linked);
    const groups = {};
    d.entries.forEach(e => { (groups[e.en] = groups[e.en] || []).push(e); });
    const ctxBy = {};
    d.entries.concat(d.context).forEach(e => { (ctxBy[e.en] = ctxBy[e.en] || {})[e.date] = e; });

    let html = '';
    if (pUsers.length) {
      html += `<div class="card warn"><h3>ผู้ลงทะเบียนใหม่ (${pUsers.length})</h3>${pUsers.map(u => `
        <div class="ap-entry" data-en="${esc(u.en)}">
          <div style="flex:1"><b>EN ${esc(u.en)}</b> ${esc(uName(u))}<div class="small muted">LINE: ${esc(u.lineName || '-')} ${u.phone ? '· ' + esc(u.phone) : ''}</div></div>
          <select class="in sm" style="width:auto" data-k="team">${['', 'A', 'B', 'C'].map(t => `<option value="${t}" ${u.team === t ? 'selected' : ''}>${t ? 'Team ' + t : 'ทีม?'}</option>`).join('')}</select>
          <button class="btn sm primary" data-act="ok">อนุมัติ</button><button class="btn sm danger" data-act="no">ปฏิเสธ</button>
        </div>`).join('')}</div>`;
    }
    const ens = Object.keys(groups).sort((a, b) => ((users[a] || {}).team || 'Z').localeCompare((users[b] || {}).team || 'Z') || a.localeCompare(b));
    if (!ens.length) html += '<div class="card"><p class="muted">✅ ไม่มีรายการรออนุมัติ</p></div>';
    else html += `<div class="card"><div class="row wrap"><b>รออนุมัติ ${d.entries.length} รายการ จาก ${ens.length} คน</b><span class="spacer"></span>
      <button class="btn sm" id="a-all">เลือกทั้งหมด</button>
      <button class="btn sm primary" id="a-ok">อนุมัติที่เลือก</button><button class="btn sm danger" id="a-no">ไม่อนุมัติที่เลือก</button></div></div>`;
    ens.forEach(en => {
      const u = users[en] || { en, name: '?' };
      const list = groups[en].sort((a, b) => a.date < b.date ? -1 : 1);
      const weeks = {};
      list.forEach(e => { (weeks[L.weekStart(e.date)] = weeks[L.weekStart(e.date)] || []).push(e); });
      html += `<div class="card"><div class="row"><b>${esc(uName(u))}</b> ${teamBadge(u.team)} <span class="small muted">EN ${esc(en)}</span></div>`;
      Object.keys(weeks).sort().forEach(ws => {
        const w = L.weekTotals(ctxBy[en] || {}, ws, S.cfg);
        html += `<div class="wk ${w.over ? 'over' : ''}">สัปดาห์ ${dShort(ws)}–${dShort(L.addDays(ws, 6))}: รวม ${num(w.total)} / ${S.cfg.weeklyCap} ชม.${w.over ? ' ⚠️ เกิน' : ''}</div>`;
        weeks[ws].forEach(e => {
          const st = L.teamStatus(u.team, e.date);
          html += `<label class="ap-entry"><input type="checkbox" class="a-cb" value="${esc(e.id)}">
            <span style="width:96px">${DOW[L.dow(e.date)]} ${dShort(e.date)}</span>${ptBadge(st)}${chip(e)} ${L.TYPES[e.type].shift ? shiftIcon(e.shift) : ''}
            <span class="small muted" style="flex:1">${esc(e.note || '')}${st && L.TYPES[e.type].shift && st !== 'H' && e.shift !== st ? ' <b style="color:var(--amber)">(กะไม่ตรง Pattern)</b>' : ''}${st === 'H' && e.type === 'OT_WD' ? ' <b style="color:var(--amber)">(Pattern = วันหยุด)</b>' : ''}</span></label>`;
        });
      });
      html += '</div>';
    });
    el.innerHTML = html;

    $$('[data-en]', el).forEach(r => {
      const en = r.dataset.en;
      $('[data-act="ok"]', r).onclick = async () => {
        const team = $('[data-k="team"]', r).value;
        if (!team && !confirm('ยังไม่ได้เลือกทีม อนุมัติต่อหรือไม่?')) return;
        try { await api('updateUser', { en, team, status: 'active' }); toast('อนุมัติผู้ใช้แล้ว'); rerender(); } catch (e) { toast(e.message, true); }
      };
      $('[data-act="no"]', r).onclick = async () => {
        if (!confirm('ปฏิเสธและยกเลิกการผูก LINE ของ EN ' + en + ' ?')) return;
        try { await api('updateUser', { en, unlink: true, status: 'inactive' }); toast('ปฏิเสธแล้ว'); rerender(); } catch (e) { toast(e.message, true); }
      };
    });
    const sel = () => $$('.a-cb', el).filter(c => c.checked).map(c => c.value);
    if ($('#a-all')) {
      $('#a-all').onclick = () => { const cbs = $$('.a-cb', el); const all = cbs.every(c => c.checked); cbs.forEach(c => { c.checked = !all; }); };
      $('#a-ok').onclick = async () => {
        const ids = sel(); if (!ids.length) return toast('ยังไม่ได้เลือกรายการ', true);
        try { await api('review', { ids, decision: 'approved' }); toast('อนุมัติ ' + ids.length + ' รายการ'); rerender(); } catch (e) { toast(e.message, true); }
      };
      $('#a-no').onclick = async () => {
        const ids = sel(); if (!ids.length) return toast('ยังไม่ได้เลือกรายการ', true);
        const note = prompt('เหตุผลที่ไม่อนุมัติ (จะแจ้งไปทาง LINE)');
        if (!note) return;
        try { await api('review', { ids, decision: 'rejected', note }); toast('ไม่อนุมัติ ' + ids.length + ' รายการ'); rerender(); } catch (e) { toast(e.message, true); }
      };
    }
  }

  // ================= ENG: weekly grid =================
  function sortUsers(users) {
    return users.slice().sort((a, b) => (a.team || 'Z').localeCompare(b.team || 'Z') || (a.name || '').localeCompare(b.name || ''));
  }

  async function viewWeek(el) {
    const ws = S.week, we = L.addDays(ws, 6), days = L.weekDays(ws);
    const d = await api('teamData', { from: ws, to: we }, { quiet: true });
    const users = sortUsers(d.users.filter(u => u.role !== 'engineer' || d.entries.some(e => e.en === u.en)));
    const byU = {}; d.entries.forEach(e => { (byU[e.en] = byU[e.en] || {})[e.date] = e; });
    let body = '', lastTeam = null, overN = 0, pendN = 0;
    users.forEach(u => {
      if (u.team !== lastTeam) {
        lastTeam = u.team;
        body += `<tr class="teamrow"><td class="name">${u.team ? 'Team ' + esc(u.team) : 'ไม่ระบุทีม'}</td>${days.map(dd => `<td class="center">${u.team ? ptBadge(L.teamStatus(u.team, dd)) : ''}</td>`).join('')}<td></td><td></td></tr>`;
      }
      const w = L.weekTotals(byU[u.en] || {}, ws, S.cfg);
      if (w.over) overN++;
      pendN += w.pending;
      body += `<tr><td class="name" title="EN ${esc(u.en)}">${esc(u.nickname || u.name)} <span class="small muted">${esc(u.en)}</span></td>
        ${w.days.map(x => {
          const e = x.entry;
          if (!e) { const st = L.teamStatus(u.team, x.date); return `<td class="cell" data-en="${esc(u.en)}" data-date="${x.date}"><span class="ph">${st && st !== 'H' ? st : ''}</span></td>`; }
          return `<td class="cell ${e.status}" data-en="${esc(u.en)}" data-date="${x.date}" style="background:${L.cellColor(e) || '#fff'}">${esc(L.cellText(e))}${L.TYPES[e.type].shift && e.type !== 'OT_WD' ? `<span class="sicon">${shiftIcon(e.shift)}</span>` : ''}</td>`;
        }).join('')}
        <td class="num">${num(w.normal)}</td><td class="num ${w.over ? 'over' : ''}">${num(w.total)}</td></tr>`;
    });
    el.innerHTML = `<div class="card">
      <div class="nav"><button class="btn" id="g-prev">‹</button><div class="label">สัปดาห์ ${dShort(ws)} – ${dShort(we)} ${ws.slice(0, 4)}</div><button class="btn" id="g-next">›</button></div>
      <div class="row wrap small" style="margin-bottom:8px">
        <span>เกิน ${S.cfg.weeklyCap} ชม.: <b style="color:${overN ? 'var(--red)' : 'inherit'}">${overN} คน</b></span>
        <span>รออนุมัติ: <b>${pendN}</b></span><span class="spacer"></span>
        <button class="btn sm" id="g-today">สัปดาห์นี้</button><button class="btn sm primary" id="g-xls">⬇ Excel</button>
      </div>
      <div class="scroll"><table class="grid">
        <tr><th class="name">NAME</th>${days.map(dd => { const h = L.publicHolidayOn(S.holidays, dd); return `<th class="${h ? 'hol' : ''}" title="${esc(h ? h.name : '')}">${DOW[L.dow(dd)].toUpperCase()}<br>${+dd.slice(8)}</th>`; }).join('')}<th>W/Hrs.</th><th>TOTAL</th></tr>
        ${body || '<tr><td colspan="10" class="muted">ยังไม่มีผู้ใช้</td></tr>'}
      </table></div>
      <p class="small muted">แตะช่องเพื่อแก้ไขแทน (บันทึกโดย Engineer = อนุมัติทันที) · ช่องว่างแสดง Pattern (D/N) เป็นสีเทา</p>
    </div>${legend()}`;
    $('#g-prev').onclick = () => { S.week = L.addDays(S.week, -7); rerender(); };
    $('#g-next').onclick = () => { S.week = L.addDays(S.week, 7); rerender(); };
    $('#g-today').onclick = () => { S.week = L.weekStart(L.todayStr()); rerender(); };
    $('#g-xls').onclick = () => exportExcel({ from: ws, to: we, title: 'Week ' + ws, data: d });
    $$('td.cell', el).forEach(td => td.onclick = () => {
      const u = d.users.find(x => x.en === td.dataset.en);
      openEntry({ user: u, date: td.dataset.date, entry: (byU[u.en] || {})[td.dataset.date], byDate: byU[u.en] || {}, onSaved: rerender });
    });
  }

  // ================= ENG: monthly summary =================
  async function monthData(m) {
    const first = L.monthFirst(m), last = L.monthLast(m);
    const from = L.weekStart(first), to = L.addDays(L.weekStart(last), 6);
    const d = await api('teamData', { from, to }, { quiet: true });
    return { from, to, d };
  }

  function summaries(d, m) {
    const byU = {}; d.entries.forEach(e => { (byU[e.en] = byU[e.en] || []).push(e); });
    return sortUsers(d.users).filter(u => u.role !== 'engineer' || byU[u.en])
      .map(u => ({ u, s: L.monthSummary(byU[u.en] || [], m, S.cfg, { approvedOnly: S.approvedOnly }) }));
  }

  async function viewMonth(el) {
    const m = S.month;
    const { from, to, d } = await monthData(m);
    const rows = summaries(d, m);
    const tot = rows.reduce((a, r) => { Object.keys(r.s).forEach(k => { a[k] = (a[k] || 0) + r.s[k]; }); return a; }, {});
    el.innerHTML = `<div class="card">
      <div class="nav"><button class="btn" id="m-prev">‹</button><div class="label">สรุป OT ${mLabel(m)}</div><button class="btn" id="m-next">›</button></div>
      <div class="row wrap small" style="margin-bottom:8px">
        <label><input type="checkbox" id="m-appr" ${S.approvedOnly ? 'checked' : ''}> นับเฉพาะที่อนุมัติแล้ว</label><span class="spacer"></span>
        <button class="btn sm primary" id="m-xls">⬇ Excel ทั้งเดือน</button></div>
      <div class="scroll"><table class="grid">
        <tr><th class="name">ชื่อ</th><th>ทีม</th><th>OT วันทำงาน<br>(วัน)</th><th>OT วันทำงาน<br>(ชม.)</th><th>OT วันหยุด<br>OT300 (วัน)</th><th>OT วันหยุด<br>(ชม.)</th>
          <th>รวม OT<br>(ชม.)</th><th>ออกโอ</th><th>☀️ Day</th><th>🌙 Night</th><th>AL</th><th>SL</th><th>ลากิจ</th><th>สัปดาห์<br>เกิน ${S.cfg.weeklyCap}</th><th>สูงสุด<br>/สัปดาห์</th><th>รอ<br>อนุมัติ</th></tr>
        ${rows.map(({ u, s }) => `<tr><td class="name">${esc(uName(u))}<br><span class="small muted">EN ${esc(u.en)}</span></td><td>${teamBadge(u.team)}</td>
          <td class="num">${s.otWdDays}</td><td class="num">${num(s.otWdHours)}</td><td class="num">${s.otHdDays}</td><td class="num">${num(s.otHdHours)}</td>
          <td class="num"><b>${num(s.otWdHours + s.otHdHours)}</b></td><td class="num">${s.noOtDays}</td><td class="num">${s.dayShifts}</td><td class="num">${s.nightShifts}</td>
          <td class="num">${s.AL}</td><td class="num">${s.SL}</td><td class="num">${s.PL}</td>
          <td class="num ${s.weeksOver ? 'bad' : ''}">${s.weeksOver}</td><td class="num ${s.maxWeek > S.cfg.weeklyCap ? 'bad' : ''}">${num(s.maxWeek)}</td><td class="num">${s.pending || ''}</td></tr>`).join('')}
        <tr style="font-weight:700;background:#f1f5f9"><td class="name">รวม</td><td></td><td class="num">${tot.otWdDays || 0}</td><td class="num">${num(tot.otWdHours || 0)}</td><td class="num">${tot.otHdDays || 0}</td><td class="num">${num(tot.otHdHours || 0)}</td>
          <td class="num">${num((tot.otWdHours || 0) + (tot.otHdHours || 0))}</td><td class="num">${tot.noOtDays || 0}</td><td class="num">${tot.dayShifts || 0}</td><td class="num">${tot.nightShifts || 0}</td>
          <td class="num">${tot.AL || 0}</td><td class="num">${tot.SL || 0}</td><td class="num">${tot.PL || 0}</td><td class="num">${tot.weeksOver || 0}</td><td></td><td class="num">${tot.pending || 0}</td></tr>
      </table></div>
      <p class="small muted">นับตามวันที่ในเดือน · "สัปดาห์เกิน" นับสัปดาห์ (ส.–ศ.) ที่เริ่มในเดือนนี้ · ไม่นับรายการที่ไม่อนุมัติ</p>
    </div>`;
    $('#m-prev').onclick = () => { S.month = L.addMonths(S.month, -1); rerender(); };
    $('#m-next').onclick = () => { S.month = L.addMonths(S.month, 1); rerender(); };
    $('#m-appr').onchange = e => { S.approvedOnly = e.target.checked; rerender(); };
    $('#m-xls').onclick = () => exportExcel({ from, to, month: m, title: 'OT ' + m, data: d });
  }

  // ================= ENG: holidays master + OCR import =================
  async function viewHoliday(el) {
    const year = S.year;
    let rows = S.holidays.filter(h => h.date.slice(0, 4) === year).map(h => Object.assign({}, h));
    let source = '';
    let ocrText = '';

    function draw() {
      el.innerHTML = `<div class="card">
        <div class="nav"><button class="btn" id="h-prev">‹</button><div class="label">วันหยุดประจำปี ${year}</div><button class="btn" id="h-next">›</button></div>
        <div class="card warn" style="box-shadow:none;background:#fffbeb">
          <b>นำเข้าจากไฟล์ประกาศวันหยุด (PDF / รูป)</b>
          <p class="small muted" style="margin:4px 0">ระบบอ่านด้วย OCR ของ Google (ฟรี) แล้วแสดงตารางให้ตรวจสอบก่อนบันทึก</p>
          <input type="file" id="h-file" accept="application/pdf,image/*" class="in">
        </div>
        ${source ? `<div class="alert warn">${esc(source)} — กรุณาตรวจสอบวันที่และวันหยุดชดเชยแต่ละทีมก่อนกดบันทึก</div>` : ''}
        <div class="scroll"><table class="hol">
          <tr><th>วันที่</th><th>ชื่อวันหยุด</th><th>ชดเชย Team A</th><th>ชดเชย Team B</th><th>ชดเชย Team C</th><th></th></tr>
          ${rows.map((h, i) => `<tr data-i="${i}">
            <td><input class="in sm" type="date" data-k="date" value="${esc(h.date)}"></td>
            <td><input class="in sm nm" data-k="name" value="${esc(h.name)}"></td>
            ${['subA', 'subB', 'subC'].map(k => `<td><input class="in sm" type="date" data-k="${k}" value="${esc(h[k] || '')}"></td>`).join('')}
            <td><button class="btn sm danger" data-del="${i}">✕</button></td></tr>`).join('')}
        </table></div>
        <div class="row wrap" style="margin-top:10px">
          <button class="btn" id="h-add">+ เพิ่มวันหยุด</button><span class="spacer"></span>
          <button class="btn" id="h-reset">ยกเลิกการแก้ไข</button>
          <button class="btn primary" id="h-save">💾 บันทึกเป็น Master ปี ${year}</button>
        </div>
        <p class="small muted">ช่อง "ชดเชย" เว้นว่าง = ทีมนั้นหยุดตรงวันจริง · บันทึกแล้วจะแทนที่ข้อมูลวันหยุดทั้งหมดของปี ${year}</p>
        ${ocrText ? `<details><summary class="small">ข้อความที่ OCR อ่านได้</summary><pre class="ocr">${esc(ocrText)}</pre></details>` : ''}
      </div>`;
      $$('tr[data-i] input', el).forEach(inp => inp.onchange = () => { rows[+inp.closest('tr').dataset.i][inp.dataset.k] = inp.value; });
      $$('[data-del]', el).forEach(b => b.onclick = () => { rows.splice(+b.dataset.del, 1); draw(); });
      $('#h-add').onclick = () => { rows.push({ date: year + '-01-01', name: '', subA: '', subB: '', subC: '' }); draw(); };
      $('#h-reset').onclick = () => rerender();
      $('#h-prev').onclick = () => { S.year = String(+S.year - 1); rerender(); };
      $('#h-next').onclick = () => { S.year = String(+S.year + 1); rerender(); };
      $('#h-save').onclick = async () => {
        const bad = rows.filter(h => !h.date || h.date.slice(0, 4) !== year);
        if (bad.length) return toast('มีวันที่ไม่อยู่ในปี ' + year, true);
        if (!confirm(`บันทึกวันหยุด ${rows.length} วัน เป็น Master ปี ${year} ?`)) return;
        try {
          const r = await api('saveHolidays', { year, holidays: rows });
          S.holidays = r.holidays; toast('บันทึกวันหยุดแล้ว'); rerender();
        } catch (e) { toast(e.message, true); }
      };
      $('#h-file').onchange = async ev => {
        const file = ev.target.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) return toast('ไฟล์ใหญ่เกิน 10 MB', true);
        try {
          const base64 = await fileToBase64(file);
          const ocr = await api('ocrHolidayFile', { fileName: file.name, mimeType: file.type || 'application/pdf', base64 });
          ocrText = ocr.text || '';
          const parsed = window.HolidayParser.parse(ocr, +year);
          if (!parsed.length) { source = ''; draw(); return toast('อ่านวันที่จากไฟล์ไม่ได้ — กรอกเองได้ในตาราง หรือดูข้อความ OCR ด้านล่าง', true); }
          // switch year if the file is for another year
          const yCount = {};
          parsed.forEach(h => { const y = h.date.slice(0, 4); yCount[y] = (yCount[y] || 0) + 1; });
          const fileYear = Object.keys(yCount).sort((a, b) => yCount[b] - yCount[a])[0];
          if (fileYear !== year) { S.year = fileYear; }
          rows = parsed.filter(h => h.date.slice(0, 4) === fileYear);
          source = `อ่านจาก ${file.name}: พบ ${rows.length} วันหยุด`;
          if (fileYear !== year) { return viewHolidayWith(el, rows, source, ocrText); }
          draw();
        } catch (e) { toast(e.message, true); }
      };
    }
    draw();
    // allow re-entry with preloaded rows after a year switch
    viewHoliday._set = (r, s, t) => { rows = r; source = s; ocrText = t; draw(); };
  }
  async function viewHolidayWith(el, rows, source, text) {
    await viewHoliday(el);
    viewHoliday._set(rows, source, text);
  }
  function fileToBase64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.onerror = () => rej(new Error('อ่านไฟล์ไม่ได้'));
      r.readAsDataURL(file);
    });
  }

  // ================= ENG: users =================
  async function viewUsers(el) {
    const users = sortUsers(await api('users', {}, { quiet: true }));
    el.innerHTML = `<div class="card"><h3>ผู้ใช้ (${users.length})</h3>
      <p class="small muted">ผู้ใช้ลงทะเบียนเองผ่าน LINE ด้วย EN · เปลี่ยนเครื่อง/เปลี่ยน LINE ให้กด "ยกเลิกผูก LINE" แล้วให้ลงทะเบียนใหม่</p>
      <div class="scroll"><table class="grid">
        <tr><th class="name">ชื่อ</th><th>EN</th><th>LINE</th><th>ทีม</th><th>สิทธิ์</th><th>สถานะ</th><th></th></tr>
        ${users.map(u => `<tr data-en="${esc(u.en)}">
          <td class="name">${esc(uName(u))}${u.phone ? `<br><span class="small muted">${esc(u.phone)}</span>` : ''}</td><td>${esc(u.en)}</td>
          <td>${u.linked ? '✅ ' + esc(u.lineName || '') : '<span class="muted">ยังไม่ผูก</span>'}</td>
          <td><select class="in sm" data-k="team">${['', 'A', 'B', 'C'].map(t => `<option value="${t}" ${u.team === t ? 'selected' : ''}>${t || '-'}</option>`).join('')}</select></td>
          <td><select class="in sm" data-k="role">${['technician', 'engineer'].map(r => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
          <td><select class="in sm" data-k="status">${['active', 'pending', 'inactive'].map(s => `<option ${u.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
          <td><button class="btn sm primary" data-act="save">บันทึก</button> ${u.linked ? '<button class="btn sm danger" data-act="unlink">ยกเลิกผูก LINE</button>' : ''}</td></tr>`).join('')}
      </table></div></div>`;
    $$('tr[data-en]', el).forEach(r => {
      const en = r.dataset.en;
      $('[data-act="save"]', r).onclick = async () => {
        const data = { en };
        $$('select', r).forEach(s => { data[s.dataset.k] = s.value; });
        try { await api('updateUser', data); toast('บันทึกแล้ว'); } catch (e) { toast(e.message, true); }
      };
      const ul = $('[data-act="unlink"]', r);
      if (ul) ul.onclick = async () => {
        if (!confirm('ยกเลิกการผูก LINE ของ EN ' + en + ' ? ผู้ใช้ต้องลงทะเบียนใหม่')) return;
        try { await api('updateUser', { en, unlink: true }); toast('ยกเลิกผูกแล้ว'); rerender(); } catch (e) { toast(e.message, true); }
      };
    });
  }

  // ================= Excel export (ExcelJS, colours like the Control sheet) =================
  let excelLoading = null;
  function loadExcelJS() {
    if (window.ExcelJS) return Promise.resolve();
    if (!excelLoading) excelLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
      s.onload = res; s.onerror = () => rej(new Error('โหลด ExcelJS ไม่สำเร็จ'));
      document.head.appendChild(s);
    });
    return excelLoading;
  }
  const argb = hex => 'FF' + hex.replace('#', '').toUpperCase();
  const fill = hex => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });
  const thin = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

  async function exportExcel(o) {
    if (window.liff && liff.isInClient && liff.isInClient()) {
      // LINE in-app browser cannot save files reliably → open the same page in the phone's browser
      if (confirm('การดาวน์โหลด Excel ต้องเปิดในเบราว์เซอร์ภายนอก เปิดเลยไหม?')) {
        liff.openWindow({ url: location.href.split('#')[0] + '#' + S.tab, external: true });
      }
      return;
    }
    try {
      busy(true);
      await loadExcelJS();
      const wb = new ExcelJS.Workbook();
      wb.creator = 'OT Control';
      const byU = {}; o.data.entries.forEach(e => { (byU[e.en] = byU[e.en] || {})[e.date] = e; });
      const users = sortUsers(o.data.users.filter(u => u.role !== 'engineer' || byU[u.en]));

      // --- Control sheet: one block per week (Sat–Fri) ---
      const ws1 = wb.addWorksheet('Control', { views: [{ state: 'frozen', xSplit: 3 }] });
      ws1.columns = [{ width: 8 }, { width: 10 }, { width: 24 }, ...Array(7).fill({ width: 8 }), { width: 9 }, { width: 9 }];
      ws1.addRow([`Control OT+ working hr shall be not over ${S.cfg.weeklyCap} hr/week`]).font = { bold: true, size: 13 };
      for (let wsD = o.from; wsD <= o.to; wsD = L.addDays(wsD, 7)) {
        const days = L.weekDays(wsD);
        ws1.addRow([]);
        const h1 = ws1.addRow(['Team', 'EN', 'NAME', ...days.map(d => DOW[L.dow(d)].toUpperCase()), 'W/Hrs.', 'TOTAL']);
        const h2 = ws1.addRow(['', '', `${days[0]} → ${days[6]}`, ...days.map(d => +d.slice(8)), '', S.cfg.weeklyCap]);
        [h1, h2].forEach(r => r.eachCell(c => { c.font = { bold: true }; c.border = thin; c.alignment = { horizontal: 'center' }; c.fill = fill('#B2B2B2'); }));
        days.forEach((d, i) => { if (L.publicHolidayOn(S.holidays, d)) { [h1, h2].forEach(r => { r.getCell(4 + i).fill = fill('#FFFF00'); }); } });
        users.forEach(u => {
          const w = L.weekTotals(byU[u.en] || {}, wsD, S.cfg);
          const r = ws1.addRow([u.team || '', u.en, uName(u), ...w.days.map(x => {
            const e = x.entry; if (!e || e.status === 'rejected') return '';
            return (e.type === 'OT_WD' || e.type === 'OT_HD') ? +e.hours : L.cellText(e);
          }), w.normal, w.total]);
          r.eachCell({ includeEmpty: true }, c => { c.border = thin; });
          w.days.forEach((x, i) => {
            const e = x.entry, c = r.getCell(4 + i);
            c.alignment = { horizontal: 'center' };
            if (!e || e.status === 'rejected') return;
            const col = L.cellColor(e); if (col) c.fill = fill(col);
            if (e.status === 'pending') c.font = { italic: true, color: { argb: 'FFC00000' } };
            const notes = [];
            if (L.TYPES[e.type].shift && e.type !== 'OT_WD') notes.push(e.shift === 'N' ? 'Night' : 'Day');
            if (e.status === 'pending') notes.push('รออนุมัติ');
            if (e.note) notes.push(e.note);
            if (notes.length) c.note = notes.join(' · ');
          });
          if (u.team) r.getCell(1).fill = fill(C.TEAM[u.team]);
          if (w.over) r.getCell(11).fill = fill(C.OVER);
          r.getCell(11).font = { bold: true };
        });
      }
      ws1.addRow([]);
      const lg = ws1.addRow(['', '', 'สี:', 'Day', 'Night', 'OT 10.5', 'ออกโอ', 'AL', 'SL', 'ลากิจ']);
      [['D', 4], ['N', 5], ['OT_HD', 6], ['NO_OT', 7], ['AL', 8], ['SL', 9], ['PL', 10]].forEach(([k, i]) => { lg.getCell(i).fill = fill(C[k]); lg.getCell(i).border = thin; });

      // --- Summary sheet (month export) ---
      if (o.month) {
        const ws2 = wb.addWorksheet('Summary');
        ws2.addRow(['สรุป OT ' + mLabel(o.month) + (S.approvedOnly ? ' (เฉพาะอนุมัติแล้ว)' : '')]).font = { bold: true, size: 13 };
        const hdr = ws2.addRow(['Team', 'EN', 'Name', 'OT วันทำงาน (วัน)', 'OT วันทำงาน (ชม.)', 'OT วันหยุด/OT300 (วัน)', 'OT วันหยุด (ชม.)', 'รวม OT (ชม.)', 'ออกโอ', 'Day shift', 'Night shift', 'AL', 'SL', 'ลากิจ', `สัปดาห์เกิน ${S.cfg.weeklyCap}`, 'สูงสุด/สัปดาห์', 'รออนุมัติ']);
        hdr.eachCell(c => { c.font = { bold: true }; c.fill = fill('#D9E1F2'); c.border = thin; c.alignment = { wrapText: true, horizontal: 'center' }; });
        summaries(o.data, o.month).forEach(({ u, s }) => {
          const r = ws2.addRow([u.team || '', u.en, uName(u), s.otWdDays, s.otWdHours, s.otHdDays, s.otHdHours, s.otWdHours + s.otHdHours, s.noOtDays, s.dayShifts, s.nightShifts, s.AL, s.SL, s.PL, s.weeksOver, s.maxWeek, s.pending]);
          r.eachCell({ includeEmpty: true }, c => { c.border = thin; });
          if (s.weeksOver) r.getCell(15).fill = fill(C.OVER);
        });
        for (let i = 1; i <= 17; i++) ws2.getColumn(i).width = i === 3 ? 26 : 12;
      }

      // --- Raw entries ---
      const ws3 = wb.addWorksheet('Entries');
      ws3.addRow(['Date', 'Day', 'EN', 'Name', 'Team', 'Type', 'Shift', 'OT hours', 'Status', 'Note', 'Reviewed by', 'Review note']).eachCell(c => { c.font = { bold: true }; c.fill = fill('#D9E1F2'); });
      const uMap = {}; o.data.users.forEach(u => { uMap[u.en] = u; });
      o.data.entries.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.en.localeCompare(b.en)).forEach(e => {
        const u = uMap[e.en] || {};
        ws3.addRow([e.date, DOW[L.dow(e.date)], e.en, uName(u), u.team || '', L.TYPES[e.type] ? L.TYPES[e.type].long : e.type, e.shift === 'N' ? 'Night' : e.shift === 'D' ? 'Day' : '', +e.hours || 0, STATUS_TH[e.status] || e.status, e.note || '', e.reviewedBy || '', e.reviewNote || '']);
      });
      [11, 6, 9, 24, 6, 20, 7, 9, 11, 30, 11, 24].forEach((wd, i) => { ws3.getColumn(i + 1).width = wd; });

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `OT-Control-${o.month || o.from}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('ดาวน์โหลด Excel แล้ว');
    } catch (e) { toast(e.message, true); } finally { busy(false); }
  }

  init();
})();
