// Şaxsiy Yordamçi — ilova (PWA) va Telegram Mini App uçun bitta kod
// Ma'lumot Apps Script Web App'dan keladi.
// Telegram içida: initData imzosi; alohida ilovada: parol bilan olingan token.

const API_URL = 'https://script.google.com/macros/s/AKfycby-HPWDSm7ImB9E1gvnynj0pLlgyYkM6T-iVB5bvGE0hXVjckrF6Z_A1BXfKQu61dFC/exec';
const tg = window.Telegram && window.Telegram.WebApp;
const IN_TELEGRAM = !!(tg && tg.initData);
const TOKEN_KEY = 'sy_token';
const WEEKDAYS = ['Yakşanba', 'Duşanba', 'Seşanba', 'Çorşanba', 'Payşanba', 'Juma', 'Şanba'];
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

const ICONS = {
  calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>'
};

// Agentlar (modullar) röyxati — yangi agent qöşiş uçun şu yerga bitta qator qöşiladi
const MODULES = [
  { id: 'planner', title: 'Rejalaştiruvçi', desc: 'Vazifalar va kun tartibi', icon: ICONS.calendar }
];

let view = 'day';          // day | tomorrow | week
let openMenu = null;       // oçiq turgan vazifa menyusi (id)
let routineDraft = null;   // jadval taklifida «alohida vazifa» uçun qoralama

// Ovoz yoziş holati
let rec = null;
let recStream = null;
let recChunks = [];
let recTimer = null;
let recStart = 0;
let recCancel = false;
const REC_MAX_SEC = 60;

const $ = (id) => document.getElementById(id);

// ---------- Server bilan aloqa ----------

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
}
function setToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) { /* xotira yöq */ }
}

/** Apps Script'ga POST (text/plain — CORS "preflight"siz) */
async function api(action, payload = {}) {
  const auth = IN_TELEGRAM ? { initData: tg.initData } : { token: getToken() };
  const res = await fetch(API_URL + '?api=1', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action }, auth, payload))
  });
  const data = await res.json();
  if (data.error === 'auth') {
    if (!IN_TELEGRAM) { setToken(null); go('login'); }
    throw new Error('Qayta kiring');
  }
  return data;
}

// ---------- Ekranlar orasida yuriş ----------

const SCREENS = ['login', 'home', 'planner'];

function go(name, push = true) {
  SCREENS.forEach((s) => $('screen-' + s).classList.toggle('hidden', s !== name));
  if (push && location.hash !== '#' + name) history.pushState(null, '', '#' + name);
  window.scrollTo(0, 0);
  if (tg && tg.BackButton && IN_TELEGRAM) name === 'planner' ? tg.BackButton.show() : tg.BackButton.hide();
  if (name === 'home') loadHome();
  if (name === 'planner') loadPlanner();
}

function currentRoute() {
  const h = location.hash.replace('#', '');
  if (!IN_TELEGRAM && !getToken()) return 'login';
  return SCREENS.indexOf(h) > 0 ? h : 'home';
}

// ---------- Kiriş ----------

async function login(e) {
  e.preventDefault();
  const b = $('loginBtn');
  const err = $('loginErr');
  err.classList.add('hidden');
  b.disabled = true; b.textContent = 'Tekşirilmoqda…';
  try {
    const device = /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'Kompyuter';
    const r = await api('login', { password: $('password').value, device });
    if (!r.ok) throw new Error(r.error || 'Kiriş bölmadi');
    setToken(r.token);
    $('password').value = '';
    go('home');
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  } finally {
    b.disabled = false; b.textContent = 'Kiriş';
  }
}

async function logout() {
  confirmAsk('Ilovadan çiqasizmi?', async () => {
    try { await api('logout', { token: getToken() }); } catch (e) { /* baribir çiqamiz */ }
    setToken(null);
    go('login');
  });
}

// ---------- Bosh ekran ----------

function renderModules() {
  const box = $('modules');
  box.innerHTML = '';
  MODULES.forEach((m) => {
    const b = document.createElement('button');
    b.className = 'module';
    b.innerHTML = '<div class="ico">' + m.icon + '</div><b>' + esc(m.title) + '</b><span>' + esc(m.desc) + '</span>';
    b.onclick = () => go(m.id);
    box.appendChild(b);
  });
  box.insertAdjacentHTML('beforeend',
    '<div class="module soon"><div class="ico">' + ICONS.plus + '</div><b>Yangi agent</b><span>Tez orada</span></div>');
}

