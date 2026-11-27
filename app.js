// Solih — ilova (PWA) va Telegram Mini App uçun bitta kod
// Ma'lumot Apps Script Web App'dan keladi.
// Telegram içida: initData imzosi; alohida ilovada: parol bilan olingan token.

const API_URL = 'https://script.google.com/macros/s/AKfycby-HPWDSm7ImB9E1gvnynj0pLlgyYkM6T-iVB5bvGE0hXVjckrF6Z_A1BXfKQu61dFC/exec';
const tg = window.Telegram && window.Telegram.WebApp;
const IN_TELEGRAM = !!(tg && tg.initData);
const TOKEN_KEY = 'sy_token';
const WEEKDAYS = ['Yakşanba', 'Duşanba', 'Seşanba', 'Çorşanba', 'Payşanba', 'Juma', 'Şanba'];
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

/** Ikonka: index.html'dagi SVG to'plamdan (<symbol id="i-…">) */
function ico(name, cls) {
  return '<svg class="i' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
}
const ICONS = { calendar: ico('calendar'), plus: ico('plus'), check: ico('check'), more: ico('more') };

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
  setBusy(b, true, 'Tekşirilmoqda…');
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
    setBusy(b, false);
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
    b.innerHTML = '<div class="ico">' + m.icon + '</div><b>' + esc(m.title) + ico('next') + '</b><span>' + esc(m.desc) + '</span>';
    b.onclick = () => go(m.id);
    box.appendChild(b);
  });
  box.insertAdjacentHTML('beforeend',
    '<div class="module soon"><div class="ico">' + ICONS.plus + '</div><b>Yangi agent</b><span>Tez orada</span></div>');
}

async function loadHome() {
  refreshPushBox().catch(() => {});
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
  // Kalendar körinişi alohida çiziladi
  const isCal = view === 'calendar';
  $('screen-planner').classList.toggle('wide', isCal);
  list.classList.toggle('hidden', isCal);
  $('cal').classList.toggle('hidden', !isCal);
  if (isCal) { loadCalendar(); return; }
  clearInterval(calNowTimer);

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
      list.innerHTML = '<div class="error">⚠️ ' + esc(e.message) + '<button class="btn-ghost" id="retryBtn">' + ico('refresh') + '<span>Qayta urinib köriş</span></button></div>';
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
      box.insertAdjacentHTML('beforeend', '<div class="empty">' + ico('moon') + (view === 'week' ? 'Vazifa yöq' : 'Reja böş — qöşiş uçun pastdagi + tugmasi') + '</div>');
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
    '<span class="time">' + it.start + '–' + it.end + '</span><span class="title">' + (it.rec ? ico('repeat', 'xs') : '') + esc(it.title) + '</span>';
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
  m.innerHTML = '<button data-a="tomorrow">' + ico('arrow') + 'Ertaga köçiriş</button><button data-a="delete" class="del">' + ico('ban') + 'Bekor qiliş</button>';
  m.onclick = (e) => {
    const t = e.target.closest('button');
    const a = t && t.dataset.a;
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
    toast(action === 'done' ? '✅ Bajarildi' : action === 'tomorrow' ? '➡️ Ertaga köçirildi' : '↩️ Bekor qilindi');
    haptic('success');
  } catch (e) {
    toast('⚠️ ' + e.message);
  }
  loadPlanner();
}

// ---------- Kalendar (Notion Calendar kabi) ----------

const WD_SHORT = ['Ya', 'Du', 'Se', 'Ço', 'Pa', 'Ju', 'Şa'];
const MONTHS_CAP = MONTHS.map((m) => m[0].toUpperCase() + m.slice(1));
const HOUR_H = 48;       // bir soatning balandligi (px)
const MIN_EVENT_H = 18;  // juda qisqa vazifa ham körinib tursin

