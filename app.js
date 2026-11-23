// Şaxsiy Yordamçi — Mini App (6-bosqiç)
// Ma'lumot Apps Script Web App'dan keladi; har sörovda Telegram initData yuboriladi va serverda tekşiriladi.

const API_URL = 'https://script.google.com/macros/s/AKfycby-HPWDSm7ImB9E1gvnynj0pLlgyYkM6T-iVB5bvGE0hXVjckrF6Z_A1BXfKQu61dFC/exec';
const tg = window.Telegram && window.Telegram.WebApp;

let view = 'day';          // day | tomorrow | week
let openMenu = null;       // oçiq turgan vazifa menyusi (id)
let draft = null;          // AI tayyorlagan qoralama

const $ = (id) => document.getElementById(id);

// ---------- Server bilan aloqa ----------

/** Apps Script'ga POST (text/plain — CORS "preflight"siz) */
async function api(action, payload = {}) {
  const res = await fetch(API_URL + '?api=1', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action, initData: tg ? tg.initData : '' }, payload))
  });
  const data = await res.json();
  if (data.error === 'auth') throw new Error("Mini App'ni Telegram içidan oçing");
  if (data.error === 'forbidden') throw new Error('Bu şaxsiy ilova');
  return data;
}

// ---------- Sana yordamçilari ----------

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

// ---------- Röyxatni körsatiş ----------

async function load() {
  const list = $('list');
  list.innerHTML = '<div class="skel"></div><div class="skel"></div>';
  openMenu = null;
  const from = view === 'tomorrow' ? ymd(today(1)) : ymd(today(0));
  const count = view === 'week' ? 7 : 1;
  try {
    const data = await api('days', { from, count });
    if (!data.ok) throw new Error(data.error || 'Xatolik');
    render(data.days);
  } catch (e) {
    list.innerHTML = '<div class="error">⚠️ ' + esc(e.message) + '<br><br><button class="primary" onclick="load()">Qayta urinib köriş</button></div>';
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
  row.innerHTML = '<span class="time">' + it.start + '–' + it.end + '</span><span class="title">' + esc(it.title) + '</span>';
  wrap.appendChild(row);
  if (it.kind !== 'task') return wrap;

  // Bajarildi belgisi
  const check = document.createElement('button');
  check.className = 'check';
  check.textContent = isDone ? '✓' : '';
  check.setAttribute('aria-label', 'Bajarildi');
  check.onclick = () => { if (!isDone) act('done', it, row); };
  row.prepend(check);

  // Qöşimça amallar
  if (!isDone) {
    const more = document.createElement('button');
    more.className = 'more';
    more.textContent = '⋯';
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
  m.innerHTML = '<button data-a="tomorrow">➡️ Ertaga</button><button data-a="delete" class="del">Bekor qiliş</button>';
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
  load();
}

// ---------- Yangi vazifa ----------

function openSheet() {
  draft = null;
  $('taskText').value = '';
  $('stepText').classList.remove('hidden');
  $('stepForm').classList.add('hidden');
  $('formWarn').classList.add('hidden');
  $('sheet').classList.remove('hidden');
  setTimeout(() => $('taskText').focus(), 50);
}
function closeSheet() { $('sheet').classList.add('hidden'); }

/** AI matnni tahlil qiladi → töldirilgan forma */
async function parseText() {
  const text = $('taskText').value.trim();
  if (!text) return;
  const b = $('parseBtn');
  b.disabled = true; b.textContent = 'Tuşunyapman…';
  try {
    const r = await api('parse', { text });
    if (!r.ok) throw new Error(r.error);
    fillForm(r.draft, r.auto, r.warn);
  } catch (e) {
    // AI işlamasa ham — böş forma bilan davom etamiz
    toast('⚠️ ' + e.message);
    fillForm({ title: text.slice(0, 100), date: ymd(today(0)), start: '', duration: 30 }, null, '');
  } finally {
    b.disabled = false; b.textContent = 'Davom etiş';
  }
}

function fillForm(t, auto, warn) {
  draft = t;
  $('fTitle').value = t.title || '';
  $('fDate').value = t.date || ymd(today(0));
  $('fStart').value = t.start ? t.start.padStart(5, '0') : '';
  setSelect('fDuration', t.duration || 30);
  setSelect('fPriority', t.priority || 'Örta');
  setSelect('fCategory', t.category || 'Boşqa');
  $('fNote').value = t.note || '';
  const notes = [];
  if (auto === 'free') notes.push('🕒 Vaqt böş oraliqqa özim qöydim.');
  if (auto === 'soft') notes.push('🕒 Böş vaqt yöq, iş/yöl vaqtiga qöydim.');
  if (warn) notes.push(warn);
  showWarn(notes.join('\n'));
  $('stepText').classList.add('hidden');
  $('stepForm').classList.remove('hidden');
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
  b.disabled = true;
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
    load();
  } catch (e) {
    toast('⚠️ ' + e.message);
  } finally {
    b.disabled = false;
  }
}

// ---------- Telefon ekraniga qöşiş ----------

function setupHomeScreen() {
  if (!tg || !tg.isVersionAtLeast || !tg.isVersionAtLeast('8.0') || !tg.checkHomeScreenStatus) return;
  tg.checkHomeScreenStatus((status) => {
    if (status === 'missed' || status === 'unknown') $('homeBtn').classList.remove('hidden');
  });
  $('homeBtn').onclick = () => tg.addToHomeScreen();
  tg.onEvent('homeScreenAdded', () => {
    $('homeBtn').classList.add('hidden');
    toast('📲 Ekranga qöşildi');
  });
}

// ---------- Mayda yordamçilar ----------

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

function haptic(type) {
  if (!tg || !tg.HapticFeedback) return;
  if (type === 'success') tg.HapticFeedback.notificationOccurred('success');
  else tg.HapticFeedback.impactOccurred(type);
}

function confirmAsk(text, onYes) {
  if (tg && tg.showConfirm && tg.isVersionAtLeast && tg.isVersionAtLeast('6.2')) {
    tg.showConfirm(text, (ok) => { if (ok) onYes(); });
  } else if (window.confirm(text)) {
    onYes();
  }
}

// ---------- Işga tuşiriş ----------

function init() {
  if (tg) {
    tg.ready();
    tg.expand();
    if (tg.setHeaderColor && tg.isVersionAtLeast('6.1')) tg.setHeaderColor('secondary_bg_color');
  }
  document.querySelectorAll('.tab').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
      view = b.dataset.view;
      load();
    };
  });
  $('addBtn').onclick = openSheet;
  $('closeSheet').onclick = closeSheet;
  $('sheet').onclick = (e) => { if (e.target.id === 'sheet') closeSheet(); };
  $('parseBtn').onclick = parseText;
  $('taskText').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); parseText(); } };
  $('stepForm').onsubmit = (e) => { e.preventDefault(); saveTask(false); };
  setupHomeScreen();
  load();
}

init();