async function loadHome() {
  const now = new Date();
  const h = now.getHours();
  $('greet').textContent = h < 5 ? 'Xayrli tun' : h < 12 ? 'Xayrli tong' : h < 18 ? 'Xayrli kun' : 'Xayrli keç';
  $('today').innerHTML = esc(WEEKDAYS[now.getDay()]) + ', <em>' + now.getDate() + '-' + MONTHS[now.getMonth()] + '</em>';

  const cached = readCache(ymd(today(0)));
  if (cached) renderSummary(cached);
  try {
    const data = await api('days', { from: ymd(today(0)), count: 1 });
    if (!data.ok) throw new Error(data.error);
    writeCache(data.days);
    renderSummary(data.days[0]);
  } catch (e) {
    if (!cached) $('sumNext').textContent = '⚠️ ' + e.message;
  }
}

function renderSummary(day) {
  const tasks = day.items.filter((x) => x.kind === 'task');
  const done = tasks.filter((x) => x.status === 'Bajarildi').length;
  $('sumCount').textContent = tasks.length ? done + '/' + tasks.length : '0';
  $('sumBar').style.width = tasks.length ? Math.round(done / tasks.length * 100) + '%' : '0';
  const hm = nowHM();
  const next = tasks.find((x) => x.status !== 'Bajarildi' && x.end >= hm);
  $('sumNext').textContent = next ? 'Keyingi: ' + next.start + ' — ' + next.title
    : tasks.length ? 'Bugungi vazifalar tugadi 👏' : 'Bugun vazifa yöq. Qöşiş uçun bosing.';
}

// ---------- Rejalaştiruvçi ----------

async function loadPlanner() {
  const list = $('list');
  openMenu = null;
  const from = view === 'tomorrow' ? ymd(today(1)) : ymd(today(0));
  const count = view === 'week' ? 7 : 1;
  const cached = count === 1 ? readCache(from) : null;
  if (cached) render([cached]);
  else list.innerHTML = '<div class="skel"></div><div class="skel"></div>';
  try {
    const data = await api('days', { from, count });
    if (!data.ok) throw new Error(data.error || 'Xatolik');
    writeCache(data.days);
    render(data.days);
  } catch (e) {
    if (!cached) {
      list.innerHTML = '<div class="error">⚠️ ' + esc(e.message) + '<button class="btn-ghost" id="retryBtn">Qayta urinib köriş</button></div>';
      $('retryBtn').onclick = loadPlanner;
    } else {
      toast('⚠️ Internet yöq — oxirgi saqlangan reja');
    }
  }
}

function render(days) {
  const list = $('list');
  list.innerHTML = '';
  const todayKey = ymd(today(0));
  days.forEach((day) => {
    // Hafta körinişida doimiy bloklar yaşiriladi — faqat vazifalar
    const items = view === 'week' ? day.items.filter((x) => x.kind === 'task') : day.items;
    const tasks = day.items.filter((x) => x.kind === 'task');
    const done = tasks.filter((x) => x.status === 'Bajarildi').length;

    const box = document.createElement('section');
    box.className = 'day';
    box.innerHTML = '<div class="day-head">' + esc(day.label) + (day.label.indexOf(day.weekday) === -1 ? ' · ' + esc(day.weekday) : '') +
      '<span>' + (tasks.length ? done + '/' + tasks.length + ' bajarildi' : '') + '</span></div>';

    if (!items.length) {
      box.insertAdjacentHTML('beforeend', '<div class="empty">' + (view === 'week' ? 'Vazifa yöq' : 'Reja böş') + '</div>');
    }
    items.forEach((it) => box.appendChild(renderItem(it, day.date === todayKey)));
    list.appendChild(box);
  });
}

function renderItem(it, isToday) {
  const wrap = document.createElement('div');
  const row = document.createElement('div');
  const isDone = it.status === 'Bajarildi';
  const late = it.kind === 'task' && !isDone && (it.status === 'Keçikdi' || (isToday && it.end < nowHM()));
  row.className = 'item ' + it.kind + (it.kind === 'block' && !it.soft ? ' hard' : '') + (isDone ? ' done' : '') + (late ? ' late' : '');
  row.innerHTML = (it.kind === 'block' ? '<span class="dot"><i></i></span>' : '') +
    '<span class="time">' + it.start + '–' + it.end + '</span><span class="title">' + esc(it.title) + '</span>';
  wrap.appendChild(row);
  if (it.kind !== 'task') return wrap;

  // Bajarildi belgisi
  const check = document.createElement('button');
  check.className = 'check';
  check.innerHTML = ICONS.check;
  check.setAttribute('aria-label', 'Bajarildi');
  check.onclick = () => { if (!isDone) act('done', it, row); };
  row.prepend(check);

  // Qöşimça amallar
  if (!isDone) {
    const more = document.createElement('button');
    more.className = 'more';
    more.innerHTML = ICONS.more;
    more.setAttribute('aria-label', 'Amallar');
    more.onclick = () => toggleMenu(it, wrap);
    row.appendChild(more);
  }
  return wrap;
}