let calStart = null;     // körinayotgan birinçi kun (00:00)
let calCount = 7;        // 1 | 3 | 7 kun
let calMini = null;      // kiçik oylik kalendarning oyi
let calNowTimer = null;  // «hozir» çizigini yangilaydigan taymer
let calScrolled = false; // birinçi oçilişda hozirgi vaqtga aylantirildimi
let calReq = 0;          // eski javob yangisining ustiga çizilmasin

function prefGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
function prefSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* xotira yöq */ } }

function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function mondayOf(d) { const x = dayStart(d); return addDays(x, -((x.getDay() + 6) % 7)); }
function parseYmd(s) { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function toMin(hm) { if (!hm) return 0; const p = hm.split(':').map(Number); return p[0] * 60 + (p[1] || 0); }
function hmOf(min) { return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); }

/** Berilgan kunni öz içiga oladigan birinçi kun: hafta — duşanbadan, qolgani — şu kunning özi */
function calAnchor(d, n) { return n === 7 ? mondayOf(d) : dayStart(d); }

/** Kalendar tugmalarini ulaydi (bir marta, init'da) */
function initCalendar() {
  const saved = Number(prefGet('sy_cal_n', 0));
  calCount = [1, 3, 7].indexOf(saved) >= 0 ? saved : (window.innerWidth < 700 ? 3 : 7);
  calStart = calAnchor(new Date(), calCount);

  $('calPrev').onclick = () => calShift(-1);
  $('calNext').onclick = () => calShift(1);
  $('calToday').onclick = calGoToday;
  document.querySelectorAll('#calRange button').forEach((b) => {
    b.onclick = () => calSetCount(Number(b.dataset.n), true);
  });
  $('miniPrev').onclick = () => { calMini = new Date(calMini.getFullYear(), calMini.getMonth() - 1, 1); renderMini(); };
  $('miniNext').onclick = () => { calMini = new Date(calMini.getFullYear(), calMini.getMonth() + 1, 1); renderMini(); };
  $('mini').onclick = (e) => {
    const k = e.target.dataset && e.target.dataset.date;
    if (!k) return;
    calStart = calAnchor(parseYmd(k), calCount);
    calMini = null;
    loadCalendar();
  };
  // Kun sarlavhasi bosilsa — şu kunning özi
  $('calHead').onclick = (e) => {
    const b = e.target.closest('.cal-dh');
    if (!b) return;
    calCount = 1;
    calStart = parseYmd(b.dataset.date);
    calMini = null;
    loadCalendar();
  };

  // Telefonda çapga/öngga surib, kunlarni almaştiriş
  const sc = $('calScroll');
  let sx = 0, sy = 0;
  sc.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  sc.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50) calShift(dx < 0 ? 1 : -1);
  }, { passive: true });

  window.addEventListener('resize', sizeCalendar);
}

function calShift(dir) {
  calStart = addDays(calStart, dir * calCount);
  calMini = null;
  haptic('light');
  loadCalendar();
}

function calGoToday() {
  calStart = calAnchor(new Date(), calCount);
  calMini = null;
  calScrolled = false;
  loadCalendar();
}

/** Nechta kun körinişini almaştiradi; bugun körinib turgan bölsa, bugundan qoladi */
function calSetCount(n, save) {
  const todayD = dayStart(new Date());
  const inView = todayD >= calStart && todayD < addDays(calStart, calCount);
  calCount = n;
  if (save) prefSet('sy_cal_n', n);
  calStart = calAnchor(inView ? todayD : calStart, n);
  calMini = null;
  loadCalendar();
}

/** Ma'lumotni oladi: avval keşdan darhol, keyin serverdan yangisini */
async function loadCalendar() {
  const req = ++calReq;
  const days = [];
  let allCached = true;
  for (let i = 0; i < calCount; i++) {
    const key = ymd(addDays(calStart, i));
    const c = readCache(key);
    if (!c) allCached = false;
    days.push(c || { date: key, items: [] });
  }
  renderCalendar(days);
  $('cal').classList.add('loading');
  try {
    const data = await api('days', { from: ymd(calStart), count: calCount });
    if (req !== calReq) return;
    if (!data.ok) throw new Error(data.error || 'Xatolik');
    writeCache(data.days);
    renderCalendar(data.days);
  } catch (e) {
    if (req !== calReq) return;
    toast(allCached ? '⚠️ Internet yöq — oxirgi saqlangan reja' : '⚠️ ' + e.message);
  } finally {
    if (req === calReq) $('cal').classList.remove('loading');
  }
}