function toggleMenu(it, wrap) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  if (openMenu === it.id) { openMenu = null; return; }
  openMenu = it.id;
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = '<button data-a="tomorrow">Ertaga köçiriş</button><button data-a="delete" class="del">Bekor qiliş</button>';
  m.onclick = (e) => {
    const a = e.target.dataset.a;
    if (a === 'delete') confirmAsk('«' + it.title + '» bekor qilinsinmi?', () => act('delete', it));
    else if (a) act(a, it);
  };
  wrap.appendChild(m);
}

/** Vazifa ustida amal: bajarildi / ertaga / bekor */
async function act(action, it, row) {
  haptic('light');
  if (row && action === 'done') row.classList.add('done');
  try {
    const r = await api(action, { id: it.id });
    if (!r.ok) throw new Error(r.error);
    toast(action === 'done' ? '✅ Bajarildi' : action === 'tomorrow' ? '➡️ Ertaga köçirildi' : 'Bekor qilindi');
    haptic('success');
  } catch (e) {
    toast('⚠️ ' + e.message);
  }
  loadPlanner();
}

// ---------- Yangi vazifa ----------

function openSheet(focus = true) {
  $('taskText').value = '';
  $('stepText').classList.remove('hidden');
  $('stepForm').classList.add('hidden');
  $('routineBox').classList.add('hidden');
  $('formWarn').classList.add('hidden');
  $('sheet').classList.remove('hidden');
  if (focus) setTimeout(() => $('taskText').focus(), 60);
}
function closeSheet() {
  if (rec && rec.state === 'recording') { recCancel = true; stopRecord(); }
  $('sheet').classList.add('hidden');
}

// ---------- Ovoz bilan vazifa ----------

function toggleRecord() {
  if (rec && rec.state === 'recording') stopRecord();
  else startRecord();
}

/** Mikrofonni yoqib, yozişni boşlaydi */
async function startRecord() {
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    toast('Bu qurilmada ovoz yoziş işlamaydi');
    return;
  }
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    toast('🎙 Mikrofonga ruxsat bering: Sozlamalar → Safari → Mikrofon');
    return;
  }
  recChunks = [];
  recCancel = false;
  rec = new MediaRecorder(recStream);
  rec.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
  rec.onstop = onRecordStop;
  rec.start();
  recStart = Date.now();
  setMicState('rec');
  haptic('light');
  recTimer = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    $('micLabel').textContent = 'Töxtatiş · ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    if (s >= REC_MAX_SEC) stopRecord();
  }, 250);
}

function stopRecord() {
  clearInterval(recTimer);
  if (rec && rec.state === 'recording') rec.stop();
  if (recStream) recStream.getTracks().forEach((t) => t.stop());
}

/** Yoziş tugadi: WAV'ga aylantirib, AI'ga yuboramiz */
async function onRecordStop() {
  if (recCancel) { setMicState('idle'); return; }
  setMicState('busy');
  try {
    if (Date.now() - recStart < 800) throw new Error('Juda qisqa. Bosing, gapiring, keyin yana bosing.');
    const blob = new Blob(recChunks, { type: (rec && rec.mimeType) || 'audio/mp4' });
    const wav = await toWav16k(blob);
    const r = await api('parse', { audio: { mime: 'audio/wav', data: wav } });
    if (!r.ok) throw new Error(r.error);
    haptic('success');
    if (r.routine) { showRoutine(r); return; }
    fillForm(r.draft, r.auto, r.warn, r.heard);
  } catch (e) {
    toast('⚠️ ' + e.message);
  } finally {
    setMicState('idle');
  }
}

function setMicState(state) {
  const b = $('micBtn');
  b.classList.toggle('rec', state === 'rec');
  b.disabled = state === 'busy';
  $('parseBtn').classList.toggle('hidden', state !== 'idle');
  $('manualBtn').classList.toggle('hidden', state !== 'idle');
  $('micLabel').textContent = state === 'rec' ? 'Töxtatiş · 0:00' : state === 'busy' ? 'Tuşunyapman…' : 'Gapirib aytiş';
}

/** Har qanday yozuvni 16 kHz mono WAV'ga aylantiradi (Gemini uni aniq qabul qiladi) */
async function toWav16k(blob) {
  const buf = await blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const audio = await new Promise((res, rej) => ctx.decodeAudioData(buf, res, rej));
  if (ctx.close) ctx.close();
  const rate = 16000;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new OAC(1, Math.ceil(audio.duration * rate), rate);
  const src = off.createBufferSource();
  src.buffer = audio;
  src.connect(off.destination);
  src.start(0);
  const pcm = (await off.startRendering()).getChannelData(0);

  const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  const u8 = new Uint8Array(view.buffer);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** AI matnni tahlil qiladi → töldirilgan forma */
async function parseText() {
  const text = $('taskText').value.trim();
  if (!text) return;
  const b = $('parseBtn');
  b.disabled = true; b.textContent = 'Tuşunyapman…';
  try {
    const r = await api('parse', { text });
    if (!r.ok) throw new Error(r.error);
    if (r.routine) { showRoutine(r); return; }
    fillForm(r.draft, r.auto, r.warn);
  } catch (e) {
    // AI işlamasa ham — forma bilan davom etamiz
    toast('⚠️ ' + e.message);
    fillForm({ title: text.slice(0, 100), date: defaultDate(), start: '', duration: 30 }, null, '');
  } finally {
    b.disabled = false; b.textContent = 'Davom etiş';
  }
}

function defaultDate() {
  return view === 'tomorrow' ? ymd(today(1)) : ymd(today(0));
}

function fillForm(t, auto, warn, heard) {
  $('fTitle').value = t.title || '';
  $('fDate').value = t.date || defaultDate();
  $('fStart').value = t.start ? t.start.padStart(5, '0') : '';
  setSelect('fDuration', t.duration || 30);
  setSelect('fPriority', t.priority || 'Örta');
  setSelect('fCategory', t.category || 'Boşqa');
  $('fNote').value = t.note || '';
  const notes = [];
  if (heard) notes.push('🎙 «' + heard + '»');
  if (auto === 'free') notes.push('🕒 Vaqtni böş oraliqqa özim qöydim.');
  if (auto === 'soft') notes.push('🕒 Böş vaqt yöq, iş/yöl vaqtiga qöydim.');
  if (warn) notes.push(warn);
  showWarn(notes.join('\n'));
  $('stepText').classList.add('hidden');
  $('routineBox').classList.add('hidden');
  $('stepForm').classList.remove('hidden');
}

// ---------- Kun tartibini özgartiriş ----------

/** Server «bu jadvaldagi blok» dedi: vazifa örniga jadval özgarişini körsatamiz */
function showRoutine(r) {
  routineDraft = r.draft || null;
  const same = !!r.routine.same;
  $('routineText').textContent = (r.heard ? '🎙 «' + r.heard + '»\n' : '') + r.routine.text +
    (same ? '\nU allaqaçon jadvalda bor.' : '');
  $('rOnce').textContent = same ? 'Tuşunarli' : 'Ha, faqat şu kun';
  $('rOnce').dataset.same = same ? '1' : '';
  $('rWeek').textContent = 'Har ' + r.routine.weekday + ' şunday';
  $('rWeek').classList.toggle('hidden', same);
  $('rTask').textContent = same ? 'Baribir vazifa qöş' : 'Yöq, alohida vazifa';
  $('rTask').classList.toggle('hidden', !routineDraft);
  $('stepText').classList.add('hidden');
  $('stepForm').classList.add('hidden');
  $('routineBox').classList.remove('hidden');
}

async function applyRoutine(scope) {
  if (scope === 'once' && $('rOnce').dataset.same) { closeSheet(); return; }
  const btns = [$('rOnce'), $('rWeek'), $('rTask')];
  btns.forEach((b) => { b.disabled = true; });
  try {
    const r = await api('routine', { scope });
    if (!r.ok) throw new Error(r.error);
    closeSheet();
    haptic('success');
    toast(r.text);
    loadPlanner();
  } catch (e) {
    toast('⚠️ ' + e.message);
  } finally {
    btns.forEach((b) => { b.disabled = false; });
  }
}

function setSelect(id, value) {
  const el = $(id);
  const v = String(value);
  if (![...el.options].some((o) => o.value === v)) el.add(new Option(v + (id === 'fDuration' ? ' daq' : ''), v));
  el.value = v;
}

function showWarn(text) {
  const w = $('formWarn');
  w.textContent = text;
  w.classList.toggle('hidden', !text);
}

async function saveTask(force) {
  const task = {
    title: $('fTitle').value.trim(),
    date: $('fDate').value,
    start: $('fStart').value,
    duration: Number($('fDuration').value),
    priority: $('fPriority').value,
    category: $('fCategory').value,
    note: $('fNote').value.trim()
  };
  const b = $('saveBtn');
  b.disabled = true; b.textContent = 'Saqlanmoqda…';
  try {
    const r = await api('save', { task, force: !!force });
    if (r.confirm) {
      // Qattiq blok (zal, dars) bilan töqnaşuv — tasdiq söraymiz
      confirmAsk(r.confirm + '\nBaribir saqlaymi?', () => saveTask(true));
      return;
    }
    if (!r.ok) throw new Error(r.error);
    closeSheet();
    haptic('success');
    toast('✅ Saqlandi\n' + r.summary);
    loadPlanner();
  } catch (e) {
    toast('⚠️ ' + e.message);
  } finally {
    b.disabled = false; b.textContent = 'Saqlaş';
  }
}

// ---------- Oflayn keş: oxirgi körilgan kunlar ----------

function readCache(date) {
  try { return JSON.parse(localStorage.getItem('sy_day_' + date) || 'null'); } catch (e) { return null; }
}
function writeCache(days) {
  try { days.forEach((d) => localStorage.setItem('sy_day_' + d.date, JSON.stringify(d))); } catch (e) { /* joy yöq */ }
}

// ---------- Mayda yordamçilar ----------

function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function today(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
}
function nowHM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
}