function calTitleHtml(a, b) {
  if (calCount === 1) return esc(WEEKDAYS[a.getDay()]) + ', <em>' + a.getDate() + '-' + MONTHS[a.getMonth()] + '</em>';
  if (a.getMonth() === b.getMonth()) return MONTHS_CAP[a.getMonth()] + ' <em>' + a.getFullYear() + '</em>';
  return MONTHS_CAP[a.getMonth()] + ' – ' + MONTHS_CAP[b.getMonth()] + ' <em>' + b.getFullYear() + '</em>';
}

/** Butun kalendarni çizadi: sarlavha, soatlar, kun ustunlari */
function renderCalendar(days) {
  const root = $('cal');
  const todayKey = ymd(today(0));
  const nowMin = toMin(nowHM());
  root.style.setProperty('--n', days.length);
  root.style.setProperty('--hour', HOUR_H + 'px');

  $('calTitle').innerHTML = calTitleHtml(calStart, addDays(calStart, calCount - 1));
  document.querySelectorAll('#calRange button').forEach((b) => b.classList.toggle('active', Number(b.dataset.n) === calCount));

  // Kunlar sarlavhasi: «Ju 27» va bajarilganlar soni
  let head = '<div class="cal-corner">GMT+5</div>';
  days.forEach((d) => {
    const dt = parseYmd(d.date);
    const tasks = d.items.filter((x) => x.kind === 'task' && x.status !== 'Bekor');
    const done = tasks.filter((x) => x.status === 'Bajarildi').length;
    head += '<button type="button" class="cal-dh' + (d.date === todayKey ? ' today' : '') + '" data-date="' + d.date + '">' +
      '<span>' + WD_SHORT[dt.getDay()] + '</span><b>' + dt.getDate() + '</b>' +
      '<small>' + (tasks.length ? done + '/' + tasks.length : '&nbsp;') + '</small></button>';
  });
  $('calHead').innerHTML = head;

  // Soatlar ustuni va kunlar
  const body = $('calBody');
  body.innerHTML = '';
  const gutter = document.createElement('div');
  gutter.className = 'cal-gutter';
  const hasToday = days.some((d) => d.date === todayKey);
  let g = '';
  for (let h = 1; h < 24; h++) g += '<span data-m="' + h * 60 + '" style="top:' + h * HOUR_H + 'px">' + String(h).padStart(2, '0') + ':00</span>';
  gutter.innerHTML = g;
  body.appendChild(gutter);
  if (hasToday) gutter.insertAdjacentHTML('beforeend', '<em class="now-label" style="top:' + nowMin * HOUR_H / 60 + 'px">' + nowHM() + '</em>');
  days.forEach((d) => body.appendChild(renderCalDay(d, todayKey, nowMin)));
  markNearHours(hasToday ? nowMin : -99);

  renderMini();
  sizeCalendar();
  if (!calScrolled) {
    const target = hasToday ? Math.max(0, nowMin - 120) : 7 * 60;
    $('calScroll').scrollTop = target * HOUR_H / 60;
    calScrolled = true;
  }
  clearInterval(calNowTimer);
  calNowTimer = setInterval(updateNowLine, 60000);
}

/** Bitta kun ustuni: avval bloklar (fon), ustidan vazifalar */
function renderCalDay(d, todayKey, nowMin) {
  const col = document.createElement('div');
  const isToday = d.date === todayKey;
  const isPast = d.date < todayKey;
  col.className = 'cal-col' + (isToday ? ' today' : '');
  const blocks = layoutEvents(d.items.filter((x) => x.kind === 'block'));
  const tasks = layoutEvents(d.items.filter((x) => x.kind === 'task'));
  blocks.forEach((ev) => col.appendChild(eventEl(ev, d, isToday, isPast, nowMin, false)));
  tasks.forEach((ev) => {
    const overBlock = blocks.some((b) => b.s < ev.e && ev.s < b.e);
    col.appendChild(eventEl(ev, d, isToday, isPast, nowMin, overBlock));
  });
  if (isToday) col.insertAdjacentHTML('beforeend', '<i class="now-line" style="top:' + nowMin * HOUR_H / 60 + 'px"></i>');

  // Böş joy bosilsa — şu vaqtga yangi vazifa (15 daqiqaga yaxlitlab)
  col.onclick = (e) => {
    if (e.target !== col) return;
    const y = e.clientY - col.getBoundingClientRect().top;
    const min = Math.min(Math.floor(y / HOUR_H * 4) * 15, 23 * 60 + 45);
    newTaskAt(d.date, hmOf(min));
  };
  return col;
}

/** Bir vaqtga tuşgan işlarni yonma-yon ustunlarga bölib joylaydi */
function layoutEvents(items) {
  const evs = items.map((it) => {
    const s = toMin(it.start);
    let e = toMin(it.end);
    if (e <= s) e = (it.end === '00:00' && s > 0) ? 1440 : s + 15; // yarim tungaça yoki uzunligi yöq
    return { it, s, e: Math.max(e, s + 15) };
  }).sort((a, b) => a.s - b.s || b.e - a.e);

  let group = [];
  let colEnds = [];
  let groupEnd = -1;
  const flush = () => { group.forEach((ev) => { ev.cols = colEnds.length; }); group = []; colEnds = []; };
  evs.forEach((ev) => {
    if (ev.s >= groupEnd) { flush(); groupEnd = -1; }
    let c = colEnds.findIndex((end) => end <= ev.s);
    if (c < 0) { c = colEnds.length; colEnds.push(ev.e); } else colEnds[c] = ev.e;
    ev.col = c;
    group.push(ev);
    groupEnd = Math.max(groupEnd, ev.e);
  });
  flush();
  return evs;
}

/** Kalendardagi bitta blok yoki vazifa */
function eventEl(ev, d, isToday, isPast, nowMin, overBlock) {
  const it = ev.it;
  const isTask = it.kind === 'task';
  const done = it.status === 'Bajarildi';
  const cancel = it.status === 'Bekor';
  const late = isTask && !done && !cancel && (it.status === 'Keçikdi' || isPast || (isToday && ev.e < nowMin));
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'ev ' + it.kind + (!isTask && !it.soft ? ' hard' : '') + (done ? ' done' : '') + (cancel ? ' cancel' : '') + (late ? ' late' : '');

  const top = ev.s * HOUR_H / 60;
  const h = Math.max((ev.e - ev.s) * HOUR_H / 60 - 2, MIN_EVENT_H);
  const indent = overBlock ? 12 : 0; // vazifa blok ustida bölsa, blokning çeti körinib tursin
  const w = (100 - indent) / ev.cols;
  el.style.top = top + 'px';
  el.style.height = h + 'px';
  el.style.left = 'calc(' + (indent + ev.col * w) + '% + 2px)';
  el.style.width = 'calc(' + w + '% - 4px)';

  const icon = done ? ico('check', 'xs') : cancel ? ico('ban', 'xs') : it.rec ? ico('repeat', 'xs') : '';
  const time = it.start + '–' + it.end;
  el.innerHTML = h >= 34
    ? '<b>' + icon + esc(it.title) + '</b><span>' + time + '</span>'
    : '<b>' + icon + esc(it.title) + ' <span>' + it.start + '</span></b>';
  el.title = it.title + ' · ' + time;
  el.onclick = (e) => { e.stopPropagation(); openEvent(it, d, late); };
  return el;
}