function haptic(type) {
  if (IN_TELEGRAM && tg.HapticFeedback) {
    if (type === 'success') tg.HapticFeedback.notificationOccurred('success');
    else tg.HapticFeedback.impactOccurred(type);
  } else if (navigator.vibrate) {
    navigator.vibrate(type === 'success' ? [10, 40, 10] : 10);
  }
}

function confirmAsk(text, onYes) {
  if (IN_TELEGRAM && tg.showConfirm && tg.isVersionAtLeast('6.2')) {
    tg.showConfirm(text, (ok) => { if (ok) onYes(); });
  } else if (window.confirm(text)) {
    onYes();
  }
}

function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

// ---------- Işga tuşiriş ----------

function init() {
  if (IN_TELEGRAM) {
    tg.ready();
    tg.expand();
    if (tg.isVersionAtLeast('6.1')) {
      tg.setHeaderColor('#0B0D17');
      tg.setBackgroundColor('#0B0D17');
    }
    tg.BackButton.onClick(() => history.back());
  } else {
    $('logoutBtn').classList.remove('hidden');
    // Ilova hali örnatilmagan bölsa, iPhone'da qanday örnatişni körsatamiz
    if (!isStandalone() && /iPhone|iPad/.test(navigator.userAgent)) {
      $('installHint').classList.remove('hidden');
      $('installHint2').classList.remove('hidden');
    }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  renderModules();
  $('loginForm').onsubmit = login;
  $('logoutBtn').onclick = logout;
  $('summary').onclick = () => go('planner');
  $('backBtn').onclick = () => history.length > 1 ? history.back() : go('home');
  $('refreshBtn').onclick = loadPlanner;
  document.querySelectorAll('.tab').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
      view = b.dataset.view;
      loadPlanner();
    };
  });
  $('addBtn').onclick = openSheet;
  $('micBtn').onclick = toggleRecord;
  $('rOnce').onclick = () => applyRoutine('once');
  $('rWeek').onclick = () => applyRoutine('week');
  $('rTask').onclick = () => {
    if (!routineDraft) return;
    routineDraft.notBlock = true;
    fillForm(routineDraft, null, '');
  };
  $('micFab').onclick = () => { openSheet(false); startRecord(); };
  $('closeSheet').onclick = closeSheet;
  $('sheet').onclick = (e) => { if (e.target.id === 'sheet') closeSheet(); };
  $('parseBtn').onclick = parseText;
  $('manualBtn').onclick = () => fillForm({ date: defaultDate(), duration: 30 }, null, '');
  $('taskText').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); parseText(); } };
  $('stepForm').onsubmit = (e) => { e.preventDefault(); saveTask(false); };

  window.addEventListener('popstate', () => go(currentRoute(), false));
  // Ilovaga qaytganda (fonda turgan bölsa) ma'lumotni yangilaymiz
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const r = currentRoute();
    if (r === 'home') loadHome();
    if (r === 'planner') loadPlanner();
  });

  const first = currentRoute();
  history.replaceState(null, '', '#' + first);
  go(first, false);
}

init();