/** Bosilgan vazifa yoki blok tafsilotlari va amallari */
function openEvent(it, d, late) {
  const dt = parseYmd(d.date);
  $('evTitle').innerHTML = ico(it.kind === 'block' ? 'calendar' : it.rec ? 'repeat' : 'check-circle') + '<span>' + esc(it.title) + '</span>';
  const rows = [
    ['calendar', WEEKDAYS[dt.getDay()] + ', ' + dt.getDate() + '-' + MONTHS[dt.getMonth()]],
    ['clock', it.start + '–' + it.end + ' · ' + durText(toMin(it.end) - toMin(it.start))]
  ];
  if (it.kind === 'block') {
    rows.push(['info', it.soft ? 'Kun tartibi · yumşoq blok: bu vaqtda boşqa iş ham qilsa böladi' : 'Kun tartibi · qattiq blok (zal, dars)']);
  } else {
    const st = it.status === 'Rejada' && late ? 'Keçikdi' : it.status;
    rows.push([st === 'Keçikdi' ? 'alert' : st === 'Bajarildi' ? 'check-circle' : st === 'Bekor' ? 'ban' : 'flag', 'Holat: ' + st]);
    if (it.rec) rows.push(['repeat', 'Takroriy vazifa']);
  }
  $('evMeta').innerHTML = rows.map((r) => '<p>' + ico(r[0]) + '<span>' + esc(r[1]) + '</span></p>').join('');

  const box = $('evActions');
  box.innerHTML = '';
  const add = (text, cls, fn, icon) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.innerHTML = ico(icon) + '<span>' + esc(text) + '</span>';
    b.onclick = fn;
    box.appendChild(b);
  };
  if (it.kind === 'task' && it.status !== 'Bajarildi' && it.status !== 'Bekor') {
    add('Bajarildi', 'btn-accent', () => { closeEvent(); act('done', it); }, 'check');
    add('Ertaga köçiriş', 'btn-ghost', () => { closeEvent(); act('tomorrow', it); }, 'arrow');
    add('Bekor qiliş', 'btn-ghost del', () => {
      confirmAsk('«' + it.title + '» bekor qilinsinmi?', () => { closeEvent(); act('delete', it); });
    }, 'ban');
  } else if (it.kind === 'block') {
    add('Şu vaqtga vazifa qöşiş', 'btn-ghost', () => { closeEvent(); newTaskAt(d.date, it.start); }, 'plus');
  }
  $('evSheet').classList.remove('hidden');
}

function closeEvent() { $('evSheet').classList.add('hidden'); }

/** Kalendardan: aniq kun va vaqtga yangi vazifa formasi */
function newTaskAt(date, start) {
  openSheet(false);
  fillForm({ date, start, duration: 30 }, null, '');
  setTimeout(() => $('fTitle').focus(), 60);
}

/** Kiçik oylik kalendar (kompyuterda çap tomonda) */
function renderMini() {
  if (!calMini) calMini = new Date(calStart.getFullYear(), calStart.getMonth(), 1);
  const m = calMini;
  $('miniTitle').textContent = MONTHS_CAP[m.getMonth()] + ' ' + m.getFullYear();
  const first = mondayOf(m);
  const todayKey = ymd(today(0));
  const a = ymd(calStart);
  const b = ymd(addDays(calStart, calCount - 1));
  let html = ['Du', 'Se', 'Ço', 'Pa', 'Ju', 'Şa', 'Ya'].map((w) => '<span class="mh">' + w + '</span>').join('');
  for (let i = 0; i < 42; i++) {
    const d = addDays(first, i);
    const k = ymd(d);
    const cls = [d.getMonth() !== m.getMonth() ? 'out' : '', k >= a && k <= b ? 'in' : '', k === todayKey ? 'today' : ''].join(' ').trim();
    html += '<button type="button" data-date="' + k + '" class="' + cls + '">' + d.getDate() + '</button>';
  }
  $('mini').innerHTML = html;
}

/** Kalendar balandligi ekranning qolgan qismini egallaydi */
function sizeCalendar() {
  const sc = $('calScroll');
  if ($('cal').classList.contains('hidden')) return;
  const top = sc.getBoundingClientRect().top + window.scrollY;
  sc.style.height = Math.max(320, window.innerHeight - top - 14) + 'px';
}

/** Hozirgi vaqt yorlig'i soat yozuvi ustiga tuşmasin: yaqin soat yozuvini yaşiradi */
function markNearHours(nowMin) {
  document.querySelectorAll('.cal-gutter span').forEach((x) => {
    x.classList.toggle('near', Math.abs(Number(x.dataset.m) - nowMin) < 15);
  });
}

/** «Hozir» çizigini har daqiqa suradi */
function updateNowLine() {
  if (view !== 'calendar' || $('screen-planner').classList.contains('hidden')) { clearInterval(calNowTimer); return; }
  const top = toMin(nowHM()) * HOUR_H / 60 + 'px';
  if (document.querySelector('.now-label')) markNearHours(toMin(nowHM()));
  document.querySelectorAll('.now-line').forEach((x) => { x.style.top = top; });
  const l = document.querySelector('.now-label');
  if (l) { l.style.top = top; l.textContent = nowHM(); }
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
  setBusy(b, true, 'Tuşunyapman…');
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
    setBusy(b, false);
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
  setSelect('fRecur', t.recurrence || 'Yöq');
  updateRemindHint();
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
  $('rOnce').innerHTML = ico('check') + '<span>' + (same ? 'Tuşunarli' : 'Ha, faqat şu kun') + '</span>';
  $('rOnce').dataset.same = same ? '1' : '';
  $('rWeek').innerHTML = ico('repeat') + '<span>Har ' + esc(r.routine.weekday) + ' şunday</span>';
  $('rWeek').classList.toggle('hidden', same);
  $('rTask').innerHTML = ico('plus') + '<span>' + (same ? 'Baribir vazifa qöş' : 'Yöq, alohida vazifa') + '</span>';
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

// Muhimlik → necha daqiqa oldin eslatiladi (serverdagi Scheduler.gs bilan bir xil)
const REMIND_LEVELS = { 'Yuqori': [1440, 60, 5], 'Örta': [60], 'Past': [5] };

/** Formada: «🔔 Eslatma: 1 soat oldin va vaqtida» — muhimlik va takrorlanişga qarab */
function updateRemindHint() {
  const prio = $('fPriority').value;
  const recur = $('fRecur').value;
  let list = (REMIND_LEVELS[prio] || REMIND_LEVELS['Örta']).slice();
  if (recur === 'Har kuni') list = list.filter((n) => n < 1440); // har kuni «1 kun oldin» kerak emas
  const span = (n) => n >= 1440 ? Math.round(n / 1440) + ' kun' : n >= 60 ? Math.floor(n / 60) + ' soat' + (n % 60 ? ' ' + (n % 60) + ' daqiqa' : '') : n + ' daqiqa';
  $('fRemind').innerHTML = ico('bell') + '<span>Eslatma: ' + (list.length ? list.map(span).join(', ') + ' oldin va ' : '') + 'vaqtida' +
    (recur !== 'Yöq' ? ' · ' + recur.toLowerCase() : '') + '</span>';
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
    recurrence: $('fRecur').value,
    note: $('fNote').value.trim()
  };
  const b = $('saveBtn');
  setBusy(b, true, 'Saqlanmoqda…');
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
    setBusy(b, false);
  }
}

// ---------- Tugmalar: yuklaniş, bosiş javobi ----------

/** Tugmani «işlayapti» holatiga ötkazadi (aylanayotgan belgi + matn), keyin asl körinişini qaytaradi */
function setBusy(b, on, label) {
  if (on) {
    if (b.dataset.html == null) b.dataset.html = b.innerHTML;
    b.disabled = true;
    b.classList.add('busy');
    b.innerHTML = '<span class="spin"></span><span>' + esc(label || '') + '</span>';
  } else {
    b.disabled = false;
    b.classList.remove('busy');
    if (b.dataset.html != null) { b.innerHTML = b.dataset.html; delete b.dataset.html; }
  }
}

/** Rejalaştiruvçi körinişini tanlaydi va eslab qoladi */
function setView(v) {
  view = v;
  prefSet('sy_view', v);
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.view === v));
}

/** Daqiqalar → «1 soat 30 daqiqa» */
function durText(min) {
  if (min <= 0) min += 1440;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return (h ? h + ' soat' : '') + (h && m ? ' ' : '') + (m ? m + ' daqiqa' : '');
}

/** Har bir tugma bosilganda: to'lqin (ripple) va Telegram'da yengil tebraniş */
function initPress() {
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled || e.button > 0) return;
    const r = b.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2.2;
    const w = document.createElement('span');
    w.className = 'ripple';
    w.style.width = w.style.height = size + 'px';
    w.style.left = (e.clientX - r.left - size / 2) + 'px';
    w.style.top = (e.clientY - r.top - size / 2) + 'px';
    b.appendChild(w);
    setTimeout(() => w.remove(), 600);
  }, { passive: true });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (IN_TELEGRAM && tg.HapticFeedback) tg.HapticFeedback.selectionChanged();
  }, true);
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
// Xabar boşidagi emoji örniga palitradagi ikonka
const TOAST_ICONS = [['⚠️', 'alert'], ['✅', 'check-circle'], ['➡️', 'arrow'], ['🔔', 'bell'], ['📨', 'send'], ['🎙', 'mic'], ['↩️', 'refresh'], ['🔁', 'repeat']];

function toast(text) {
  const t = $('toast');
  let icon = 'info';
  let body = String(text);
  TOAST_ICONS.some(([e, n]) => {
    if (body.indexOf(e) !== 0) return false;
    icon = n;
    body = body.slice(e.length).trim();
    return true;
  });
  t.innerHTML = ico(icon) + '<span>' + esc(body) + '</span>';
  t.classList.remove('hidden');
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
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

// ---------- Push-bildirişlar (alohida ilovada; iPhone'da ilova ekranga örnatilgan bölişi şart) ----------

function pushSupported() {
  return !IN_TELEGRAM && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** base64url → baytlar (VAPID ommaviy kaliti uçun) */
function b64uToBytes(s) {
  const pad = '='.repeat((4 - s.length % 4) % 4);
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Bosh ekrandagi «Bildirişlar» kartasini holatga qarab körsatadi */
async function refreshPushBox() {
  const box = $('pushBox');
  if (IN_TELEGRAM || !getToken()) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const btn = $('pushBtn');
  const state = $('pushState');
  const test = $('pushTestBtn');
  test.classList.add('hidden');
  btn.classList.add('hidden');

  if (/iPhone|iPad/.test(navigator.userAgent) && !isStandalone()) {
    state.textContent = 'Avval ilovani ekranga örnating (pastdagi yöriqnoma), keyin şu yerdan yoqasiz.';
    return;
  }
  if (!pushSupported()) { state.textContent = 'Bu brauzer push-bildirişni qöllamaydi.'; return; }
  if (Notification.permission === 'denied') {
    state.textContent = "Bildirişlar öçirilgan. iPhone Sozlamalar → Bildirişlar → Solih bölimidan ruxsat bering.";
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub && Notification.permission === 'granted') {
    state.textContent = '✅ Yoqilgan: eslatmalar Telegram bilan bir vaqtda şu telefonga ham keladi.';
    test.classList.remove('hidden');
  } else {
    state.textContent = 'Eslatmalar Telegram bilan bir vaqtda telefon ekraniga ham kelsin.';
    btn.classList.remove('hidden');
  }
}

/** Ruxsat söraydi, obuna böladi va obunani serverga saqlaydi */
async function enablePush() {
  const btn = $('pushBtn');
  setBusy(btn, true, 'Yoqilmoqda…');
  try {
    const perm = await Notification.requestPermission(); // iPhone faqat tugma bosilganda söraydi
    if (perm !== 'granted') throw new Error('Ruxsat berilmadi');
    const k = await api('pushKey');
    if (!k.ok || !k.key) throw new Error('Server kaliti topilmadi');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(k.key) });
    const device = /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'Kompyuter';
    const r = await api('pushSubscribe', { sub: sub.toJSON(), device });
    if (!r.ok) throw new Error(r.error || 'Saqlanmadi');
    haptic('success');
    toast('🔔 Bildirişlar yoqildi');
  } catch (e) {
    toast('⚠️ ' + e.message);
  } finally {
    setBusy(btn, false);
    refreshPushBox().catch(() => {});
  }
}

/** Sinov bildirişi */
async function testPush() {
  try {
    const r = await api('pushTest');
    toast(r.ok && r.sent ? '📨 Yuborildi — bir neçta soniyada keladi' : '⚠️ Yuborilmadi');
  } catch (e) {
    toast('⚠️ ' + e.message);
  }
}

// ---------- Işga tuşiriş ----------

function init() {
  if (IN_TELEGRAM) {
    tg.ready();
    tg.expand();
    if (tg.isVersionAtLeast('6.1')) {
      tg.setHeaderColor('#001D39');
      tg.setBackgroundColor('#001D39');
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

  // Oxirgi tanlangan körinişni eslab qolamiz; kompyuterda birinçi marta — kalendar
  const savedView = prefGet('sy_view', '');
  view = ['day', 'tomorrow', 'week', 'calendar'].indexOf(savedView) >= 0 ? savedView : (window.innerWidth >= 900 ? 'calendar' : 'day');
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.view === view));
  initCalendar();
  if (IN_TELEGRAM && tg.isVersionAtLeast('7.7') && tg.disableVerticalSwipes) tg.disableVerticalSwipes(); // kalendarni aylantirganda Mini App yopilib ketmasin

  renderModules();
  initPress();
  $('qAdd').onclick = () => { go('planner'); openSheet(); };
  $('qMic').onclick = () => { go('planner'); openSheet(false); startRecord(); };
  $('qCal').onclick = () => { setView('calendar'); go('planner'); };
  $('loginForm').onsubmit = login;
  $('logoutBtn').onclick = logout;
  $('summary').onclick = () => go('planner');
  $('backBtn').onclick = () => history.length > 1 ? history.back() : go('home');
  $('refreshBtn').onclick = loadPlanner;
  document.querySelectorAll('.tab').forEach((b) => {
    b.onclick = () => {
      if (view === b.dataset.view) return;
      setView(b.dataset.view);
      loadPlanner();
    };
  });
  $('addBtn').onclick = openSheet;
  $('micBtn').onclick = toggleRecord;
  $('fPriority').onchange = updateRemindHint;
  $('fRecur').onchange = updateRemindHint;
  $('pushBtn').onclick = enablePush;
  $('pushTestBtn').onclick = testPush;
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
  $('evClose').onclick = closeEvent;
  $('evSheet').onclick = (e) => { if (e.target.id === 'evSheet') closeEvent(); };

  // Klaviatura (kompyuterda): Esc — yopiş; kalendarda ← → va T
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeEvent(); if (!$('sheet').classList.contains('hidden')) closeSheet(); return; }
    if (view !== 'calendar' || $('screen-planner').classList.contains('hidden')) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if (!$('sheet').classList.contains('hidden') || !$('evSheet').classList.contains('hidden')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowLeft') calShift(-1);
    else if (e.key === 'ArrowRight') calShift(1);
    else if (e.key === 't' || e.key === 'T') calGoToday();
  });
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
